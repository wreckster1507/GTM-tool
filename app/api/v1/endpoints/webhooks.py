"""
Webhook receiver endpoints (Instantly, Fireflies, RB2B).

Each handler creates an Activity record and optionally updates deal.last_activity_at.
"""
from datetime import datetime
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import APIRouter, Request
from sqlmodel import select

from app.core.dependencies import DBSession
from app.models.activity import Activity
from app.models.deal import Deal

router = APIRouter(prefix="/webhooks", tags=["webhooks"])


async def _most_recent_active_deal(session) -> Optional[Deal]:
    result = await session.execute(
        select(Deal)
        .where(Deal.stage.not_in(["closed_won", "closed_lost"]))
        .order_by(Deal.last_activity_at.desc())
        .limit(1)
    )
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


@router.post("/instantly")
async def instantly_webhook(request: Request, session: DBSession) -> dict:
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
