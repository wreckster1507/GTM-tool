"""
Webhook receiver endpoints.

Instantly  → /webhooks/instantly  (email events)
Fireflies  → /webhooks/fireflies  (call transcripts)
RB2B       → /webhooks/rb2b       (website visitor identification)

Each endpoint:
  1. Validates the payload (loosely — we accept any dict for now)
  2. Creates an Activity record on the relevant deal
  3. Updates deal.last_activity_at
  4. Returns {"status": "ok", "activity_id": "..."}
"""
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.activity import Activity
from app.models.deal import Deal

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


# ── helpers ────────────────────────────────────────────────────────────────────

async def _most_recent_active_deal(session: AsyncSession) -> Optional[Deal]:
    """Fallback: find the most recently touched active deal."""
    result = await session.execute(
        select(Deal)
        .where(Deal.stage.not_in(["closed_won", "closed_lost"]))
        .order_by(Deal.last_activity_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _create_activity(
    session: AsyncSession,
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


# ── Instantly ──────────────────────────────────────────────────────────────────

@router.post("/instantly")
async def instantly_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Receives email events from Instantly.ai.

    Expected fields (all optional — we handle missing keys gracefully):
      event_type, to_email, subject, campaign_id
    """
    payload: Dict[str, Any] = await request.json()

    event_type = payload.get("event_type", "email_event")
    subject = payload.get("subject", "(no subject)")
    to_email = payload.get("to_email") or payload.get("email", "")

    deal = await _most_recent_active_deal(session)

    activity = await _create_activity(
        session,
        type_="email",
        source="instantly",
        content=f"Email {event_type}: {subject} → {to_email}",
        payload=payload,
        deal_id=deal.id if deal else None,
    )
    return {"status": "ok", "activity_id": str(activity.id)}


# ── Fireflies ──────────────────────────────────────────────────────────────────

@router.post("/fireflies")
async def fireflies_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Receives transcription-complete events from Fireflies.ai.

    Expected fields:
      title, summary, ai_summary, deal_id (optional UUID)
    """
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
    # Store AI summary if provided
    if payload.get("ai_summary"):
        activity.ai_summary = payload["ai_summary"]
        session.add(activity)
        await session.commit()

    return {"status": "ok", "activity_id": str(activity.id)}


# ── RB2B ───────────────────────────────────────────────────────────────────────

@router.post("/rb2b")
async def rb2b_webhook(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """
    Receives website visitor identification events from RB2B.

    Expected fields:
      name, company_name, company_domain, pages_visited
    """
    payload: Dict[str, Any] = await request.json()

    visitor = payload.get("name", "Unknown visitor")
    company_name = payload.get("company_name", "Unknown company")
    pages = payload.get("pages_visited", [])
    pages_str = ", ".join(pages) if isinstance(pages, list) else str(pages)

    content = f"{visitor} from {company_name} visited: {pages_str or 'website'}"

    activity = await _create_activity(
        session,
        type_="visit",
        source="rb2b",
        content=content,
        payload=payload,
    )
    return {"status": "ok", "activity_id": str(activity.id)}
