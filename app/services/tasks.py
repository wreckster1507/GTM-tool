from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import DEAL_STAGES, Deal, DealContact
from app.models.task import Task
from app.models.user import User
from app.repositories.deal import DealRepository
from app.services.account_sourcing import append_company_activity_log
from app.services.company_stage_milestones import record_deal_stage_milestone
from app.services.deal_health import compute_health
from app.services.system_task_actions import get_system_task_action_spec

logger = logging.getLogger(__name__)

STAGE_INDEX = {stage: idx for idx, stage in enumerate(DEAL_STAGES)}


def _normalize(text: str | None) -> str:
    return (text or "").strip().lower()


def _contains_any(text: str, terms: Iterable[str]) -> bool:
    return any(term in text for term in terms)


async def _find_open_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
) -> Task | None:
    result = await session.execute(
        select(Task).where(
            Task.entity_type == entity_type,
            Task.entity_id == entity_id,
            Task.system_key == system_key,
            Task.task_type == "system",
            Task.status == "open",
        )
    )
    return result.scalar_one_or_none()


async def _resolve_task_assignee(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    preferred_role: str | None = None,
) -> tuple[UUID | None, str | None]:
    user_id: UUID | None = None
    if entity_type == "company":
        company = await session.get(Company, entity_id)
        if company:
            user_id = company.assigned_to_id or company.sdr_id
    elif entity_type == "contact":
        contact = await session.get(Contact, entity_id)
        if contact:
            user_id = contact.assigned_to_id or contact.sdr_id
    elif entity_type == "deal":
        deal = await session.get(Deal, entity_id)
        if deal:
            user_id = deal.assigned_to_id

    if not user_id:
        return None, None

    user = await session.get(User, user_id)
    if not user or not user.is_active:
        return None, None
    return user.id, user.role


async def _upsert_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
    title: str,
    description: str,
    priority: str,
    source: str,
    recommended_action: str | None,
    action_payload: dict | None = None,
    assigned_role: str | None = None,
) -> Task:
    assigned_to_id, resolved_role = await _resolve_task_assignee(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        preferred_role=assigned_role,
    )
    existing = await _find_open_system_task(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        system_key=system_key,
    )
    if existing:
        existing.title = title
        existing.description = description
        existing.priority = priority
        existing.source = source
        existing.recommended_action = recommended_action
        existing.action_payload = action_payload
        existing.assigned_role = resolved_role
        existing.assigned_to_id = assigned_to_id
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing

    task = Task(
        entity_type=entity_type,
        entity_id=entity_id,
        task_type="system",
        title=title,
        description=description,
        priority=priority,
        source=source,
        recommended_action=recommended_action,
        action_payload=action_payload,
        system_key=system_key,
        assigned_role=resolved_role,
        assigned_to_id=assigned_to_id,
    )
    session.add(task)
    return task


async def backfill_open_task_assignments(session: AsyncSession) -> None:
    open_tasks = (
        await session.execute(
            select(Task).where(Task.status == "open")
        )
    ).scalars().all()

    for task in open_tasks:
        if task.task_type == "system":
            assigned_to_id, resolved_role = await _resolve_task_assignee(
                session,
                entity_type=task.entity_type,
                entity_id=task.entity_id,
                preferred_role=task.assigned_role,
            )
            if (
                assigned_to_id != task.assigned_to_id
                or resolved_role != task.assigned_role
            ):
                task.assigned_to_id = assigned_to_id
                task.assigned_role = resolved_role
                task.updated_at = datetime.utcnow()
                session.add(task)
            continue

        if task.assigned_to_id or not task.created_by_id:
            continue
        task.assigned_to_id = task.created_by_id
        task.updated_at = datetime.utcnow()
        session.add(task)


async def _resolve_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
    status: str = "completed",
) -> None:
    task = await _find_open_system_task(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        system_key=system_key,
    )
    if not task:
        return
    task.status = status
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    session.add(task)


async def complete_system_task(
    session: AsyncSession,
    task: Task,
    user: User,
) -> dict[str, str]:
    await apply_task_action(session, task, user)
    now = datetime.utcnow()
    task.status = "completed"
    task.accepted_at = now
    task.completed_at = now
    task.updated_at = now
    session.add(task)
    return {"message": "completed"}


def _stage_reached(current_stage: str | None, target_stage: str) -> bool:
    if not current_stage:
        return False
    return STAGE_INDEX.get(current_stage, -1) >= STAGE_INDEX.get(target_stage, 999)


def _activity_signal_text(activity: Activity) -> str:
    metadata = activity.event_metadata if isinstance(activity.event_metadata, dict) else {}
    metadata_text: list[str] = []
    for key in ("summary", "content", "text", "transcription", "thread_latest_message_text", "thread_context_excerpt", "google_doc_transcript"):
        value = metadata.get(key)
        if isinstance(value, str) and value.strip():
            metadata_text.append(_normalize(value))

    for comment in metadata.get("comments") or []:
        if isinstance(comment, dict):
            value = comment.get("content")
            if isinstance(value, str) and value.strip():
                metadata_text.append(_normalize(value))

    fetched_call = metadata.get("fetched_call") if isinstance(metadata.get("fetched_call"), dict) else {}
    for comment in fetched_call.get("comments") or []:
        if isinstance(comment, dict):
            value = comment.get("content")
            if isinstance(value, str) and value.strip():
                metadata_text.append(_normalize(value))
    tag_names = [str(tag.get("name") or "").strip() for tag in fetched_call.get("tags") or [] if isinstance(tag, dict)]
    if tag_names:
        metadata_text.append(_normalize(" ".join(tag_names)))

    for entry in metadata.get("topics") or []:
        if isinstance(entry, dict):
            value = entry.get("name") or entry.get("label") or entry.get("topic")
        else:
            value = entry
        if isinstance(value, str) and value.strip():
            metadata_text.append(_normalize(value))

    for entry in metadata.get("action_items") or metadata.get("items") or []:
        if isinstance(entry, dict):
            value = entry.get("text") or entry.get("title") or entry.get("content")
        else:
            value = entry
        if isinstance(value, str) and value.strip():
            metadata_text.append(_normalize(value))

    conversation_intelligence = metadata.get("conversation_intelligence") if isinstance(metadata.get("conversation_intelligence"), dict) else {}
    if conversation_intelligence:
        for key in ("summary", "transcription"):
            value = conversation_intelligence.get(key)
            if isinstance(value, str) and value.strip():
                metadata_text.append(_normalize(value))
        for entry in conversation_intelligence.get("topics") or []:
            if isinstance(entry, str) and entry.strip():
                metadata_text.append(_normalize(entry))
        for entry in conversation_intelligence.get("action_items") or []:
            if isinstance(entry, str) and entry.strip():
                metadata_text.append(_normalize(entry))
        for entry in conversation_intelligence.get("sentiments") or []:
            if isinstance(entry, str) and entry.strip():
                metadata_text.append(_normalize(entry))

    return " ".join(
        filter(
            None,
            [
                _normalize(activity.ai_summary),
                _normalize(activity.content),
                _normalize(activity.email_subject),
                *metadata_text,
            ],
        )
    )


