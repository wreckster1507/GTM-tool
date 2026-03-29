"""
Settings endpoints — workspace-level configuration.

GET  /settings/outreach  → current outreach sequence defaults
PATCH /settings/outreach → update step delays
"""
from fastapi import APIRouter
from sqlmodel import select

from app.core.dependencies import DBSession
from app.models.settings import WorkspaceSettings, OutreachSettingsRead, OutreachSettingsUpdate

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
