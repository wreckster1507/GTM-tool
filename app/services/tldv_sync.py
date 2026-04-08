from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.tldv import TldvClient, TldvError
from app.clients.azure_openai import AzureOpenAIClient
from app.config import settings
from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal, DealContact
from app.models.meeting import Meeting
from app.models.settings import WorkspaceSettings
from app.services.tasks import refresh_system_tasks_for_entity


@dataclass
class TldvSyncStats:
    meetings_created: int = 0
    meetings_updated: int = 0
    activities_created: int = 0
    activities_updated: int = 0
    mapped_to_deal: int = 0
    mapped_to_company: int = 0
    mapped_via_gmail: int = 0
    unmapped: int = 0

    def as_dict(self) -> dict[str, int]:
        return {
            "meetings_created": self.meetings_created,
            "meetings_updated": self.meetings_updated,
            "activities_created": self.activities_created,
            "activities_updated": self.activities_updated,
            "mapped_to_deal": self.mapped_to_deal,
            "mapped_to_company": self.mapped_to_company,
            "mapped_via_gmail": self.mapped_via_gmail,
            "unmapped": self.unmapped,
        }


def _normalize_email(value: str | None) -> str:
    return (value or "").strip().lower()


def _normalize_domain(value: str | None) -> str:
    domain = (value or "").strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is not None:
            dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
        return dt
    except Exception:
        return None


def _clean_text(value: str | None) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _is_placeholder_summary(value: str | None) -> bool:
    normalized = _clean_text(value).lower()
    return normalized in {"", "no summary", "summary unavailable", "unavailable"}


def _internal_domains() -> set[str]:
    domains = {_normalize_domain(settings.GMAIL_SHARED_INBOX.split("@", 1)[1] if "@" in (settings.GMAIL_SHARED_INBOX or "") else "")}
    domains.add("beacon.li")
    return {domain for domain in domains if domain}


def _infer_meeting_type(title: str, summary: str, transcript: str) -> str:
    text = " ".join(part.lower() for part in [title, summary, transcript] if part)
    if "poc" in text or "pilot" in text:
        return "poc"
    if "demo" in text:
        return "demo"
    if "qbr" in text or "quarterly business review" in text:
        return "qbr"
    if "discovery" in text or "intro" in text:
        return "discovery"
    return "other"


def _extract_title_candidates(title: str) -> list[str]:
    normalized = title or ""
    for token in ["🤝", "<>", " x ", " X ", "|", " - ", ":", "—"]:
        normalized = normalized.replace(token, "|")
    parts = [part.strip() for part in normalized.split("|") if part.strip()]
    candidates: list[str] = []
    ignored = {
        "beacon",
        "beacon.li",
        "zippy",
        "introduction",
        "next steps",
        "sales review",
        "demo recording",
        "recording",
        "tech deep dive",
        "in-person tech deep dive",
        "catch up",
    }
    for part in parts:
        cleaned = re.sub(r"\(.*?\)", "", part).strip()
        cleaned = re.sub(r"\s+", " ", cleaned)
        lowered = cleaned.lower()
        if not cleaned or lowered in ignored:
            continue
        if lowered.startswith("beacon "):
            cleaned = cleaned[7:].strip()
            lowered = cleaned.lower()
        if lowered.endswith(" beacon"):
            cleaned = cleaned[:-7].strip()
            lowered = cleaned.lower()
        if cleaned and lowered not in ignored:
            candidates.append(cleaned)
    return list(dict.fromkeys(candidates))


def _extract_attendees(meeting_payload: dict[str, Any]) -> list[dict[str, Any]]:
    organizer = meeting_payload.get("organizer") if isinstance(meeting_payload.get("organizer"), dict) else None
    raw_invitees = meeting_payload.get("invitees") or []
    attendees: list[dict[str, Any]] = []
    if organizer:
        attendees.append(
            {
                "name": organizer.get("name"),
                "email": _normalize_email(organizer.get("email")),
                "role": "organizer",
            }
        )
    for invitee in raw_invitees:
        if not isinstance(invitee, dict):
            continue
        attendees.append(
            {
                "name": invitee.get("name"),
                "email": _normalize_email(invitee.get("email")),
                "role": "invitee",
            }
        )
    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for attendee in attendees:
        email = attendee.get("email") or ""
        name = str(attendee.get("name") or "").strip()
        signature = f"{email}|{name}"
        if not email and not name:
            continue
        if signature in seen:
            continue
        seen.add(signature)
        deduped.append(attendee)
    return deduped


