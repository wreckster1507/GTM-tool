"""
Rep "next-best-action" queue.

Ranks the prospects a given rep should act on *right now*, so they don't
waste the first 10 minutes of the day hunting through filters. Deliberately
stays rule-based (not AI) for speed, explainability, and because a rep
should be able to predict why a prospect surfaces to the top.

Ranking signals (higher = higher priority):
  +60  sequence_status == "interested" and not yet called       (burn-hot)
  +55  sequence_status == "replied"                              (reply waiting)
  +45  email opened in last 48h, never called                   (warm window)
  +35  sequence_status == "sent" for >= 3 days, never called    (stale warm)
  +25  LinkedIn accepted but no message sent yet                (easy win)
  +20  call_status == "callback" and last_call_at > 2 days ago  (owed a call)
  +10  sequence_status == "ready" and has phone                 (new inventory)
  -40  terminal states (not_interested, unsubscribed, bounced)  (don't call)

Each contact returns a `reasons` list so the rep can see *why* it surfaced.
Scoped to the caller's assigned portfolio (assigned_to_id or sdr_id) for
non-admins, full workspace for admins.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.contact import Contact
from app.models.user import User


_TERMINAL = {"not_interested", "unsubscribed", "bounced", "completed"}


def _score_contact(
    contact: Contact,
    last_email_opened_at: datetime | None,
    has_open_call: bool,
) -> tuple[int, list[str]]:
    score = 0
    reasons: list[str] = []
    seq = (contact.sequence_status or "").lower()
    call_status = (contact.call_status or "").lower()
    li = (contact.linkedin_status or "").lower()
    now = datetime.utcnow()

    if seq in _TERMINAL:
        return (-40, ["terminal_state"])

    if seq == "interested" and not has_open_call:
        score += 60
        reasons.append("Prospect flagged Interested — call now while it's hot")

    if seq == "replied":
        score += 55
        reasons.append("Reply waiting — respond within 24h to keep momentum")

    if (
        last_email_opened_at
        and (now - last_email_opened_at) <= timedelta(hours=48)
        and not has_open_call
    ):
        score += 45
        reasons.append("Opened your email in the last 48h — top-of-mind window")

    if (
        seq == "sent"
        and contact.updated_at
        and (now - contact.updated_at) >= timedelta(days=3)
        and not has_open_call
    ):
        score += 35
        reasons.append("Email sent 3+ days ago, no follow-up call yet")

    if li == "accepted" and seq not in {"replied", "meeting_booked"}:
        score += 25
        reasons.append("LinkedIn connection accepted — send a message")

    if (
        call_status == "callback"
        and contact.call_last_at
        and (now - contact.call_last_at) >= timedelta(days=2)
    ):
        score += 20
        reasons.append("Callback requested — you owe them a call")

    if seq == "ready" and contact.phone:
        score += 10
        reasons.append("Fresh prospect with phone — good cold candidate")

    # Penalty: already booked or closed the loop — no urgency
    if seq == "meeting_booked":
        score -= 20
        reasons.append("Meeting already booked")

    return score, reasons


async def _load_last_email_open_map(
    session: AsyncSession, contact_ids: list[UUID]
) -> dict[UUID, datetime]:
    if not contact_ids:
        return {}
    # Grab any email_opened / email_link_clicked activity per contact in a
    # single query — we only care about the most recent timestamp.
    stmt = (
        select(Activity.contact_id, func.max(Activity.created_at))
        .where(
            Activity.contact_id.in_(contact_ids),
            Activity.source == "instantly",
            Activity.content.ilike("%opened%"),
        )
        .group_by(Activity.contact_id)
    )
    rows = (await session.execute(stmt)).all()
    return {row[0]: row[1] for row in rows if row[0] and row[1]}


async def _load_open_call_contact_ids(
    session: AsyncSession, contact_ids: list[UUID]
) -> set[UUID]:
    """A contact with a recent logged call (manual or Aircall) shouldn't be
    re-surfaced as 'never called' — the rep already acted on it today."""
    if not contact_ids:
        return set()
    since = datetime.utcnow() - timedelta(hours=24)
    stmt = (
        select(Activity.contact_id)
        .where(
            Activity.contact_id.in_(contact_ids),
            Activity.type == "call",
            Activity.created_at >= since,
        )
        .distinct()
    )
    rows = (await session.execute(stmt)).all()
    return {row[0] for row in rows if row[0]}


async def build_rep_queue(
    session: AsyncSession,
    user: User,
    *,
    limit: int = 10,
) -> list[dict[str, Any]]:
    # Pull the rep's portfolio: either admin (everything) or their own
    # sdr_id/assigned_to_id. Match the existing scoping pattern used in
    # ContactRepository.
    stmt = select(Contact).where(Contact.email.is_not(None))
    if user.role != "admin":
        stmt = stmt.where(
            or_(
                Contact.sdr_id == user.id,
                Contact.assigned_to_id == user.id,
            )
        )
    # Cheap pre-filter: drop contacts already in terminal states.
    stmt = stmt.where(
        or_(
            Contact.sequence_status.is_(None),
            Contact.sequence_status.notin_(_TERMINAL),
        )
    )
    stmt = stmt.limit(500)  # generous cap — ranking happens in Python
    contacts = list((await session.execute(stmt)).scalars().all())
    if not contacts:
        return []

    ids = [c.id for c in contacts if c.id]
    email_open_map = await _load_last_email_open_map(session, ids)
    open_call_set = await _load_open_call_contact_ids(session, ids)

    scored: list[tuple[int, list[str], Contact]] = []
    for c in contacts:
        score, reasons = _score_contact(
            c,
            last_email_opened_at=email_open_map.get(c.id),
            has_open_call=(c.id in open_call_set),
        )
        if score <= 0:
            continue
        scored.append((score, reasons, c))

    scored.sort(key=lambda x: x[0], reverse=True)
    top = scored[:limit]

    return [
        {
            "contact_id": str(c.id),
            "first_name": c.first_name,
            "last_name": c.last_name,
            "email": c.email,
            "phone": c.phone,
            "title": c.title,
            "company_id": str(c.company_id) if c.company_id else None,
            "sequence_status": c.sequence_status,
            "linkedin_status": c.linkedin_status,
            "call_status": c.call_status,
            "score": score,
            "reasons": reasons,
            "suggested_channel": _suggested_channel(c, reasons),
        }
        for score, reasons, c in top
    ]


def _suggested_channel(contact: Contact, reasons: list[str]) -> str:
    """Cheap hint: what action should the rep take first?"""
    joined = " ".join(reasons).lower()
    if "reply waiting" in joined:
        return "email"
    if "interested" in joined:
        return "call"
    if "opened your email" in joined:
        return "call"
    if "callback" in joined:
        return "call"
    if "linkedin connection" in joined:
        return "linkedin"
    if contact.phone:
        return "call"
    if contact.linkedin_url:
        return "linkedin"
    return "email"
