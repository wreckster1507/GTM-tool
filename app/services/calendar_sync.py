"""
Calendar sync service.

Maps Google Calendar events to CRM Meeting records.

Matching logic (same 3-pass approach as personal email sync):
  Pass 1: attendee email → CRM contact → linked deal
  Pass 2: attendee email domain → company → deal
  Pass 3: event title text match against known company names

For each matched event:
  - Upsert a Meeting (dedup by external_source_id = "gcal:{event_id}")
  - Link attendees from CRM contacts
  - Create/update the scheduled_at, meeting_type, and meeting_url

Called from the personal_email_sync Celery task so both mail + calendar
sync in the same job cycle.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.google_calendar import CalendarEvent
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal, DealContact
from app.models.meeting import Meeting

logger = logging.getLogger(__name__)

FREE_EMAIL_PROVIDERS = {
    "gmail.com", "yahoo.com", "outlook.com", "hotmail.com",
    "icloud.com", "protonmail.com", "googlemail.com",
}


def _domain_from_email(addr: str) -> str:
    if "@" not in addr:
        return ""
    return addr.split("@", 1)[1].lower().strip().lstrip("www.")


def _normalize_name_key(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower())
    return " ".join(cleaned.split())


def _infer_meeting_type(title: str) -> str:
    lower = title.lower()
    if any(w in lower for w in ["demo", "product demo", "platform demo"]):
        return "demo"
    if any(w in lower for w in ["discovery", "intro", "initial call", "first call"]):
        return "discovery"
    if any(w in lower for w in ["poc", "pilot", "trial", "proof of concept"]):
        return "poc"
    if any(w in lower for w in ["qbr", "business review", "quarterly"]):
        return "qbr"
    return "discovery"


def _naive_utc(dt: datetime) -> datetime:
    """Convert a tz-aware datetime to naive UTC (matches DB column type)."""
    if dt.tzinfo is not None:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


async def sync_calendar_events(
    session: AsyncSession,
    events: list[CalendarEvent],
    user_email: str,
) -> dict:
    """
    Process a list of CalendarEvents and upsert Meeting records.

    Returns stats dict: {meetings_created, meetings_updated, skipped}
    """
    stats = {"meetings_created": 0, "meetings_updated": 0, "skipped": 0}

    if not events:
        return stats

    # Pre-load company domains and names for matching
    company_rows = (await session.execute(
        select(Company.id, Company.name, Company.domain)
    )).all()
    company_domain_map: dict[str, tuple[UUID, str]] = {}
    company_name_candidates: list[tuple[str, UUID, str]] = []
    for row in company_rows:
        domain = (row.domain or "").strip().lower().lstrip("www.")
        if domain:
            company_domain_map[domain] = (row.id, row.name)
        norm = _normalize_name_key(row.name)
        if len(norm) >= 4:
            company_name_candidates.append((norm, row.id, row.name))
    company_name_candidates.sort(key=lambda x: len(x[0]), reverse=True)

    # Pre-load contact emails
    contact_rows = (await session.execute(
        select(Contact.id, Contact.email, Contact.company_id)
    )).all()
    contact_email_map: dict[str, UUID] = {}
    contact_company_map: dict[UUID, UUID | None] = {}
    for row in contact_rows:
        if row.email:
            contact_email_map[row.email.lower().strip()] = row.id
        contact_company_map[row.id] = row.company_id

    user_domain = _domain_from_email(user_email)

    for event in events:
        try:
            source_id = f"gcal:{event.event_id}"
            external_attendees = [
                e for e in event.attendee_emails
                if e != user_email and _domain_from_email(e) != user_domain
            ]

            if not external_attendees:
                stats["skipped"] += 1
                continue

            # ── Pass 1: contact email match ───────────────────────────────
            matched_contact_ids: list[UUID] = []
            matched_company_id: UUID | None = None
            for addr in external_attendees:
                cid = contact_email_map.get(addr)
                if cid:
                    matched_contact_ids.append(cid)
                    if not matched_company_id:
                        matched_company_id = contact_company_map.get(cid)

            deal_ids: list[UUID] = []
            if matched_contact_ids:
                dc_rows = (await session.execute(
                    select(DealContact.deal_id).where(
                        DealContact.contact_id.in_(matched_contact_ids)
                    ).distinct()
                )).all()
                deal_ids = [r.deal_id for r in dc_rows]

            # ── Pass 2: domain match ──────────────────────────────────────
            if not deal_ids:
                for addr in external_attendees:
                    domain = _domain_from_email(addr)
                    if not domain or domain in FREE_EMAIL_PROVIDERS:
                        continue
                    if domain in company_domain_map:
                        company_id, _ = company_domain_map[domain]
                        matched_company_id = company_id
                        deal_rows = (await session.execute(
                            select(Deal.id).where(Deal.company_id == company_id)
                        )).all()
                        deal_ids = [r.id for r in deal_rows]
                        if deal_ids:
                            break

            # ── Pass 3: title text match against company names ────────────
            if not deal_ids:
                norm_title = f" {_normalize_name_key(event.title)} "
                for norm_name, company_id, _ in company_name_candidates:
                    if f" {norm_name} " in norm_title:
                        matched_company_id = company_id
                        deal_rows = (await session.execute(
                            select(Deal.id).where(Deal.company_id == company_id)
                        )).all()
                        deal_ids = [r.id for r in deal_rows]
                        if deal_ids:
                            break

            if not deal_ids and not matched_company_id:
                stats["skipped"] += 1
                continue

            # ── Build attendees payload ───────────────────────────────────
            attendees_payload = []
            if matched_contact_ids:
                contact_detail_rows = (await session.execute(
                    select(
                        Contact.id, Contact.first_name, Contact.last_name,
                        Contact.email, Contact.title,
                    ).where(Contact.id.in_(matched_contact_ids[:8]))
                )).all()
                for row in contact_detail_rows:
                    attendees_payload.append({
                        "contact_id": str(row.id),
                        "name": f"{row.first_name} {row.last_name}".strip(),
                        "email": row.email or "",
                        "title": row.title or "",
                    })

            meeting_type = _infer_meeting_type(event.title)
            scheduled_at = _naive_utc(event.start_dt) if event.start_dt else None

            # ── Upsert per deal ───────────────────────────────────────────
            for deal_id in (deal_ids or [None]):  # type: ignore[list-item]
                existing = (await session.execute(
                    select(Meeting).where(
                        Meeting.external_source == "google_calendar",
                        Meeting.external_source_id == source_id,
                        Meeting.deal_id == deal_id,
                    )
                )).scalar_one_or_none()

                if existing:
                    # Update timing and link if changed
                    changed = False
                    if scheduled_at and existing.scheduled_at != scheduled_at:
                        existing.scheduled_at = scheduled_at
                        changed = True
                    if event.meeting_link and existing.meeting_url != event.meeting_link:
                        existing.meeting_url = event.meeting_link
                        changed = True
                    if changed:
                        existing.updated_at = datetime.utcnow()
                        session.add(existing)
                        stats["meetings_updated"] += 1
                else:
                    meeting = Meeting(
                        title=event.title[:200],
                        deal_id=deal_id,
                        company_id=matched_company_id,
                        meeting_type=meeting_type,
                        status="scheduled",
                        scheduled_at=scheduled_at,
                        meeting_url=event.meeting_link,
                        external_source="google_calendar",
                        external_source_id=source_id,
                        attendees=attendees_payload or None,
                        created_at=datetime.utcnow(),
                        updated_at=datetime.utcnow(),
                    )
                    session.add(meeting)
                    stats["meetings_created"] += 1
                    logger.info(
                        "calendar_sync: created meeting '%s' (deal=%s, start=%s)",
                        event.title, deal_id, scheduled_at,
                    )

        except Exception:
            logger.exception("calendar_sync: failed processing event %s", event.event_id)
            stats["skipped"] += 1

    await session.flush()
    return stats