async def _find_existing_meeting(session: AsyncSession, meeting_id: str) -> Meeting | None:
    result = await session.execute(
        select(Meeting)
        .where(Meeting.external_source == "tldv", Meeting.external_source_id == meeting_id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _find_activity(session: AsyncSession, external_source_id: str) -> Activity | None:
    result = await session.execute(
        select(Activity)
        .where(Activity.external_source == "tldv", Activity.external_source_id == external_source_id)
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _match_contacts(session: AsyncSession, attendee_emails: list[str]) -> list[Contact]:
    if not attendee_emails:
        return []
    result = await session.execute(select(Contact).where(Contact.email.in_(attendee_emails)))
    return result.scalars().all()


async def _match_deal_from_contacts(session: AsyncSession, contact_ids: list[UUID]) -> Deal | None:
    if not contact_ids:
        return None
    result = await session.execute(
        select(Deal)
        .join(DealContact, DealContact.deal_id == Deal.id)
        .where(DealContact.contact_id.in_(contact_ids))
        .order_by(
            Deal.stage.not_in(["closed_won", "closed_lost"]).desc(),
            Deal.last_activity_at.desc().nullslast(),
            Deal.updated_at.desc(),
        )
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _match_company_from_domains(session: AsyncSession, domains: list[str]) -> Company | None:
    normalized = [_normalize_domain(domain) for domain in domains if _normalize_domain(domain)]
    if not normalized:
        return None
    result = await session.execute(
        select(Company)
        .where(Company.domain.in_(normalized))
        .order_by(Company.enriched_at.desc().nullslast(), Company.updated_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _match_company_from_title(session: AsyncSession, title: str) -> Company | None:
    candidates = _extract_title_candidates(title)
    if not candidates:
        return None
    for candidate in candidates:
        result = await session.execute(
            select(Company)
            .where(Company.name.ilike(f"%{candidate}%"))
            .order_by(Company.updated_at.desc())
            .limit(1)
        )
        company = result.scalar_one_or_none()
        if company:
            return company
    return None


async def _match_deal_from_title(session: AsyncSession, title: str, company: Company | None = None) -> Deal | None:
    candidates = _extract_title_candidates(title)
    if company and company.id:
        result = await session.execute(
            select(Deal)
            .where(Deal.company_id == company.id)
            .order_by(
                Deal.stage.not_in(["closed_won", "closed_lost"]).desc(),
                Deal.last_activity_at.desc().nullslast(),
                Deal.updated_at.desc(),
            )
            .limit(1)
        )
        deal = result.scalar_one_or_none()
        if deal:
            return deal
    for candidate in candidates:
        result = await session.execute(
            select(Deal)
            .where(Deal.name.ilike(f"%{candidate}%"))
            .order_by(
                Deal.stage.not_in(["closed_won", "closed_lost"]).desc(),
                Deal.last_activity_at.desc().nullslast(),
                Deal.updated_at.desc(),
            )
            .limit(1)
        )
        deal = result.scalar_one_or_none()
        if deal:
            return deal
    return None


async def _match_recent_gmail_deal(session: AsyncSession, attendee_emails: list[str]) -> Deal | None:
    if not attendee_emails:
        return None
    conditions = []
    for email in attendee_emails:
        conditions.extend(
            [
                Activity.email_from == email,
                Activity.email_to.ilike(f"%{email}%"),
                Activity.email_cc.ilike(f"%{email}%"),
            ]
        )
    result = await session.execute(
        select(Deal)
        .join(Activity, Activity.deal_id == Deal.id)
        .where(
            Activity.source == "gmail_sync",
            Activity.deal_id.isnot(None),
            or_(*conditions),
        )
        .order_by(Activity.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _is_tldv_sync_enabled(session: AsyncSession) -> bool:
    row = (await session.execute(select(WorkspaceSettings).where(WorkspaceSettings.id == 1))).scalar_one_or_none()
    cfg = row.sync_schedule_settings if row and isinstance(row.sync_schedule_settings, dict) else {}
    return bool(cfg.get("tldv_sync_enabled", True))


def _meeting_highlights_text(highlights_payload: dict[str, Any] | None) -> str:
    if not isinstance(highlights_payload, dict):
        return ""
    parts: list[str] = []
    for item in highlights_payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        text = _clean_text(item.get("text"))
        topic = item.get("topic") if isinstance(item.get("topic"), dict) else {}
        topic_title = _clean_text(topic.get("title"))
        topic_summary = _clean_text(topic.get("summary"))
        if topic_title and topic_summary and not _is_placeholder_summary(topic_summary):
            parts.append(f"{topic_title}: {topic_summary}")
        elif topic_title:
            parts.append(topic_title)
        if text:
            parts.append(text)
    return "\n".join(part for part in parts if part).strip()


def _meeting_topics(highlights_payload: dict[str, Any] | None) -> list[str]:
    if not isinstance(highlights_payload, dict):
        return []
    topics: list[str] = []
    for item in highlights_payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        topic = item.get("topic") if isinstance(item.get("topic"), dict) else {}
        title = _clean_text(topic.get("title"))
        if title:
            topics.append(title)
    return list(dict.fromkeys(topics))


def _highlight_text_items(highlights_payload: dict[str, Any] | None) -> list[str]:
    if not isinstance(highlights_payload, dict):
        return []
    items: list[str] = []
    for item in highlights_payload.get("data") or []:
        if not isinstance(item, dict):
            continue
        text = _clean_text(item.get("text"))
        if text:
            items.append(text)
    return list(dict.fromkeys(items))


def _transcript_text(transcript_payload: dict[str, Any] | None) -> str:
    if not isinstance(transcript_payload, dict):
        return ""
    segments = transcript_payload.get("data") or []
    if isinstance(segments, dict):
        transcript = _clean_text(segments.get("transcript"))
        if transcript:
            return transcript
        segments = segments.get("segments") or []
    parts: list[str] = []
    for segment in segments:
        if not isinstance(segment, dict):
            continue
        text = _clean_text(segment.get("text"))
        speaker = _clean_text(segment.get("speaker"))
        if not text:
            continue
        parts.append(f"{speaker}: {text}" if speaker else text)
    return "\n".join(parts).strip()


def _native_meeting_summary(
    *,
    title: str,
    transcript_text: str,
    highlights_payload: dict[str, Any] | None,
) -> str:
    highlight_items = _highlight_text_items(highlights_payload)
    if highlight_items:
        summary_parts: list[str] = highlight_items[:2]
        next_step = next(
            (
                item for item in highlight_items[2:]
                if any(token in item.lower() for token in ["poc", "pilot", "next step", "nda", "pricing", "workshop"])
            ),
            None,
        )
        if next_step:
            summary_parts.append(next_step)
        return " ".join(summary_parts)[:420].strip()

    transcript_lines = [line.strip() for line in transcript_text.splitlines() if line.strip()]
    meaningful = [line for line in transcript_lines if len(line) > 40][:3]
    if meaningful:
        return " ".join(meaningful)[:420].strip()
    return _clean_text(title)


async def _analyze_meeting_intelligence(
    *,
    title: str,
    transcript_text: str,
    highlights_text: str,
    highlights_payload: dict[str, Any] | None,
) -> dict[str, Any]:
    source_text = "\n\n".join(part for part in [highlights_text, transcript_text] if part).strip()
    native_summary = _native_meeting_summary(
        title=title,
        transcript_text=transcript_text,
        highlights_payload=highlights_payload,
    )
    if len(source_text) < 80 or not settings.claude_api_key:
        return _fallback_meeting_intelligence(
            title=title,
            transcript_text=transcript_text,
            highlights_text=highlights_text,
            native_summary=native_summary,
        )

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=700,
            messages=[
                {
                    "role": "user",
                    "content": (
                        "Analyze this customer meeting and return JSON only with keys: "
                        "summary (string), action_items (array of strings), topics (array of strings), "
                        "intents (array of strings), risks (array of strings), next_steps (array of strings), "
                        "sentiment (string), stage_signal (string), meeting_outcome (string).\n\n"
                        f"Meeting title: {title}\n\n"
                        f"{source_text[:12000]}"
                    ),
                }
            ],
        )
        raw = response.content[0].text.strip()
        start = raw.find("{")
        end = raw.rfind("}")
        payload = json.loads(raw[start : end + 1] if start >= 0 and end > start else raw)
        summary_text = _clean_text(payload.get("summary"))
        return {
            "summary": native_summary if _is_placeholder_summary(summary_text) else summary_text,
            "action_items": [str(item).strip() for item in payload.get("action_items") or [] if str(item).strip()],
            "topics": [str(item).strip() for item in payload.get("topics") or [] if str(item).strip()],
            "intents": [str(item).strip() for item in payload.get("intents") or [] if str(item).strip()],
            "risks": [str(item).strip() for item in payload.get("risks") or [] if str(item).strip()],
            "next_steps": [str(item).strip() for item in payload.get("next_steps") or [] if str(item).strip()],
            "sentiment": str(payload.get("sentiment") or "").strip() or None,
            "stage_signal": str(payload.get("stage_signal") or "").strip() or None,
            "meeting_outcome": str(payload.get("meeting_outcome") or "").strip() or None,
        }
    except Exception:
        return _fallback_meeting_intelligence(
            title=title,
            transcript_text=transcript_text,
            highlights_text=highlights_text,
            native_summary=native_summary,
        )


def _fallback_meeting_intelligence(*, title: str, transcript_text: str, highlights_text: str, native_summary: str) -> dict[str, Any]:
    text = " ".join(part.lower() for part in [title, highlights_text, transcript_text] if part)
    summary = native_summary or (transcript_text[:180] if transcript_text else title)
    topics: list[str] = []
    intents: list[str] = []
    risks: list[str] = []
    actions: list[str] = []
    if "pricing" in text or "proposal" in text:
        topics.append("Pricing")
        intents.append("Commercial discussion")
        actions.append("Send pricing or proposal")
    if "security" in text or "procurement" in text or "msa" in text:
        topics.append("Security / Procurement")
        risks.append("Security or legal review may slow the deal")
        actions.append("Add security or legal stakeholder")
    if "workshop" in text or "working session" in text:
        topics.append("Workshop")
        intents.append("Technical workshop")
        actions.append("Book technical workshop")
    if "poc" in text or "pilot" in text:
        topics.append("POC")
        intents.append("POC alignment")
        actions.append("Move deal to POC Agreed if not already there")
    if "competitor" in text or "rocketlane" in text or "guidecx" in text:
        risks.append("Competitive pressure surfaced")
    return {
        "summary": summary.strip(),
        "action_items": list(dict.fromkeys(actions)),
        "topics": list(dict.fromkeys(topics)),
        "intents": list(dict.fromkeys(intents)),
        "risks": list(dict.fromkeys(risks)),
        "next_steps": list(dict.fromkeys(actions)),
        "sentiment": "positive" if any(word in text for word in ["agreed", "aligned", "move forward"]) else None,
        "stage_signal": "poc_agreed" if "poc" in text or "pilot" in text else None,
        "meeting_outcome": "completed",
    }


def _fallback_followup_email_draft(
    *,
    contact_name: str,
    company_name: str,
    meeting_title: str,
    summary: str,
    action_items: list[str],
    next_steps: list[str],
) -> str:
    greeting_name = contact_name.strip() or "team"
    bullets = action_items[:3] or next_steps[:3]
    bullet_lines = "\n".join(f"- {item}" for item in bullets if item.strip())
    summary_text = summary.strip() or f"Thanks again for the discussion around {meeting_title}."
    body = [
        f"Hi {greeting_name},",
        "",
        f"Thanks again for the time today. It was great speaking with you and the {company_name} team.",
        "",
        summary_text,
        "",
    ]
    if bullet_lines:
        body.extend(
            [
                "Recap and next steps:",
                bullet_lines,
                "",
            ]
        )
    body.extend(
        [
            "Let me know if I missed anything or if you'd like us to adjust the next step.",
            "",
            "Best,",
            "Beacon",
        ]
    )
    return "\n".join(body).strip()


async def _build_followup_email_draft(
    *,
    contact_name: str,
    company_name: str,
    meeting_title: str,
    summary: str,
    action_items: list[str],
    next_steps: list[str],
) -> str:
    ai = AzureOpenAIClient()
    bullets = [item.strip() for item in [*action_items, *next_steps] if isinstance(item, str) and item.strip()]
    bullet_text = "\n".join(f"- {item}" for item in bullets[:5])
    if ai.mock:
        return _fallback_followup_email_draft(
            contact_name=contact_name,
            company_name=company_name,
            meeting_title=meeting_title,
            summary=summary,
            action_items=action_items,
            next_steps=next_steps,
        )

    system = (
        "You are a senior enterprise account executive writing post-meeting recap emails. "
        "Write a concise, professional client-facing follow-up email body only. "
        "Do not invent facts. Keep it crisp, practical, and human."
    )
    user = (
        f"Meeting title: {meeting_title}\n"
        f"Client company: {company_name}\n"
        f"Primary recipient: {contact_name or 'client team'}\n"
        f"Meeting summary: {summary}\n"
        f"Action items / next steps:\n{bullet_text or '- Confirm next steps'}\n\n"
        "Write the email body with:\n"
        "- a thank-you opening\n"
        "- a short recap paragraph\n"
        "- 2-4 bullet points for agreed next steps\n"
        "- a soft closing asking them to confirm or adjust anything\n"
        "Return only the email body."
    )
    draft = await ai.complete(system, user, max_tokens=450)
    if draft and draft.strip():
        return draft.strip()
    return _fallback_followup_email_draft(
        contact_name=contact_name,
        company_name=company_name,
        meeting_title=meeting_title,
        summary=summary,
        action_items=action_items,
        next_steps=next_steps,
    )


def _build_attendee_payloads(attendees: list[dict[str, Any]], contacts: list[Contact]) -> list[dict[str, Any]]:
    contacts_by_email = {_normalize_email(contact.email): contact for contact in contacts if contact.email}
    payloads: list[dict[str, Any]] = []
    for attendee in attendees:
        email = _normalize_email(attendee.get("email"))
        contact = contacts_by_email.get(email)
        payloads.append(
            {
                "name": attendee.get("name"),
                "email": email or None,
                "role": attendee.get("role"),
                "contact_id": str(contact.id) if contact and contact.id else None,
            }
        )
    return payloads


async def _upsert_activity(
    session: AsyncSession,
    *,
    external_source_id: str,
    activity_type: str,
    content: str | None,
    ai_summary: str | None,
    deal_id: UUID | None,
    contact_id: UUID | None,
    event_metadata: dict[str, Any],
) -> tuple[Activity, bool]:
    activity = await _find_activity(session, external_source_id)
    created = activity is None
    if not activity:
        activity = Activity(external_source="tldv", external_source_id=external_source_id)
    activity.type = activity_type
    activity.source = "tldv"
    activity.medium = "meeting"
    activity.content = content
    activity.ai_summary = ai_summary
    activity.deal_id = deal_id
    activity.contact_id = contact_id
    activity.event_metadata = event_metadata
    session.add(activity)
    await session.flush()
    return activity, created


async def sync_tldv_meeting(
    session: AsyncSession,
    *,
    meeting_id: str,
    client: TldvClient | None = None,
    preloaded_meeting: dict[str, Any] | None = None,
    preloaded_transcript: dict[str, Any] | None = None,
    stats: TldvSyncStats | None = None,
) -> dict[str, Any]:
    client = client or TldvClient()
    if client.mock:
        raise ValueError("tl;dv API key is not configured")

    stats = stats or TldvSyncStats()
    meeting_payload = preloaded_meeting or await client.get_meeting(meeting_id)
    if preloaded_transcript is not None:
        transcript_payload = preloaded_transcript
    else:
        try:
            transcript_payload = await client.get_transcript(meeting_id)
        except TldvError as exc:
            transcript_payload = {} if exc.status_code in {403, 404} else None
            if transcript_payload is None:
                raise
    try:
        highlights_payload = await client.get_highlights(meeting_id)
    except TldvError as exc:
        highlights_payload = {} if exc.status_code in {403, 404} else None
        if highlights_payload is None:
            raise
    try:
        recording_url = await client.get_recording_download_url(meeting_id)
    except Exception:
        recording_url = None

    attendees = _extract_attendees(meeting_payload)
    attendee_emails = [
        email
        for email in (_normalize_email(attendee.get("email")) for attendee in attendees)
        if email and _normalize_domain(email.split("@", 1)[1]) not in _internal_domains()
    ]
    attendee_domains = list(
        dict.fromkeys(
            _normalize_domain(email.split("@", 1)[1]) for email in attendee_emails if "@" in email
        )
    )

    matched_contacts = await _match_contacts(session, attendee_emails)
    matched_contact_ids = [contact.id for contact in matched_contacts if contact.id]
    deal = await _match_deal_from_contacts(session, matched_contact_ids)
    company = await session.get(Company, deal.company_id) if deal and deal.company_id else None
    mapped_via_gmail = False

    if not company:
        company = await _match_company_from_domains(session, attendee_domains)
    if not company:
        company = await _match_company_from_title(session, str(meeting_payload.get("name") or ""))
    if not deal:
        deal = await _match_deal_from_title(session, str(meeting_payload.get("name") or ""), company)
        if deal and not company and deal.company_id:
            company = await session.get(Company, deal.company_id)
    if not deal:
        gmail_deal = await _match_recent_gmail_deal(session, attendee_emails)
        if gmail_deal:
            mapped_via_gmail = True
            deal = gmail_deal
            company = await session.get(Company, deal.company_id) if deal.company_id else company

    transcript_text = _transcript_text(transcript_payload)
    highlights_text = _meeting_highlights_text(highlights_payload)
    ai_bundle = await _analyze_meeting_intelligence(
        title=str(meeting_payload.get("name") or "Meeting"),
        transcript_text=transcript_text,
        highlights_text=highlights_text,
        highlights_payload=highlights_payload,
    )
    topics = list(dict.fromkeys([*_meeting_topics(highlights_payload), *(ai_bundle.get("topics") or [])]))
    action_items = list(dict.fromkeys(ai_bundle.get("action_items") or []))
    attendee_payloads = _build_attendee_payloads(attendees, matched_contacts)
    primary_contact = matched_contacts[0] if matched_contacts else None
    primary_external_attendee = next(
        (
            attendee
            for attendee in attendee_payloads
            if isinstance(attendee.get("email"), str)
            and attendee["email"]
            and "@" in attendee["email"]
            and _normalize_domain(attendee["email"].split("@", 1)[1]) not in _internal_domains()
        ),
        None,
    )
    follow_up_contact_name = (
        f"{primary_contact.first_name} {primary_contact.last_name}".strip()
        if primary_contact
        else str((primary_external_attendee or {}).get("name") or "").strip()
    )
    if not follow_up_contact_name:
        follow_up_contact_name = "there"
    follow_up_company_name = company.name if company and company.name else (_extract_title_candidates(str(meeting_payload.get("name") or ""))[:1] or ["the team"])[0]
    follow_up_email_draft = await _build_followup_email_draft(
        contact_name=follow_up_contact_name,
        company_name=follow_up_company_name,
        meeting_title=str(meeting_payload.get("name") or "Meeting"),
        summary=str(ai_bundle.get("summary") or "").strip(),
        action_items=action_items,
        next_steps=list(dict.fromkeys(ai_bundle.get("next_steps") or action_items)),
    )

    meeting = await _find_existing_meeting(session, meeting_id)
    created = meeting is None
    if not meeting:
        meeting = Meeting(title=str(meeting_payload.get("name") or "Meeting"))
    meeting.title = str(meeting_payload.get("name") or meeting.title or "Meeting")
    meeting.external_source = "tldv"
    meeting.external_source_id = meeting_id
    meeting.company_id = company.id if company and company.id else None
    meeting.deal_id = deal.id if deal and deal.id else None
    meeting.scheduled_at = _parse_dt(meeting_payload.get("happenedAt"))
    meeting.status = "completed" if transcript_text or highlights_text else "scheduled"
    meeting.meeting_type = _infer_meeting_type(meeting.title, ai_bundle.get("summary") or "", transcript_text)
    meeting.meeting_url = str(meeting_payload.get("url") or "").strip() or None
    meeting.recording_url = recording_url
    meeting.attendees = attendee_payloads
    meeting.raw_notes = highlights_text or None
    meeting.ai_summary = ai_bundle.get("summary") or None
    meeting.next_steps = "\n".join(ai_bundle.get("next_steps") or action_items) or None
    meeting.research_data = {
        "tldv": {
            "meeting": meeting_payload,
            "transcript": transcript_payload,
            "highlights": highlights_payload,
            "topics": topics,
            "action_items": action_items,
            "intents": ai_bundle.get("intents") or [],
            "risks": ai_bundle.get("risks") or [],
            "sentiment": ai_bundle.get("sentiment"),
            "stage_signal": ai_bundle.get("stage_signal"),
            "meeting_outcome": ai_bundle.get("meeting_outcome"),
            "mapped_via_gmail": mapped_via_gmail,
            "follow_up_email_draft": follow_up_email_draft,
        }
    }
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.flush()

    if created:
        stats.meetings_created += 1
    else:
        stats.meetings_updated += 1

    if deal:
        stats.mapped_to_deal += 1
    elif company:
        stats.mapped_to_company += 1
    else:
        stats.unmapped += 1
    if mapped_via_gmail:
        stats.mapped_via_gmail += 1

    base_metadata = {
        "meeting_id": meeting_id,
        "meeting_url": meeting.meeting_url,
        "recording_url": recording_url,
        "summary": ai_bundle.get("summary"),
        "transcription": transcript_text or None,
        "topics": topics,
        "action_items": action_items,
        "intents": ai_bundle.get("intents") or [],
        "risks": ai_bundle.get("risks") or [],
        "sentiment": ai_bundle.get("sentiment"),
        "stage_signal": ai_bundle.get("stage_signal"),
        "meeting_outcome": ai_bundle.get("meeting_outcome"),
        "attendees": attendee_payloads,
        "mapped_via_gmail": mapped_via_gmail,
        "follow_up_email_draft": follow_up_email_draft,
        "highlights_text": highlights_text or None,
        "highlights": highlights_payload.get("data") if isinstance(highlights_payload, dict) else None,
        "conversation_intelligence": {
            "summary": ai_bundle.get("summary"),
            "transcription": transcript_text or None,
            "topics": topics,
            "action_items": action_items,
            "sentiments": [ai_bundle.get("sentiment")] if ai_bundle.get("sentiment") else [],
        },
    }

    meeting_activity, meeting_activity_created = await _upsert_activity(
        session,
        external_source_id=f"tldv:meeting:{meeting_id}",
        activity_type="meeting",
        content=(
            f"tl;dv meeting synced: {meeting.title}"
            + (f"\nSummary: {ai_bundle.get('summary')}" if ai_bundle.get("summary") else "")
        ),
        ai_summary=ai_bundle.get("summary"),
        deal_id=deal.id if deal and deal.id else None,
        contact_id=primary_contact.id if primary_contact and primary_contact.id else None,
        event_metadata=base_metadata,
    )
    transcript_activity, transcript_activity_created = await _upsert_activity(
        session,
        external_source_id=f"tldv:transcript:{meeting_id}",
        activity_type="transcript",
        content=transcript_text[:12000] if transcript_text else (highlights_text[:4000] if highlights_text else None),
        ai_summary=ai_bundle.get("summary"),
        deal_id=deal.id if deal and deal.id else None,
        contact_id=primary_contact.id if primary_contact and primary_contact.id else None,
        event_metadata=base_metadata,
    )
    stats.activities_created += int(meeting_activity_created) + int(transcript_activity_created)
    stats.activities_updated += int(not meeting_activity_created) + int(not transcript_activity_created)

    await session.commit()

    touched_contact_ids = {contact.id for contact in matched_contacts if contact.id}
    for contact_id in touched_contact_ids:
        await refresh_system_tasks_for_entity(session, "contact", contact_id)
    if deal and deal.id:
        await refresh_system_tasks_for_entity(session, "deal", deal.id)
    await session.commit()

    return {
        "meeting_id": str(meeting.id),
        "external_meeting_id": meeting_id,
        "deal_id": str(deal.id) if deal and deal.id else None,
        "company_id": str(company.id) if company and company.id else None,
        "contact_ids": [str(contact_id) for contact_id in touched_contact_ids],
        "mapped_via_gmail": mapped_via_gmail,
    }


async def sync_tldv_history(
    session: AsyncSession,
    *,
    page_size: int = 10,
    max_pages: int | None = 2,
    lookback_days: int | None = None,
    since: datetime | None = None,
) -> dict[str, Any]:
    """Sync tl;dv meetings.

    When ``since`` is provided (incremental mode) only meetings that happened
    after that timestamp are processed and pagination stops as soon as an older
    meeting is encountered — keeping each run very cheap.

    Falls back to ``lookback_days`` cutoff for full-history runs.
    """
    client = TldvClient()
    if client.mock:
        raise ValueError("tl;dv API key is not configured")

    if not await _is_tldv_sync_enabled(session):
        return {
            "processed": 0,
            "stopped": True,
            "reason": "disabled",
            **TldvSyncStats().as_dict(),
        }

    stats = TldvSyncStats()
    # Incremental: use `since` with a small overlap buffer to avoid missing meetings
    # at the boundary. Full-history: fall back to TLDV_SYNC_LOOKBACK_DAYS.
    if since is not None:
        cutoff = since - timedelta(minutes=2)
        incremental = True
    else:
        cutoff = datetime.utcnow() - timedelta(days=lookback_days or settings.TLDV_SYNC_LOOKBACK_DAYS)
        incremental = False

    page = 1
    processed = 0
    sync_started_at = datetime.utcnow()

    while True:
        if not await _is_tldv_sync_enabled(session):
            return {
                "processed": processed,
                "stopped": True,
                "reason": "disabled_during_run",
                **stats.as_dict(),
            }

        payload = await client.list_meetings(page=page, page_size=page_size)
        results = payload.get("results") or []
        if not results:
            break

        hit_old_meeting = False
        for meeting_payload in results:
            meeting_id = str(meeting_payload.get("id") or "").strip()
            if not meeting_id:
                continue
            happened_at = _parse_dt(meeting_payload.get("happenedAt"))
            if happened_at and happened_at < cutoff:
                if incremental:
                    # tl;dv returns newest-first — once we see something older
                    # than our cutoff we can stop paging entirely
                    hit_old_meeting = True
                    break
                continue
            await sync_tldv_meeting(
                session,
                meeting_id=meeting_id,
                client=client,
                preloaded_meeting=meeting_payload,
                stats=stats,
            )
            processed += 1

        if hit_old_meeting:
            break

        page += 1
        pages = payload.get("pages")
        if max_pages is not None and page > max_pages:
            break
        if isinstance(pages, int) and page > pages:
            break

    return {
        "processed": processed,
        "incremental": incremental,
        "sync_started_at": sync_started_at.isoformat(),
        **stats.as_dict(),
    }
