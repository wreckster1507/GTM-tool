from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.resend_client import send_email
from app.config import settings
from app.database import AsyncSessionLocal
from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.meeting import Meeting
from app.models.settings import WorkspaceSettings
from app.models.user import User
from app.services.pre_meeting_intelligence import generate_meeting_demo_strategy, run_pre_meeting_intelligence


logger = logging.getLogger(__name__)

DEFAULT_PRE_MEETING_AUTOMATION_SETTINGS = {
    "enabled": True,
    "send_hours_before": 12,
    "auto_generate_if_missing": True,
}


def normalize_pre_meeting_settings(value: Any) -> dict[str, Any]:
    raw = value if isinstance(value, dict) else {}
    send_hours_before = int(raw.get("send_hours_before", DEFAULT_PRE_MEETING_AUTOMATION_SETTINGS["send_hours_before"]))
    return {
        "enabled": bool(raw.get("enabled", DEFAULT_PRE_MEETING_AUTOMATION_SETTINGS["enabled"])),
        "send_hours_before": max(1, min(send_hours_before, 168)),
        "auto_generate_if_missing": bool(
            raw.get(
                "auto_generate_if_missing",
                DEFAULT_PRE_MEETING_AUTOMATION_SETTINGS["auto_generate_if_missing"],
            )
        ),
    }


async def _get_or_create_settings(session: AsyncSession) -> WorkspaceSettings:
    row = await session.get(WorkspaceSettings, 1)
    if row is None:
        row = WorkspaceSettings(id=1)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def _collect_recipient_ids(session: AsyncSession, meeting: Meeting) -> list[UUID]:
    recipient_ids: list[UUID] = []
    seen: set[UUID] = set()

    def push(value: UUID | None) -> None:
        if value and value not in seen:
            seen.add(value)
            recipient_ids.append(value)

    deal = await session.get(Deal, meeting.deal_id) if meeting.deal_id else None
    company = await session.get(Company, meeting.company_id) if meeting.company_id else None

    push(deal.assigned_to_id if deal else None)
    if company:
        push(company.assigned_to_id)
        push(company.sdr_id)

    attendees = meeting.attendees if isinstance(meeting.attendees, list) else []
    attendee_contact_ids = [
        UUID(str(item.get("contact_id")))
        for item in attendees
        if isinstance(item, dict) and item.get("contact_id")
    ]
    if attendee_contact_ids:
        contacts = (
            await session.execute(select(Contact).where(Contact.id.in_(attendee_contact_ids)))
        ).scalars().all()
        for contact in contacts:
            push(contact.assigned_to_id)
            push(contact.sdr_id)

    return recipient_ids


def _build_meeting_intel_email(meeting: Meeting) -> tuple[str, str]:
    research = meeting.research_data if isinstance(meeting.research_data, dict) else {}
    executive_briefing = str(research.get("executive_briefing") or meeting.pre_brief or "").strip()
    recommendations = research.get("meeting_recommendations") if isinstance(research.get("meeting_recommendations"), list) else []
    why_now_signals = research.get("why_now_signals") if isinstance(research.get("why_now_signals"), list) else []
    attendee_cards = (
        ((research.get("attendee_intelligence") or {}).get("stakeholder_cards"))
        if isinstance(research.get("attendee_intelligence"), dict)
        else []
    )
    frontend_base = (settings.FRONTEND_URL or "http://localhost:8080").rstrip("/")
    meeting_link = f"{frontend_base}/meetings/{meeting.id}"
    scheduled_label = meeting.scheduled_at.strftime("%b %d, %Y %I:%M %p UTC") if meeting.scheduled_at else "TBD"

    why_now_lines = []
    for item in why_now_signals[:3]:
        if isinstance(item, dict):
            detail = str(item.get("detail") or item.get("title") or "").strip()
            if detail:
                why_now_lines.append(f"- {detail}")

    attendee_lines = []
    for item in attendee_cards[:3]:
        if isinstance(item, dict):
            name = str(item.get("name") or "Stakeholder").strip()
            title = str(item.get("title") or item.get("role_label") or "").strip()
            focus = str(item.get("likely_focus") or "").strip()
            line = f"- {name}"
            if title:
                line += f" | {title}"
            if focus:
                line += f" | Focus: {focus}"
            attendee_lines.append(line)

    action_lines = []
    for item in recommendations[:4]:
        if isinstance(item, str) and item.strip():
            action_lines.append(f"- {item.strip()}")

    body_sections = [
        f"Pre-meeting intel for: {meeting.title}",
        f"Scheduled time: {scheduled_label}",
        "",
    ]
    if executive_briefing:
        body_sections.extend(["Executive briefing:", executive_briefing, ""])
    if why_now_lines:
        body_sections.extend(["Why now:", *why_now_lines, ""])
    if attendee_lines:
        body_sections.extend(["Attendees to focus on:", *attendee_lines, ""])
    if action_lines:
        body_sections.extend(["Recommended meeting focus:", *action_lines, ""])
    body_sections.extend(
        [
            f"Open the full prep page: {meeting_link}",
            "",
            "Beacon generated this automatically from the account, stakeholders, and recent meeting signals.",
        ]
    )

    subject = f"Pre-meeting intel: {meeting.title}"
    return subject, "\n".join(body_sections).strip()