def _activity_has_conversation_intelligence(activity: Activity) -> bool:
    metadata = activity.event_metadata if isinstance(activity.event_metadata, dict) else {}
    bundle = metadata.get("conversation_intelligence") if isinstance(metadata.get("conversation_intelligence"), dict) else {}
    return bool(
        bundle
        and (
            bundle.get("summary")
            or bundle.get("transcription")
            or bundle.get("topics")
            or bundle.get("action_items")
            or bundle.get("sentiments")
        )
    )


def _health_bucket(score: int) -> str:
    if score >= 70:
        return "green"
    if score >= 40:
        return "yellow"
    return "red"


def _email_domain(value: str | None) -> str:
    email = (value or "").strip().lower()
    if "@" not in email:
        return ""
    return email.split("@", 1)[1]


def _has_security_stakeholder(contacts: list[Contact]) -> bool:
    for contact in contacts:
        signal = " ".join(
            filter(
                None,
                [
                    _normalize(contact.title),
                    _normalize(contact.persona),
                    _normalize(contact.persona_type),
                ],
            )
        )
        if _contains_any(signal, ["security", "procurement", "legal", "compliance", "it"]):
            return True
    return False


def _detect_competitor_signal(text: str) -> str | None:
    known = ["rocketlane", "arrows", "guidecx", "monday", "asana", "wrike", "clickup"]
    for name in known:
        if name in text:
            return name.title()
    if _contains_any(text, ["competitor", "alternative", "vs ", "other vendor"]):
        return "Competitor"
    return None


