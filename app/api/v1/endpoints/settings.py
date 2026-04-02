"""
Settings endpoints — workspace-level configuration.

GET  /settings/outreach  → current outreach sequence defaults
PATCH /settings/outreach → update step delays
GET  /settings/email-sync → current Gmail sync status
"""
from datetime import datetime

from fastapi import APIRouter, Query
from fastapi.responses import RedirectResponse

from app.config import settings
from app.core.dependencies import AdminUser, CurrentUser, DBSession
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.models.settings import (
    WorkspaceSettings,
    OutreachSettingsRead,
    OutreachSettingsUpdate,
    GmailConnectUrlRead,
    GmailSettingsRead,
    GmailSettingsUpdate,
)
from app.services.gmail_oauth import build_gmail_connect_url, create_gmail_oauth_state, decode_gmail_oauth_state, exchange_gmail_code

router = APIRouter(prefix="/settings", tags=["settings"])

_DEFAULTS = [0, 3, 7]


async def _get_or_create(session) -> WorkspaceSettings:
    """Return the single settings row, creating it with defaults if absent."""
    row = await session.get(WorkspaceSettings, 1)
    if row is None:
        row = WorkspaceSettings(id=1, outreach_step_delays=_DEFAULTS)
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


async def _gmail_status(session: DBSession) -> GmailSettingsRead:
    import redis
    from app.tasks.email_sync import REDIS_KEY_LAST_SYNC

    row = await _get_or_create(session)
    last_sync_epoch = None
    try:
        r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
        last = r.get(REDIS_KEY_LAST_SYNC)
        last_sync_epoch = int(last) if last else None
        r.close()
    except Exception:
        last_sync_epoch = None

    return GmailSettingsRead(
        configured=bool(row.gmail_shared_inbox and row.gmail_token_data),
        inbox=row.gmail_shared_inbox,
        connected_email=row.gmail_connected_email,
        connected_at=row.gmail_connected_at,
        interval_seconds=settings.EMAIL_SYNC_INTERVAL_SECONDS,
        last_sync_epoch=last_sync_epoch,
        last_error=row.gmail_last_error,
    )


@router.get("/outreach", response_model=OutreachSettingsRead)
async def get_outreach_settings(session: DBSession):
    """Return the global outreach sequence timing defaults."""
    row = await _get_or_create(session)
    delays = row.outreach_step_delays or _DEFAULTS
    return OutreachSettingsRead(step_delays=delays, steps_count=len(delays))


@router.patch("/outreach", response_model=OutreachSettingsRead)
async def update_outreach_settings(body: OutreachSettingsUpdate, session: DBSession):
    """
    Update global outreach step delays.
    Accepts a list of integers — one per step, in days from sequence start.
    E.g. [0, 4, 10] → send on Day 0, Day 4, Day 10.
    """
    if len(body.step_delays) < 1 or len(body.step_delays) > 10:
        from fastapi import HTTPException
        raise HTTPException(status_code=422, detail="step_delays must have 1–10 entries")

    row = await _get_or_create(session)
    row.outreach_step_delays = body.step_delays
    session.add(row)
    await session.commit()
    await session.refresh(row)

    delays = row.outreach_step_delays
    return OutreachSettingsRead(step_delays=delays, steps_count=len(delays))


@router.get("/email-sync", response_model=GmailSettingsRead)
async def get_gmail_settings(session: DBSession, _user: CurrentUser):
    return await _gmail_status(session)


@router.patch("/email-sync", response_model=GmailSettingsRead)
async def update_gmail_settings(body: GmailSettingsUpdate, session: DBSession, _admin: AdminUser):
    row = await _get_or_create(session)
    row.gmail_shared_inbox = body.inbox.strip().lower()
    session.add(row)
    await session.commit()
    return await _gmail_status(session)


@router.get("/email-sync/google/connect-url", response_model=GmailConnectUrlRead)
async def get_gmail_connect_url(admin: AdminUser, session: DBSession):
    if not settings.gmail_client_id or not settings.gmail_client_secret:
        raise UnauthorizedError("Gmail OAuth is not configured. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET.")

    row = await _get_or_create(session)
    if not row.gmail_shared_inbox:
        raise ForbiddenError("Set the shared inbox address before connecting Gmail.")

    state = create_gmail_oauth_state(str(admin.id))
    return GmailConnectUrlRead(url=build_gmail_connect_url(state))


@router.get("/email-sync/google/callback")
async def gmail_callback(
    session: DBSession,
    code: str = Query(...),
    state: str = Query(...),
):
    payload = decode_gmail_oauth_state(state)
    if not payload:
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?gmail=error")

    try:
        gmail_info = await exchange_gmail_code(code)
    except Exception:
        row = await _get_or_create(session)
        row.gmail_last_error = "Failed to complete Gmail OAuth exchange"
        session.add(row)
        await session.commit()
        return RedirectResponse(f"{settings.FRONTEND_URL}/settings?gmail=error")

    row = await _get_or_create(session)
    row.gmail_connected_email = gmail_info["email_address"]
    row.gmail_token_data = gmail_info["token_data"]
    row.gmail_connected_at = datetime.utcnow()
    row.gmail_last_error = None
    session.add(row)
    await session.commit()
    return RedirectResponse(f"{settings.FRONTEND_URL}/settings?gmail=connected")


@router.delete("/email-sync/google")
async def disconnect_gmail(session: DBSession, _admin: AdminUser):
    row = await _get_or_create(session)
    row.gmail_connected_email = None
    row.gmail_connected_at = None
    row.gmail_token_data = None
    row.gmail_last_error = None
    session.add(row)
    await session.commit()
    return {"status": "disconnected"}