async def run_due_pre_meeting_intel_once() -> dict[str, int]:
    async with AsyncSessionLocal() as session:
        settings_row = await _get_or_create_settings(session)
        config = normalize_pre_meeting_settings(settings_row.pre_meeting_automation_settings)
        if not config["enabled"]:
            return {"checked": 0, "generated": 0, "emailed": 0, "skipped": 0}

        now = datetime.utcnow()
        window_end = now + timedelta(hours=config["send_hours_before"])
        meetings = (
            await session.execute(
                select(Meeting).where(
                    Meeting.status == "scheduled",
                    Meeting.scheduled_at.is_not(None),
                    Meeting.scheduled_at > now,
                    Meeting.scheduled_at <= window_end,
                    Meeting.intel_email_sent_at.is_(None),
                )
            )
        ).scalars().all()

        checked = len(meetings)
        generated = 0
        emailed = 0
        skipped = 0

        for meeting in meetings:
            try:
                if config["auto_generate_if_missing"] and not meeting.research_data:
                    await run_pre_meeting_intelligence(meeting.id, session)
                    generated += 1
                    meeting = await session.get(Meeting, meeting.id)

                if config["auto_generate_if_missing"] and meeting and not meeting.demo_strategy:
                    await generate_meeting_demo_strategy(meeting.id, session)
                    meeting = await session.get(Meeting, meeting.id)

                if not meeting:
                    skipped += 1
                    continue

                recipient_ids = await _collect_recipient_ids(session, meeting)
                if not recipient_ids:
                    skipped += 1
                    continue

                users = (
                    await session.execute(select(User).where(User.id.in_(recipient_ids)))
                ).scalars().all()
                recipients = [user for user in users if user.is_active and user.email]
                if not recipients:
                    skipped += 1
                    continue

                subject, body = _build_meeting_intel_email(meeting)
                sent_any = False
                for recipient in recipients:
                    result = await send_email(
                        recipient.email,
                        subject,
                        body,
                        from_name="Beacon Meeting Intel",
                    )
                    if result.get("status") == "sent":
                        sent_any = True

                if not sent_any:
                    skipped += 1
                    continue

                meeting.intel_email_sent_at = datetime.utcnow()
                meeting.updated_at = datetime.utcnow()
                session.add(meeting)
                if meeting.deal_id:
                    session.add(
                        Activity(
                            deal_id=meeting.deal_id,
                            type="note",
                            source="pre_meeting_automation",
                            content=f"Pre-meeting intel email sent for '{meeting.title}'",
                        )
                    )
                emailed += 1
            except Exception:
                logger.exception("Pre-meeting automation failed for meeting %s", meeting.id)
                skipped += 1

        await session.commit()
        return {
            "checked": checked,
            "generated": generated,
            "emailed": emailed,
            "skipped": skipped,
        }
