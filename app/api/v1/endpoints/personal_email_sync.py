"""
Personal email sync endpoints.

Each sales rep can connect their own personal Gmail inbox so the CRM can
scan their past and ongoing email conversations.

Endpoints:
  GET  /personal-email-sync/status          — current user's connection status
  GET  /personal-email-sync/connect         — start OAuth flow (returns redirect URL)
  GET  /personal-email-sync/callback        — OAuth callback (called by Google)
  POST /personal-email-sync/trigger         — manually kick off a sync for current user
  POST /personal-email-sync/disconnect      — remove connection + revoke
  GET  /personal-email-sync/threads/{deal_id} — email threads for a deal from personal inboxes
"""
from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlmodel import select as sm_select

from app.core.dependencies import CurrentUser, DBSession
from app.core.exceptions import NotFoundError, ValidationError
from app.models.activity import Activity, ActivityRead
from app.models.user_email_connection import UserEmailConnection, UserEmailConnectionRead, UserEmailConnectionStatus
from app.services.gmail_oauth import (
    build_gmail_connect_url,
    create_gmail_oauth_state,
    decode_gmail_oauth_state,
    exchange_gmail_code,
)

router = APIRouter(prefix="/personal-email-sync", tags=["personal-email-sync"])


@router.get("/status", response_model=UserEmailConnectionStatus)
async def get_personal_email_status(session: DBSession, current_user: CurrentUser):
    """Return the current user's personal Gmail connection status."""
    result = await session.execute(
        sm_select(UserEmailConnection).where(
            UserEmailConnection.user_id == current_user.id
        )
    )
    connection = result.scalar_one_or_none()
    if not connection or not connection.is_active:
        return UserEmailConnectionStatus(connected=False)

    return UserEmailConnectionStatus(
        connected=True,
        email_address=connection.email_address,
        last_sync_epoch=connection.last_sync_epoch,
        backfill_completed=connection.backfill_completed,
        last_error=connection.last_error,
    )


@router.get("/connect")
async def start_personal_gmail_connect(current_user: CurrentUser):
    """
    Generate a Google OAuth URL for the current user to connect their personal Gmail.
    Returns { url: "https://accounts.google.com/..." }
    """
    state = create_gmail_oauth_state(str(current_user.id))
    url = build_gmail_connect_url(state)
    return {"url": url}


@router.get("/callback")
async def personal_gmail_callback(
    session: DBSession,
    code: str = Query(...),
    state: str = Query(...),
):
    """
    OAuth2 callback from Google. Exchanges code for tokens, stores connection,
    triggers initial backfill, then redirects to the frontend settings page.
    """
    from app.config import settings as app_settings

    payload = decode_gmail_oauth_state(state)
    if not payload:
        raise ValidationError("Invalid or expired OAuth state")

    user_id = payload.get("sub")
    if not user_id:
        raise ValidationError("Invalid OAuth state payload")

    # Exchange code for tokens + fetch Gmail profile
    token_info = await exchange_gmail_code(code)
    email_address = token_info["email_address"]
    token_data = token_info["token_data"]

    if not email_address or not token_data:
        raise ValidationError("Failed to obtain Gmail credentials")

    # Upsert UserEmailConnection
    result = await session.execute(
        sm_select(UserEmailConnection).where(
            UserEmailConnection.user_id == UUID(user_id)
        )
    )
    connection = result.scalar_one_or_none()

    if connection:
        # Reconnect: reset backfill state so we re-scan
        connection.email_address = email_address
        connection.token_data = token_data
        connection.is_active = True
        connection.backfill_completed = False
        connection.last_sync_epoch = None
        connection.last_error = None
        connection.updated_at = datetime.utcnow()
    else:
        connection = UserEmailConnection(
            user_id=UUID(user_id),
            email_address=email_address,
            token_data=token_data,
            connected_at=datetime.utcnow(),
            updated_at=datetime.utcnow(),
        )

    session.add(connection)
    await session.commit()
    await session.refresh(connection)

    # Queue the initial backfill immediately
    from app.tasks.personal_email_sync import sync_personal_inbox
    sync_personal_inbox.delay(str(connection.id))

    # Redirect back to the frontend settings page
    frontend_url = getattr(app_settings, "FRONTEND_URL", "http://localhost:3000")
    return RedirectResponse(
        url=f"{frontend_url}/settings?gmail_connected=1&email={email_address}",
        status_code=302,
    )


@router.post("/trigger")
async def trigger_personal_email_sync(session: DBSession, current_user: CurrentUser):
    """Manually trigger an immediate sync for the current user's personal inbox."""
    result = await session.execute(
        sm_select(UserEmailConnection).where(
            UserEmailConnection.user_id == current_user.id,
            UserEmailConnection.is_active == True,  # noqa: E712
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise NotFoundError("No active personal Gmail connection found. Connect your inbox first.")

    from app.tasks.personal_email_sync import sync_personal_inbox
    task = sync_personal_inbox.delay(str(connection.id))
    return {"status": "queued", "task_id": task.id, "email_address": connection.email_address}


@router.post("/disconnect")
async def disconnect_personal_email(session: DBSession, current_user: CurrentUser):
    """Remove the current user's personal Gmail connection."""
    result = await session.execute(
        sm_select(UserEmailConnection).where(
            UserEmailConnection.user_id == current_user.id
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        return {"status": "not_connected"}

    connection.is_active = False
    connection.token_data = {}
    connection.last_error = None
    connection.updated_at = datetime.utcnow()
    session.add(connection)
    await session.commit()
    return {"status": "disconnected", "email_address": connection.email_address}


@router.get("/threads/{deal_id}")
async def get_deal_email_threads(
    deal_id: UUID,
    session: DBSession,
    current_user: CurrentUser,
    limit: int = Query(default=50, ge=1, le=200),
):
    """
    Return all personal-inbox email activities for a deal, grouped by thread.
    Used by the Deal drawer's Email tab.
    """
    result = await session.execute(
        sm_select(Activity).where(
            Activity.deal_id == deal_id,
            Activity.source == "personal_email_sync",
            Activity.type == "email",
        ).order_by(Activity.created_at.desc()).limit(limit)
    )
    activities = result.scalars().all()

    # Group by gmail_thread_id if available, else by message
    threads: dict[str, list[dict]] = {}
    for act in activities:
        meta = act.event_metadata or {}
        thread_id = meta.get("gmail_thread_id") or act.email_message_id or str(act.id)
        synced_by = meta.get("synced_by_email", "")

        entry = {
            "id": str(act.id),
            "message_id": act.email_message_id,
            "subject": act.email_subject,
            "from_addr": act.email_from,
            "to_addrs": act.email_to,
            "cc_addrs": act.email_cc,
            "body_preview": (act.content or "")[:300],
            "ai_summary": act.ai_summary,
            "intent_detected": meta.get("intent_detected"),
            "synced_by_email": synced_by,
            "created_at": act.created_at.isoformat() if act.created_at else None,
        }

        if thread_id not in threads:
            threads[thread_id] = []
        threads[thread_id].append(entry)

    # Return as list of threads (newest first by first message)
    thread_list = [
        {
            "thread_id": tid,
            "subject": msgs[0]["subject"],
            "message_count": len(msgs),
            "latest_at": msgs[0]["created_at"],
            "synced_by_email": msgs[0]["synced_by_email"],
            "messages": msgs,
        }
        for tid, msgs in threads.items()
    ]
    thread_list.sort(key=lambda t: t["latest_at"] or "", reverse=True)

    return {"deal_id": str(deal_id), "threads": thread_list, "total": len(thread_list)}
