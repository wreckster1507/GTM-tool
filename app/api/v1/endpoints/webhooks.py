"""
Webhook receiver endpoints (Instantly, Fireflies, RB2B).

Each handler creates an Activity record and updates contact/sequence status.

Instantly webhook events handled:
  email_sent          → log activity
  email_opened        → log activity
  email_link_clicked  → log activity
  email_bounced       → mark contact email invalid, log activity
  reply_received      → update sequence to "replied", log activity with reply content
  lead_unsubscribed   → update contact, log activity
  lead_interested     → update contact label, log activity
  lead_not_interested → update contact label, log activity
  lead_meeting_booked → update sequence_status to "meeting_booked", log activity
"""
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Request
from sqlmodel import select

from app.core.dependencies import DBSession
from app.models.activity import Activity
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.outreach import OutreachSequence

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _most_recent_active_deal(session) -> Optional[Deal]:
    result = await session.execute(
        select(Deal)
        .where(Deal.stage.not_in(["closed_won", "closed_lost"]))
        .order_by(Deal.last_activity_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _find_contact_by_email(session, email: str) -> Optional[Contact]:
    """Look up a contact by email address — used to match Instantly events."""
    if not email:
        return None
    result = await session.execute(
        select(Contact).where(Contact.email == email.lower().strip()).limit(1)
    )
    return result.scalar_one_or_none()


async def _find_sequence_by_campaign(
    session, campaign_id: str, contact_id: Optional[UUID]
) -> Optional[OutreachSequence]:
    """Find the outreach sequence for a given Instantly campaign + contact."""
    if not campaign_id:
        return None
    query = select(OutreachSequence).where(
        OutreachSequence.instantly_campaign_id == campaign_id
    )
    if contact_id:
        query = query.where(OutreachSequence.contact_id == contact_id)
    result = await session.execute(query.limit(1))
    return result.scalar_one_or_none()


async def _create_activity(
    session,
    *,
    type_: str,
    source: str,
    content: str,
    payload: dict,
    deal_id: Optional[UUID] = None,
    contact_id: Optional[UUID] = None,
) -> Activity:
    activity = Activity(
        type=type_,
        source=source,
        content=content,
        event_metadata=payload,
        deal_id=deal_id,
        contact_id=contact_id,
    )
    session.add(activity)

    if deal_id:
        deal = await session.get(Deal, deal_id)
        if deal:
            deal.last_activity_at = datetime.utcnow()
            session.add(deal)

    await session.commit()
    await session.refresh(activity)
    return activity


# ── Instantly webhook ──────────────────────────────────────────────────────────

@router.post("/instantly")
async def instantly_webhook(request: Request, session: DBSession) -> dict:
    """
    Receive Instantly.ai webhook events and sync them into the CRM.

    Instantly sends the lead email in the payload — we use that to find
    the matching Contact and OutreachSequence, then update statuses and
    log an Activity.
    """
    payload: Dict[str, Any] = await request.json()

    # ── Parse common fields from Instantly payload ─────────────────────────────
    # Instantly v2 uses snake_case event types; v1 used camelCase
    event_type = (
        payload.get("event_type")
        or payload.get("eventType")
        or "email_event"
    )
    lead_email = (
        payload.get("lead_email")
        or payload.get("to_email")
        or payload.get("email")
        or ""
    ).lower().strip()

    campaign_id = (
        payload.get("campaign_id")
        or payload.get("campaignId")
        or ""
    )
    subject = payload.get("subject") or payload.get("emailSubject") or "(no subject)"
    reply_body = payload.get("reply_text") or payload.get("body") or ""
    step_number = payload.get("step") or payload.get("step_number")

    # ── Find contact by email ──────────────────────────────────────────────────
    contact = await _find_contact_by_email(session, lead_email)
    contact_id = contact.id if contact else None

    # ── Find linked outreach sequence ──────────────────────────────────────────
    sequence = await _find_sequence_by_campaign(session, campaign_id, contact_id)

    # ── Find a deal to attach the activity to (best-effort) ───────────────────
    deal_id = None
    if not deal_id:
        deal = await _most_recent_active_deal(session)
        deal_id = deal.id if deal else None

    now = datetime.utcnow()

    # ── Route by event type ────────────────────────────────────────────────────

    if event_type == "email_sent":
        step_note = f" (step {step_number})" if step_number else ""
        content = f"Email sent{step_note}: {subject} → {lead_email}"
        activity_type = "email"

    elif event_type == "email_opened":
        content = f"Email opened: {subject} by {lead_email}"
        activity_type = "email"

    elif event_type == "email_link_clicked":
        content = f"Link clicked in email: {subject} by {lead_email}"
        activity_type = "email"

    elif event_type == "email_bounced":
        content = f"Email bounced: {lead_email} — {subject}"
        activity_type = "email"
        # Mark the contact's email as invalid
        if contact:
            contact.email_verified = False
            contact.instantly_status = "bounced"
            contact.sequence_status = "bounced"
            contact.updated_at = now
            session.add(contact)
        if sequence:
            sequence.instantly_campaign_status = "error"
            sequence.updated_at = now
            session.add(sequence)

    elif event_type == "reply_received":
        content = (
            f"Reply from {lead_email}: {subject}"
            + (f"\n\n{reply_body[:1000]}" if reply_body else "")
        )
        activity_type = "email"
        # Update contact + sequence to "replied"
        if contact:
            contact.sequence_status = "replied"
            contact.instantly_status = "replied"
            contact.updated_at = now
            session.add(contact)
        if sequence:
            sequence.status = "replied"
            sequence.instantly_campaign_status = "completed"
            sequence.updated_at = now
            session.add(sequence)

    elif event_type == "lead_unsubscribed":
        content = f"{lead_email} unsubscribed"
        activity_type = "email"
        if contact:
            contact.sequence_status = "unsubscribed"
            contact.instantly_status = "unsubscribed"
            contact.updated_at = now
            session.add(contact)

    elif event_type == "lead_interested":
        content = f"{lead_email} marked as Interested in Instantly"
        activity_type = "email"
        if contact:
            contact.sequence_status = "interested"
            contact.updated_at = now
            session.add(contact)

    elif event_type == "lead_not_interested":
        content = f"{lead_email} marked as Not Interested in Instantly"
        activity_type = "email"
        if contact:
            contact.sequence_status = "not_interested"
            contact.updated_at = now
            session.add(contact)

    elif event_type == "lead_meeting_booked":
        content = f"Meeting booked with {lead_email}"
        activity_type = "meeting"
        if contact:
            contact.sequence_status = "meeting_booked"
            contact.updated_at = now
            session.add(contact)
        if sequence:
            sequence.status = "meeting_booked"
            sequence.updated_at = now
            session.add(sequence)

    elif event_type == "campaign_completed":
        content = f"Campaign completed for {lead_email}"
        activity_type = "email"
        if contact:
            contact.sequence_status = "completed"
            contact.updated_at = now
            session.add(contact)
        if sequence:
            sequence.status = "completed"
            sequence.instantly_campaign_status = "completed"
            sequence.updated_at = now
            session.add(sequence)

    else:
        # Unknown event — log it anyway for observability
        content = f"Instantly event [{event_type}]: {subject} → {lead_email}"
        activity_type = "email"

    # ── Commit status changes before creating activity ─────────────────────────
    if session.dirty:
        await session.commit()

    # ── Create activity record ─────────────────────────────────────────────────
    activity = await _create_activity(
        session,
        type_=activity_type,
        source="instantly",
        content=content,
        payload=payload,
        deal_id=deal_id,
        contact_id=contact_id,
    )

    return {
        "status": "ok",
        "event_type": event_type,
        "activity_id": str(activity.id),
        "contact_id": str(contact_id) if contact_id else None,
        "sequence_id": str(sequence.id) if sequence else None,
    }


# ── Fireflies webhook ──────────────────────────────────────────────────────────

@router.post("/fireflies")
async def fireflies_webhook(request: Request, session: DBSession) -> dict:
    payload: Dict[str, Any] = await request.json()
    title = payload.get("title", "Meeting transcript")
    deal_id: Optional[UUID] = None
    if raw_id := payload.get("deal_id"):
        try:
            deal_id = UUID(str(raw_id))
        except ValueError:
            pass
    if not deal_id:
        deal = await _most_recent_active_deal(session)
        deal_id = deal.id if deal else None
    activity = await _create_activity(
        session,
        type_="transcript",
        source="fireflies",
        content=payload.get("summary") or f"Transcript ready: {title}",
        payload=payload,
        deal_id=deal_id,
    )
    if payload.get("ai_summary"):
        activity.ai_summary = payload["ai_summary"]
        session.add(activity)
        await session.commit()
    return {"status": "ok", "activity_id": str(activity.id)}


# ── RB2B webhook ───────────────────────────────────────────────────────────────

@router.post("/rb2b")
async def rb2b_webhook(request: Request, session: DBSession) -> dict:
    payload: Dict[str, Any] = await request.json()
    visitor = payload.get("name", "Unknown visitor")
    company_name = payload.get("company_name", "Unknown company")
    pages = payload.get("pages_visited", [])
    pages_str = ", ".join(pages) if isinstance(pages, list) else str(pages)
    activity = await _create_activity(
        session,
        type_="visit",
        source="rb2b",
        content=f"{visitor} from {company_name} visited: {pages_str or 'website'}",
        payload=payload,
    )
    return {"status": "ok", "activity_id": str(activity.id)}