async def _refresh_company_tasks(session: AsyncSession, entity_id: UUID) -> None:
    company = await session.get(Company, entity_id)
    if not company:
        return

    cache = company.enrichment_cache if isinstance(company.enrichment_cache, dict) else {}
    has_icp = isinstance(cache.get("icp_analysis"), dict)
    contacts = (
        await session.execute(select(Contact.id).where(Contact.company_id == company.id))
    ).scalars().all()

    if not company.enriched_at or company.domain.endswith(".unknown"):
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_re_enrich",
            title="Refresh company enrichment",
            description="This account still has missing or incomplete firmographic data. Re-run enrichment to update the account profile.",
            priority="high" if company.domain.endswith(".unknown") else "medium",
            source="system",
            recommended_action="re_enrich_company",
            action_payload={"company_id": str(company.id)},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_re_enrich")

    if not has_icp or not company.icp_score:
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_refresh_icp",
            title="Refresh ICP research",
            description="Beacon does not yet have a usable ICP decision layer for this account. Refresh research to update fit, timing, and messaging.",
            priority="medium",
            source="system",
            recommended_action="refresh_icp_research",
            action_payload={"company_id": str(company.id)},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_refresh_icp")

    if not contacts:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_find_stakeholders", status="dismissed")
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_upload_prospects",
            title="Upload prospects for this account",
            description="Company research is temporarily not sourcing contacts automatically. Upload a prospect CSV from Prospecting to attach the right stakeholders to this account.",
            priority="medium",
            source="system",
            recommended_action=None,
            action_payload={"company_id": str(company.id), "company_name": company.name, "next_step": "upload_prospect_csv"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_find_stakeholders", status="dismissed")
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_upload_prospects")


async def _refresh_contact_tasks(session: AsyncSession, entity_id: UUID) -> None:
    contact = await session.get(Contact, entity_id)
    if not contact:
        return

    linked_deal = (
        await session.execute(select(DealContact.deal_id).where(DealContact.contact_id == contact.id))
    ).first()
    has_deal = bool(linked_deal)

    sequence_text = " ".join(
        part for part in [
            _normalize(contact.sequence_status),
            _normalize(contact.instantly_status),
            _normalize(contact.enrichment_data.get("tracking_stage") if isinstance(contact.enrichment_data, dict) else None),
        ]
        if part
    )

    # ── Pull recent Instantly email activity ──────────────────────────────────
    instantly_rows = (
        await session.execute(
            select(Activity)
            .where(
                Activity.contact_id == contact.id,
                Activity.source == "instantly",
            )
            .order_by(Activity.created_at.desc())
            .limit(20)
        )
    ).scalars().all()
    latest_reply = next((a for a in instantly_rows if "reply" in (a.content or "").lower() or a.type == "email_reply"), None)
    latest_open = next((a for a in instantly_rows if "opened" in (a.content or "").lower()), None)
    latest_bounce = next((a for a in instantly_rows if "bounce" in (a.content or "").lower()), None)
    latest_interested = next((a for a in instantly_rows if "interested" in (a.content or "").lower() and "not interested" not in (a.content or "").lower()), None)
    latest_unsubscribed = next((a for a in instantly_rows if "unsubscribed" in (a.content or "").lower()), None)

    seq_status = _normalize(contact.sequence_status)
    has_recent_reply = bool(latest_reply and latest_reply.created_at >= datetime.utcnow() - timedelta(days=7))
    has_recent_open = bool(latest_open and latest_open.created_at >= datetime.utcnow() - timedelta(days=3))
    has_recent_interested = bool(latest_interested and latest_interested.created_at >= datetime.utcnow() - timedelta(days=5))
    is_bounced = bool(latest_bounce or seq_status == "bounced")
    is_unsubscribed = bool(latest_unsubscribed or seq_status == "unsubscribed")
    is_not_interested = seq_status == "not_interested"

    if not contact.phone and bool(contact.email):
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_refresh_data",
            title="Refresh prospect contact data",
            description="This prospect is active but still missing a phone number. Re-enrich the record to try to pull fresh contact details.",
            priority="medium",
            source="system",
            recommended_action="re_enrich_contact",
            action_payload={"contact_id": str(contact.id)},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_refresh_data")

    aircall_rows = (
        await session.execute(
            select(Activity)
            .where(
                Activity.contact_id == contact.id,
                Activity.source == "aircall",
                Activity.type.in_(["call", "note", "transcript"]),
            )
            .order_by(Activity.created_at.desc())
            .limit(12)
        )
    ).scalars().all()
    tldv_rows = (
        await session.execute(
            select(Activity)
            .where(
                Activity.contact_id == contact.id,
                Activity.source == "tldv",
                Activity.type.in_(["meeting", "transcript", "note"]),
            )
            .order_by(Activity.created_at.desc())
            .limit(8)
        )
    ).scalars().all()
    latest_answered_call = next((activity for activity in aircall_rows if activity.call_outcome == "answered"), None)
    latest_missed_call = next((activity for activity in aircall_rows if activity.call_outcome == "missed"), None)
    latest_voicemail = next((activity for activity in aircall_rows if activity.call_outcome == "voicemail"), None)
    aircall_signal_text = " ".join(filter(None, (_activity_signal_text(activity) for activity in aircall_rows[:6])))
    tldv_signal_text = " ".join(filter(None, (_activity_signal_text(activity) for activity in tldv_rows[:4])))
    recent_tldv_meeting = next(
        (activity for activity in tldv_rows if activity.created_at >= datetime.utcnow() - timedelta(days=7)),
        None,
    )
    latest_answered_call_has_intelligence = bool(
        latest_answered_call
        and any(
            activity.call_id
            and latest_answered_call.call_id
            and activity.call_id == latest_answered_call.call_id
            and _activity_has_conversation_intelligence(activity)
            for activity in aircall_rows
        )
    )

    has_recent_answered_call = bool(
        latest_answered_call
        and latest_answered_call.created_at >= datetime.utcnow() - timedelta(days=3)
        and (
            (latest_answered_call.call_duration or 0) >= 90
            or latest_answered_call_has_intelligence
        )
    )
    has_recent_missed_call = bool(
        latest_missed_call
        and latest_missed_call.created_at >= datetime.utcnow() - timedelta(days=2)
        and (not latest_answered_call or latest_answered_call.created_at < latest_missed_call.created_at)
    )
    has_recent_voicemail = bool(
        latest_voicemail
        and latest_voicemail.created_at >= datetime.utcnow() - timedelta(days=2)
        and (not latest_answered_call or latest_answered_call.created_at < latest_voicemail.created_at)
    )
    has_call_progress_signal = bool(
        aircall_signal_text
        and _contains_any(aircall_signal_text, ["meeting", "demo", "workshop", "poc", "pilot"])
        and _contains_any(aircall_signal_text, ["schedule", "scheduled", "agreed", "book", "next week", "move forward"])
    )
    has_tldv_progress_signal = bool(
        recent_tldv_meeting
        and (
            _contains_any(tldv_signal_text, ["meeting", "demo", "workshop", "poc", "pilot", "pricing", "proposal"])
            or _activity_has_conversation_intelligence(recent_tldv_meeting)
        )
    )

    if (
        (("meeting_booked" in sequence_text or "meeting booked" in sequence_text) or has_call_progress_signal or has_tldv_progress_signal)
        and not has_deal
    ):
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_convert_to_deal",
            title="Convert meeting-ready prospect into a deal",
            description="Beacon sees a strong meeting, demo, or POC signal on this prospect. Convert it into a deal so the opportunity can move through the board.",
            priority="high",
            source="tldv" if has_tldv_progress_signal else ("aircall" if has_call_progress_signal else "instantly"),
            recommended_action="convert_contact_to_deal",
            action_payload={"contact_id": str(contact.id), "stage": "demo_done"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_convert_to_deal")

    # Reactive call/voicemail tasks should clear automatically once the
    # sequence has moved past the point of cold follow-up — otherwise reps
    # keep getting nagged to "retry the missed call" after the meeting is
    # already booked, the prospect unsubscribed, or the email bounced.
    terminal_sequence_states = {"meeting_booked", "interested", "not_interested", "unsubscribed", "bounced"}
    is_terminal_seq = seq_status in terminal_sequence_states

    if not has_deal and not is_terminal_seq and has_recent_missed_call:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_retry_call",
            title="Retry the missed call",
            description="Aircall logged a missed connection with this prospect. Retry the call or follow up while the context is still fresh.",
            priority="high",
            source="aircall",
            recommended_action="retry_contact_call",
            action_payload={"contact_id": str(contact.id), "next_step": "retry_call"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_retry_call", status="dismissed")

    if not has_deal and not is_terminal_seq and has_recent_voicemail:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_voicemail_follow_up",
            title="Follow up on the voicemail",
            description="A voicemail was left for this prospect. Send a short follow-up note that references the call and proposes the next step.",
            priority="medium",
            source="aircall",
            recommended_action="follow_up_voicemail",
            action_payload={"contact_id": str(contact.id), "next_step": "follow_up_voicemail"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_voicemail_follow_up", status="dismissed")

    if not has_deal and (has_recent_answered_call or recent_tldv_meeting):
        recap_description = "Beacon sees a connected buyer conversation here. Send a short recap and confirm the next step while the context is still fresh."
        recap_source = "tldv" if recent_tldv_meeting else "aircall"
        recap_title = "Send post-meeting recap" if recent_tldv_meeting else "Send a post-call recap"
        if latest_answered_call_has_intelligence:
            latest_signal = _activity_signal_text(latest_answered_call)
            if latest_signal:
                recap_description = (
                    "Beacon pulled Aircall call intelligence for this conversation. "
                    "Send a recap and confirm the next step while the details are fresh."
                )
        elif recent_tldv_meeting:
            recap_description = (
                "Beacon pulled tl;dv meeting intelligence for this prospect. "
                "Send a post-meeting recap and confirm the next step while the details are still fresh."
            )
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_send_call_recap",
            title=recap_title,
            description=recap_description,
            priority="medium",
            source=recap_source,
            recommended_action="send_contact_call_recap",
            action_payload={"contact_id": str(contact.id), "next_step": "send_call_recap"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_send_call_recap", status="dismissed")

    # ── Email / Instantly signal tasks ───────────────────────────────────────

    # Reply received → follow up on the reply thread (high priority, Beacon can draft)
    if not has_deal and has_recent_reply and seq_status not in {"meeting_booked", "interested"}:
        reply_content = (latest_reply.content or "") if latest_reply else ""
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_follow_up_reply",
            title="Follow up on email reply",
            description=(
                f"This prospect replied to an outreach email. Review their reply and send a personalised follow-up to keep momentum."
                + (f"\n\nReply excerpt: {reply_content[:300]}" if reply_content else "")
            ),
            priority="high",
            source="instantly",
            recommended_action="draft_reply_follow_up",
            action_payload={"contact_id": str(contact.id), "reply_excerpt": reply_content[:300], "next_step": "reply_to_prospect"},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_follow_up_reply", status="dismissed")

    # Interested signal → book a call / meeting (very high priority, convert to deal soon)
    if not has_deal and has_recent_interested:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_book_call_from_interest",
            title="Book a call — prospect expressed interest",
            description="Instantly flagged this prospect as Interested. Strike while it's hot — propose a discovery or demo call.",
            priority="high",
            source="instantly",
            recommended_action="book_call_from_interest",
            action_payload={"contact_id": str(contact.id), "next_step": "book_call"},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_book_call_from_interest", status="dismissed")

    # Email opened (no reply yet) → send a targeted follow-up while attention is there
    if (
        not has_deal
        and has_recent_open
        and not has_recent_reply
        and seq_status not in {"replied", "meeting_booked", "interested", "not_interested", "unsubscribed", "bounced"}
    ):
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_follow_up_after_open",
            title="Send a follow-up — prospect opened the email",
            description="This prospect opened an outreach email but hasn't replied yet. Send a short, personalised follow-up to spark a conversation.",
            priority="medium",
            source="instantly",
            recommended_action="draft_open_follow_up",
            action_payload={"contact_id": str(contact.id), "next_step": "send_follow_up"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_follow_up_after_open", status="dismissed")

    # Bounced email → fix the email address
    if is_bounced:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_fix_bounced_email",
            title="Fix bounced email address",
            description="An outreach email bounced for this prospect. Re-enrich the contact to find a valid email or mark the record as unreachable.",
            priority="high",
            source="instantly",
            recommended_action="re_enrich_contact",
            action_payload={"contact_id": str(contact.id)},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_fix_bounced_email")

    # Unsubscribed → update CRM status, stop all outreach
    if is_unsubscribed:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_mark_unsubscribed",
            title="Mark prospect as unsubscribed and pause outreach",
            description="This prospect unsubscribed from the email sequence. Update the CRM status and ensure no further automated outreach is sent.",
            priority="medium",
            source="instantly",
            recommended_action="mark_contact_unsubscribed",
            action_payload={"contact_id": str(contact.id)},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_mark_unsubscribed")

    # Not interested → log it and decide whether to nurture or close
    if is_not_interested and not has_deal:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_handle_not_interested",
            title="Prospect is not interested — review and decide next step",
            description="Instantly flagged this prospect as Not Interested. Decide whether to nurture long-term, reassign, or close the record.",
            priority="low",
            source="instantly",
            recommended_action="close_not_interested_contact",
            action_payload={"contact_id": str(contact.id)},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_handle_not_interested")


def _deal_signal_task(text: str, current_stage: str) -> tuple[str, str, str] | None:
    if not _stage_reached(current_stage, "poc_done") and (
        ("poc" in text or "proof of concept" in text or "pilot" in text)
        and _contains_any(text, ["complete", "completed", "finished", "done", "wrapped up", "successful"])
    ):
        return (
            "poc_done",
            "Move deal to POC Done",
            "The latest conversation suggests the POC or pilot is complete. Move the deal forward so the stage matches reality.",
        )
    if not _stage_reached(current_stage, "poc_agreed") and (
        ("poc" in text or "proof of concept" in text or "pilot" in text)
        and _contains_any(text, ["agree", "agreed", "approved", "move forward", "green light", "aligned"])
    ):
        return (
            "poc_agreed",
            "Move deal to POC Agreed",
            "Buyer language indicates alignment on a POC or pilot. Move the deal forward to keep the board accurate.",
        )
    if not _stage_reached(current_stage, "msa_review") and _contains_any(
        text,
        ["msa", "master services agreement", "legal review", "redline", "procurement", "security review"],
    ):
        return (
            "msa_review",
            "Move deal to MSA Review",
            "Recent communication suggests legal, procurement, or paper-process work has started. Update the stage to MSA Review.",
        )
    if not _stage_reached(current_stage, "commercial_negotiation") and _contains_any(
        text,
        ["pricing", "proposal", "commercial terms", "quote", "budget review", "negotiat"],
    ):
        return (
            "commercial_negotiation",
            "Move deal to Commercial Negotiation",
            "The latest buyer signal looks commercial. Move the deal into negotiation so the pipeline reflects what the team is discussing.",
        )
    if not _stage_reached(current_stage, "workshop") and _contains_any(
        text,
        ["workshop", "discovery workshop", "working session"],
    ) and _contains_any(text, ["schedule", "agreed", "book", "set up"]):
        return (
            "workshop",
            "Move deal to Workshop",
            "The buyer is aligning on a workshop or working session. Move the deal so the next motion is visible.",
        )
    return None


def _deal_signal_task_from_intent(intent_key: str | None, current_stage: str) -> tuple[str, str, str] | None:
    if not intent_key:
        return None
    if not intent_key.startswith("move_deal_stage:"):
        return None
    target_stage = intent_key.split(":", 1)[1]
    stage_copy = {
        "poc_agreed": (
            "Move deal to POC Agreed",
            "The latest buyer thread indicates alignment on a POC or pilot. Move the deal forward so the board stays accurate.",
        ),
        "poc_wip": (
            "Move deal to POC WIP",
            "The latest buyer thread sounds like the POC is underway. Update the deal stage so execution is visible.",
        ),
        "poc_done": (
            "Move deal to POC Done",
            "The latest buyer thread indicates the POC is complete. Reflect that progress in the pipeline before the next commercial step.",
        ),
        "commercial_negotiation": (
            "Move deal to Commercial Negotiation",
            "The latest buyer thread is now commercial in nature. Move the deal so pricing and terms are tracked in the right stage.",
        ),
        "msa_review": (
            "Move deal to MSA Review",
            "The latest buyer thread indicates legal, security, or procurement review is underway. Update the stage to match the current motion.",
        ),
        "workshop": (
            "Move deal to Workshop",
            "The latest buyer thread is coordinating a workshop or working session. Move the deal so the next motion is visible.",
        ),
        "closed_won": (
            "Move deal to Closed Won",
            "The latest buyer thread signals the deal is moving forward with Beacon. Mark it correctly so the board and forecast stay trustworthy.",
        ),
        "not_a_fit": (
            "Move deal to Not a Fit",
            "The latest buyer thread indicates this is no longer moving forward. Update the deal so the pipeline reflects reality.",
        ),
    }
    if target_stage not in stage_copy or _stage_reached(current_stage, target_stage):
        return None
    title, description = stage_copy[target_stage]
    return target_stage, title, description


async def _refresh_deal_tasks(session: AsyncSession, entity_id: UUID) -> None:
    deal = await session.get(Deal, entity_id)
    if not deal:
        return

    activity_rows = (
        await session.execute(
            select(Activity)
            .where(
                Activity.deal_id == deal.id,
                Activity.type.in_(["email", "call", "note", "transcript", "meeting"]),
            )
            .order_by(Activity.created_at.desc())
            .limit(25)
        )
    ).scalars().all()

    linked_contacts = (
        await session.execute(
            select(Contact)
            .join(DealContact, DealContact.contact_id == Contact.id)
            .where(DealContact.deal_id == deal.id)
        )
    ).scalars().all()
    deal.stakeholder_count = len({contact.id for contact in linked_contacts if contact.id})
    deal.last_activity_at = max((activity.created_at for activity in activity_rows), default=deal.last_activity_at)

    created_keys: set[str] = set()
    legal_signal = False
    pricing_pushback = False
    legal_signal_source = "system"
    pricing_pushback_source = "system"
    competitor_name: str | None = None
    competitor_source = "system"
    reschedule_mentions = 0
    pricing_request = False
    pricing_request_source = "system"
    workshop_signal = False
    workshop_signal_source = "system"
    latest_answered_call = next((activity for activity in activity_rows if activity.source == "aircall" and activity.call_outcome == "answered"), None)
    latest_missed_call = next((activity for activity in activity_rows if activity.source == "aircall" and activity.call_outcome == "missed"), None)
    latest_voicemail = next((activity for activity in activity_rows if activity.source == "aircall" and activity.call_outcome == "voicemail"), None)
    latest_tldv_meeting = next((activity for activity in activity_rows if activity.source == "tldv" and activity.type in ["meeting", "transcript"]), None)
    latest_answered_call_has_intelligence = bool(
        latest_answered_call
        and any(
            activity.call_id
            and latest_answered_call.call_id
            and activity.call_id == latest_answered_call.call_id
            and _activity_has_conversation_intelligence(activity)
            for activity in activity_rows
        )
    )
    move_recommendation_created = False
    latest_email_activity_ids_by_thread: set[UUID] = set()
    seen_email_threads: set[str] = set()
    for activity in activity_rows:
        if activity.type != "email" or not activity.id:
            continue
        metadata = activity.event_metadata if isinstance(activity.event_metadata, dict) else {}
        thread_id = str(metadata.get("gmail_thread_id") or "").strip()
        if not thread_id or thread_id in seen_email_threads:
            continue
        seen_email_threads.add(thread_id)
        latest_email_activity_ids_by_thread.add(activity.id)

    for activity in activity_rows:
        metadata = activity.event_metadata if isinstance(activity.event_metadata, dict) else {}
        thread_id = str(metadata.get("gmail_thread_id") or "").strip()
        if activity.type == "email" and thread_id and activity.id not in latest_email_activity_ids_by_thread:
            continue

        text = _activity_signal_text(activity)
        if not text:
            continue
        latest_thread_intent = str(metadata.get("thread_latest_intent") or "").strip() or None
        suggestion = _deal_signal_task_from_intent(latest_thread_intent, deal.stage) or _deal_signal_task(text, deal.stage)
        if suggestion and not move_recommendation_created:
            target_stage, title, description = suggestion
            system_key = f"deal_move_{target_stage}"
            created_keys.add(system_key)
            await _upsert_system_task(
                session,
                entity_type="deal",
                entity_id=deal.id,
                system_key=system_key,
                title=title,
                description=description,
                priority="high" if target_stage in {"poc_agreed", "msa_review"} else "medium",
                source=activity.source or "system",
                recommended_action="move_deal_stage",
                action_payload={
                    "deal_id": str(deal.id),
                    "stage": target_stage,
                    "activity_id": str(activity.id),
                },
                assigned_role="ae",
            )
            move_recommendation_created = True

        if latest_thread_intent == "move_deal_stage:msa_review" or _contains_any(text, ["security review", "security questionnaire", "procurement", "legal review", "msa", "redline"]):
            legal_signal = True
            legal_signal_source = activity.source or legal_signal_source
        if _contains_any(text, ["too expensive", "budget is tight", "budget constraint", "price is high", "discount", "cost concern"]):
            pricing_pushback = True
            pricing_pushback_source = activity.source or pricing_pushback_source
        detected_competitor = _detect_competitor_signal(text)
        if not competitor_name and detected_competitor:
            competitor_name = detected_competitor
            competitor_source = activity.source or competitor_source
        if "reschedul" in text:
            reschedule_mentions += 1
        if latest_thread_intent == "send_pricing_package" or (_contains_any(text, ["pricing", "proposal", "quote"]) and _contains_any(text, ["send", "share", "review", "please"])):
            pricing_request = True
            pricing_request_source = activity.source or pricing_request_source
        if latest_thread_intent == "book_workshop_session" or _contains_any(text, ["workshop", "working session", "technical deep dive", "implementation session"]):
            workshop_signal = True
            workshop_signal_source = activity.source or workshop_signal_source

        for item in metadata.get("suggested_existing_contacts") or []:
            contact_id = str(item.get("contact_id") or "").strip()
            email = str(item.get("email") or "").strip().lower()
            if not contact_id:
                continue
            system_key = f"deal_attach_contact_{contact_id}"
            if system_key in created_keys:
                continue
            created_keys.add(system_key)
            await _upsert_system_task(
                session,
                entity_type="deal",
                entity_id=deal.id,
                system_key=system_key,
                title="Attach stakeholder already seen in email",
                description=f"{email} is already in Beacon and appeared on a buyer thread. Attach them to this deal to keep stakeholder mapping current.",
                priority="medium",
                source="gmail_sync",
                recommended_action="attach_contact_to_deal",
                action_payload={
                    "deal_id": str(deal.id),
                    "contact_id": contact_id,
                    "activity_id": str(activity.id),
                },
                assigned_role="ae",
            )

        for participant in metadata.get("suggested_new_participants") or []:
            email = str(participant.get("email") or "").strip().lower()
            if not email:
                continue
            system_key = f"deal_add_contact_{email.replace('@', '_at_').replace('.', '_dot_')}"
            if system_key in created_keys:
                continue
            created_keys.add(system_key)
            await _upsert_system_task(
                session,
                entity_type="deal",
                entity_id=deal.id,
                system_key=system_key,
                title="Add new stakeholder from buyer thread",
                description=f"{participant.get('display_name') or email} appeared on a synced email thread. Create the contact and attach them to this deal so the team keeps full stakeholder coverage.",
                priority="high",
                source="gmail_sync",
                recommended_action="create_contact_and_attach_to_deal",
                action_payload={
                    "deal_id": str(deal.id),
                    "company_id": str(deal.company_id) if deal.company_id else None,
                    "email": email,
                    "first_name": participant.get("first_name"),
                    "last_name": participant.get("last_name"),
                    "display_name": participant.get("display_name"),
                    "activity_id": str(activity.id),
                },
                assigned_role="ae",
            )

    if pricing_request:
        created_keys.add("deal_send_pricing")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_send_pricing",
            title="Send pricing or commercial package",
            description="Recent buyer language suggests they want pricing, a quote, or commercial terms. Send the commercial package and keep the thread moving.",
            priority="high",
            source=pricing_request_source,
            recommended_action="send_pricing_package",
            action_payload={"deal_id": str(deal.id), "next_step": "send_pricing"},
            assigned_role="ae",
        )

    if workshop_signal and not _stage_reached(deal.stage, "workshop"):
        created_keys.add("deal_book_workshop")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_book_workshop",
            title="Book the technical workshop",
            description="Buyer activity points to a workshop or working session. Lock in the session and make sure the right technical stakeholders are present.",
            priority="medium",
            source=workshop_signal_source,
            recommended_action="book_workshop_session",
            action_payload={"deal_id": str(deal.id), "next_step": "book_workshop"},
            assigned_role="ae",
        )

    if legal_signal and not _has_security_stakeholder(linked_contacts):
        created_keys.add("deal_add_security_contact")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_add_security_contact",
            title="Add a legal or security stakeholder",
            description="The thread mentions legal, procurement, or security review, but this deal does not yet show a clear owner for that motion. Add the right stakeholder before the paper process slows down.",
            priority="high",
            source=legal_signal_source,
            recommended_action=None,
            action_payload={"deal_id": str(deal.id), "next_step": "add_security_contact"},
            assigned_role="ae",
        )

    if latest_missed_call and latest_missed_call.created_at >= datetime.utcnow() - timedelta(days=2) and (
        not latest_answered_call or latest_answered_call.created_at < latest_missed_call.created_at
    ):
        created_keys.add("deal_retry_call")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_retry_call",
            title="Retry the missed call",
            description="Aircall logged a missed buyer call on this deal. Retry the call or send a short follow-up before the thread goes cold.",
            priority="high",
            source="aircall",
            recommended_action="retry_deal_call",
            action_payload={"deal_id": str(deal.id), "next_step": "retry_call"},
            assigned_role="ae",
        )

    if latest_voicemail and latest_voicemail.created_at >= datetime.utcnow() - timedelta(days=2) and (
        not latest_answered_call or latest_answered_call.created_at < latest_voicemail.created_at
    ):
        created_keys.add("deal_voicemail_follow_up")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_voicemail_follow_up",
            title="Follow up on the voicemail",
            description="A voicemail was left on this deal. Follow up while the call attempt is still fresh and reference the message if needed.",
            priority="medium",
            source="aircall",
            recommended_action="follow_up_deal_voicemail",
            action_payload={"deal_id": str(deal.id), "next_step": "follow_up_voicemail"},
            assigned_role="ae",
        )

    if latest_answered_call and latest_answered_call.created_at >= datetime.utcnow() - timedelta(days=3) and (
        (latest_answered_call.call_duration or 0) >= 90
        or latest_answered_call_has_intelligence
    ):
        created_keys.add("deal_send_call_recap")
        recap_description = "Beacon sees a connected Aircall conversation on this deal. Send a recap, confirm the next step, and capture momentum while the call is fresh."
        if latest_answered_call_has_intelligence:
            recap_description = (
                "Beacon pulled Aircall call intelligence for this deal. "
                "Send a recap, confirm the buyer's next step, and keep the momentum explicit."
            )
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_send_call_recap",
            title="Send a post-call recap",
            description=recap_description,
            priority="medium",
            source="aircall",
            recommended_action="send_deal_call_recap",
            action_payload={"deal_id": str(deal.id), "next_step": "send_call_recap"},
            assigned_role="ae",
        )

    if latest_tldv_meeting and latest_tldv_meeting.created_at >= datetime.utcnow() - timedelta(days=4):
        created_keys.add("deal_send_meeting_recap")
        tldv_metadata = latest_tldv_meeting.event_metadata if isinstance(latest_tldv_meeting.event_metadata, dict) else {}
        follow_up_email_draft = str(tldv_metadata.get("follow_up_email_draft") or "").strip() or None
        meeting_summary = str(tldv_metadata.get("summary") or latest_tldv_meeting.ai_summary or "").strip() or None
        action_items = [
            str(item).strip()
            for item in (tldv_metadata.get("action_items") or [])
            if isinstance(item, str) and str(item).strip()
        ]
        meeting_title = str(tldv_metadata.get("meeting_title") or "").strip() or None
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_send_meeting_recap",
            title="Send post-meeting follow-up",
            description=(
                "tl;dv shows a recent customer meeting on this deal. "
                "Beacon prepared a follow-up draft from the meeting summary and transcript so the rep can send it faster."
            ),
            priority="high",
            source="tldv",
            recommended_action="send_meeting_follow_up",
            action_payload={
                "deal_id": str(deal.id),
                "next_step": "send_meeting_follow_up",
                "meeting_title": meeting_title,
                "meeting_summary": meeting_summary,
                "action_items": action_items,
                "follow_up_email_draft": follow_up_email_draft,
            },
            assigned_role="ae",
        )

    internal_domain = _email_domain(settings.GMAIL_SHARED_INBOX or "zippy@beacon.li")
    recent_internal = next((activity for activity in activity_rows if _email_domain(activity.email_from) == internal_domain), None)
    recent_external = next((activity for activity in activity_rows if _email_domain(activity.email_from) != internal_domain), None)
    if recent_internal and (
        recent_external is None or recent_external.created_at < recent_internal.created_at
    ) and recent_internal.created_at < datetime.utcnow() - timedelta(days=5):
        created_keys.add("deal_follow_up")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_follow_up",
            title="Follow up on the buyer thread",
            description="Beacon sees an outbound email with no newer buyer reply for 5+ days. Send a follow-up so the deal does not stall quietly.",
            priority="high",
            source="system",
            recommended_action="follow_up_buyer_thread",
            action_payload={"deal_id": str(deal.id), "next_step": "follow_up"},
            assigned_role="ae",
        )

    if pricing_pushback:
        created_keys.add("deal_pricing_pushback")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_pricing_pushback",
            title="Handle pricing pushback",
            description="Buyer language indicates budget or pricing resistance. Adjust the commercial narrative or bring stronger ROI proof before the deal cools.",
            priority="high",
            source=pricing_pushback_source,
            recommended_action=None,
            action_payload={"deal_id": str(deal.id), "next_step": "handle_pricing_pushback"},
            assigned_role="ae",
        )

    if competitor_name:
        created_keys.add("deal_competitor_risk")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_competitor_risk",
            title="Prepare competitor response",
            description=f"Buyer activity mentions {competitor_name}. Queue the right battlecard or differentiation points before the next reply.",
            priority="medium",
            source=competitor_source,
            recommended_action=None,
            action_payload={"deal_id": str(deal.id), "competitor": competitor_name},
            assigned_role="ae",
        )

    base_score, _ = compute_health(deal, activity_rows)
    score = base_score
    if any(key in created_keys for key in {"deal_move_poc_agreed", "deal_move_commercial_negotiation", "deal_move_workshop"}):
        score += 6
    if latest_answered_call and latest_answered_call.created_at >= datetime.utcnow() - timedelta(days=3) and (
        (latest_answered_call.call_duration or 0) >= 90
        or latest_answered_call_has_intelligence
    ):
        score += 4
    if legal_signal:
        score -= 4
    if pricing_pushback:
        score -= 12
    if competitor_name:
        score -= 10
    if "deal_retry_call" in created_keys:
        score -= 6
    if "deal_voicemail_follow_up" in created_keys:
        score -= 3
    if reschedule_mentions >= 2:
        score -= 8
        created_keys.add("deal_reschedule_risk")
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key="deal_reschedule_risk",
            title="Stabilize repeated reschedules",
            description="Recent communication includes multiple reschedules. Confirm urgency, tighten the next-step owner, and protect momentum.",
            priority="medium",
            source="gmail_sync",
            recommended_action=None,
            action_payload={"deal_id": str(deal.id)},
            assigned_role="ae",
        )
    if "deal_follow_up" in created_keys:
        score -= 14

    score = max(0, min(score, 100))
    deal.health_score = score
    deal.health = _health_bucket(score)
    session.add(deal)

    managed_prefixes = (
        "deal_move_",
        "deal_attach_contact_",
        "deal_add_contact_",
        "deal_send_pricing",
        "deal_book_workshop",
        "deal_add_security_contact",
        "deal_retry_call",
        "deal_voicemail_follow_up",
        "deal_send_call_recap",
        "deal_send_meeting_recap",
        "deal_follow_up",
        "deal_pricing_pushback",
        "deal_competitor_risk",
        "deal_reschedule_risk",
    )
    open_system_tasks = (
        await session.execute(
            select(Task).where(
                Task.entity_type == "deal",
                Task.entity_id == deal.id,
                Task.task_type == "system",
                Task.status == "open",
            )
        )
    ).scalars().all()
    for system_task in open_system_tasks:
        if not system_task.system_key:
            continue
        if not system_task.system_key.startswith(managed_prefixes):
            continue
        if system_task.system_key in created_keys:
            continue
        if system_task.system_key.startswith("deal_move_") and _stage_reached(deal.stage, system_task.system_key.replace("deal_move_", "")):
            await _resolve_system_task(session, entity_type="deal", entity_id=deal.id, system_key=system_task.system_key)
            continue
        await _resolve_system_task(session, entity_type="deal", entity_id=deal.id, system_key=system_task.system_key, status="dismissed")


async def refresh_system_tasks_for_entity(session: AsyncSession, entity_type: str, entity_id: UUID) -> None:
    if entity_type == "company":
        await _refresh_company_tasks(session, entity_id)
    elif entity_type == "contact":
        await _refresh_contact_tasks(session, entity_id)
    elif entity_type == "deal":
        await _refresh_deal_tasks(session, entity_id)


async def apply_task_action(
    session: AsyncSession,
    task: Task,
    user: User,
) -> dict[str, str]:
    payload = task.action_payload if isinstance(task.action_payload, dict) else {}
    action = task.recommended_action
    action_spec = get_system_task_action_spec(action)
    actor_id = user.id
    actor_name = user.name
    actor_email = user.email
    execution_label = "accepted Beacon task"
    execution_prefix = "Accepted system task"

    if action and action_spec is None:
        logger.warning("Unknown system task action encountered: %s", action)

    if action == "move_deal_stage":
        deal_id = UUID(str(payload["deal_id"]))
        stage = str(payload["stage"])
        repo = DealRepository(session)
        deal = await repo.get_or_raise(deal_id)
        previous_stage = deal.stage
        await repo.update(
            deal,
            {
                "stage": stage,
                "stage_entered_at": datetime.utcnow(),
                "days_in_stage": 0,
                "updated_at": datetime.utcnow(),
            },
        )
        session.add(
            Activity(
                deal_id=deal_id,
                type="stage_change",
                source="system_task",
                content=f"Stage moved from {previous_stage} to {stage} via {execution_label}",
                created_by_id=actor_id,
            )
        )
        await record_deal_stage_milestone(
            session,
            deal=deal,
            stage=stage,
            reached_at=deal.stage_entered_at or deal.updated_at,
            source="system_task_move_deal_stage",
        )
        return {"message": f"Deal moved to {stage}"}

    if action == "convert_contact_to_deal":
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")
        company = await session.get(Company, contact.company_id) if contact.company_id else None
        company_name = company.name if company else "Account"
        deal = await DealRepository(session).create(
            {
                "name": f"{company_name} - {contact.first_name} {contact.last_name}".strip(),
                "pipeline_type": "deal",
                "stage": str(payload.get("stage") or "demo_done"),
                "company_id": contact.company_id,
                "assigned_to_id": contact.assigned_to_id,
                "tags": ["converted_from_task"],
                "next_step": "Review meeting context and advance the opportunity",
                "stage_entered_at": datetime.utcnow(),
            }
        )
        await record_deal_stage_milestone(
            session,
            deal=deal,
            stage=deal.stage,
            reached_at=deal.stage_entered_at or deal.created_at,
            source="system_task_convert_contact_to_deal",
        )
        await DealRepository(session).add_contact(deal.id, contact.id, contact.persona_type or "champion")
        return {"message": "Prospect converted into a deal"}

    if action == "attach_contact_to_deal":
        deal_id = UUID(str(payload["deal_id"]))
        contact_id = UUID(str(payload["contact_id"]))
        repo = DealRepository(session)
        deal = await repo.get_or_raise(deal_id)
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Stakeholder no longer exists")
        existing_link = (
            await session.execute(
                select(DealContact).where(DealContact.deal_id == deal_id, DealContact.contact_id == contact_id)
            )
        ).scalar_one_or_none()
        if not existing_link:
            await repo.add_contact(deal_id, contact_id, contact.persona_type or "stakeholder")
        session.add(
            Activity(
                deal_id=deal_id,
                contact_id=contact_id,
                type="contact_linked",
                source="system_task",
                content=f"Stakeholder {contact.first_name} {contact.last_name} linked to the deal from a synced email thread",
                created_by_id=actor_id,
            )
        )
        return {"message": f"Attached {contact.first_name} {contact.last_name} to the deal"}

    if action == "create_contact_and_attach_to_deal":
        deal_id = UUID(str(payload["deal_id"]))
        repo = DealRepository(session)
        deal = await repo.get_or_raise(deal_id)
        email = str(payload["email"]).strip().lower()
        existing_contact = (
            await session.execute(select(Contact).where(Contact.email == email))
        ).scalar_one_or_none()
        contact = existing_contact
        if not contact:
            contact = Contact(
                first_name=str(payload.get("first_name") or "Unknown").strip() or "Unknown",
                last_name=str(payload.get("last_name") or "Contact").strip() or "Contact",
                email=email,
                company_id=UUID(str(payload["company_id"])) if payload.get("company_id") else deal.company_id,
                assigned_to_id=deal.assigned_to_id,
            )
            session.add(contact)
            await session.flush()

        existing_link = (
            await session.execute(
                select(DealContact).where(DealContact.deal_id == deal_id, DealContact.contact_id == contact.id)
            )
        ).scalar_one_or_none()
        if not existing_link:
            await repo.add_contact(deal_id, contact.id, contact.persona_type or "stakeholder")
        session.add(
            Activity(
                deal_id=deal_id,
                contact_id=contact.id,
                type="contact_linked",
                source="system_task",
                content=f"Created and linked stakeholder {contact.first_name} {contact.last_name} from a synced email thread",
                created_by_id=actor_id,
            )
        )
        return {"message": f"Created and attached {contact.first_name} {contact.last_name}"}

    if action == "re_enrich_company":
        from app.tasks.enrichment import re_enrich_company_task

        company_id = str(payload["company_id"])
        re_enrich_company_task.delay(company_id)
        company = await session.get(Company, UUID(company_id))
        if company:
            append_company_activity_log(
                company,
                action="system_task_accepted",
                actor_name=actor_name,
                actor_email=actor_email,
                message=f"{execution_prefix}: refresh company enrichment",
                metadata={"task_id": str(task.id), "action": action},
            )
            company.updated_at = datetime.utcnow()
            session.add(company)
        return {"message": "Company enrichment queued"}

    if action == "refresh_icp_research":
        from app.tasks.enrichment import icp_research_single_task

        company_id = str(payload["company_id"])
        icp_research_single_task.delay(company_id)
        company = await session.get(Company, UUID(company_id))
        if company:
            append_company_activity_log(
                company,
                action="system_task_accepted",
                actor_name=actor_name,
                actor_email=actor_email,
                message=f"{execution_prefix}: refresh ICP research",
                metadata={"task_id": str(task.id), "action": action},
            )
            company.updated_at = datetime.utcnow()
            session.add(company)
        return {"message": "ICP research queued"}

    if action == "re_enrich_contact":
        from app.tasks.enrichment import re_enrich_contact_task

        contact_id = str(payload["contact_id"])
        re_enrich_contact_task.delay(contact_id)
        return {"message": "Prospect re-enrichment queued"}

    if action in {
        "send_pricing_package",
        "book_workshop_session",
        "retry_deal_call",
        "follow_up_deal_voicemail",
        "send_deal_call_recap",
        "send_meeting_follow_up",
        "follow_up_buyer_thread",
    }:
        deal_id = UUID(str(payload["deal_id"]))
        deal = await session.get(Deal, deal_id)
        if not deal:
            raise ValueError("Deal no longer exists")

        action_text = {
            "send_pricing_package": "Sent pricing/commercial package",
            "book_workshop_session": "Booked technical workshop session",
            "retry_deal_call": "Retried buyer call",
            "follow_up_deal_voicemail": "Sent voicemail follow-up",
            "send_deal_call_recap": "Sent post-call recap",
            "send_meeting_follow_up": "Sent post-meeting follow-up",
            "follow_up_buyer_thread": "Sent buyer thread follow-up",
        }[action]

        stage_update: str | None = None
        if action == "send_pricing_package" and not _stage_reached(deal.stage, "commercial_negotiation"):
            stage_update = "commercial_negotiation"
        elif action == "book_workshop_session" and not _stage_reached(deal.stage, "workshop"):
            stage_update = "workshop"

        if stage_update:
            deal.stage = stage_update
            deal.stage_entered_at = datetime.utcnow()
            deal.days_in_stage = 0
            await record_deal_stage_milestone(
                session,
                deal=deal,
                stage=stage_update,
                reached_at=deal.stage_entered_at,
                source="system_task_follow_up_action",
            )

        next_step = str(payload.get("next_step") or "").strip()
        if next_step:
            deal.next_step = next_step.replace("_", " ").capitalize()
        deal.updated_at = datetime.utcnow()
        session.add(deal)

        session.add(
            Activity(
                deal_id=deal_id,
                type="note",
                source="system_task",
                medium="internal",
                content=f"{action_text} via {execution_label}",
                created_by_id=actor_id,
            )
        )
        return {"message": action_text}

    if action in {"retry_contact_call", "follow_up_voicemail", "send_contact_call_recap"}:
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")

        action_text = {
            "retry_contact_call": "Retried prospect call",
            "follow_up_voicemail": "Sent voicemail follow-up",
            "send_contact_call_recap": "Sent post-call recap",
        }[action]
        session.add(
            Activity(
                contact_id=contact_id,
                type="note",
                source="system_task",
                medium="internal",
                content=f"{action_text} via {execution_label}",
                created_by_id=actor_id,
            )
        )
        return {"message": action_text}

    # ── Email / Instantly task actions ────────────────────────────────────────

    if action in {"draft_reply_follow_up", "draft_open_follow_up", "book_call_from_interest"}:
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")

        action_text = {
            "draft_reply_follow_up": "Followed up on email reply",
            "draft_open_follow_up": "Sent follow-up after email open",
            "book_call_from_interest": "Booked call with interested prospect",
        }[action]

        # For booking a call from interest — advance sequence status
        if action == "book_call_from_interest":
            contact.sequence_status = "meeting_booked"
            contact.updated_at = datetime.utcnow()
            session.add(contact)

        session.add(
            Activity(
                contact_id=contact_id,
                type="email",
                source="system_task",
                medium="email",
                content=f"{action_text} via {execution_label}",
                created_by_id=actor_id,
            )
        )
        return {"message": action_text}

    if action == "mark_contact_unsubscribed":
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")
        contact.sequence_status = "unsubscribed"
        contact.instantly_status = "unsubscribed"
        contact.updated_at = datetime.utcnow()
        session.add(contact)
        session.add(
            Activity(
                contact_id=contact_id,
                type="note",
                source="system_task",
                medium="internal",
                content=f"Prospect marked as unsubscribed and outreach paused via {execution_label}",
                created_by_id=actor_id,
            )
        )
        return {"message": "Prospect marked unsubscribed"}

    if action == "close_not_interested_contact":
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")
        contact.sequence_status = "not_interested"
        contact.updated_at = datetime.utcnow()
        session.add(contact)
        session.add(
            Activity(
                contact_id=contact_id,
                type="note",
                source="system_task",
                medium="internal",
                content=f"Prospect closed as Not Interested via {execution_label}",
                created_by_id=actor_id,
            )
        )
        return {"message": "Prospect closed as not interested"}

    return {"message": "No automatic action configured"}
