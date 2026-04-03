"""
Settings endpoints — workspace-level configuration.

GET  /settings/outreach  → current outreach sequence defaults
PATCH /settings/outreach → update step delays
GET  /settings/outreach-content → current outreach AI templates and guidance
PATCH /settings/outreach-content → update outreach AI templates and guidance
GET  /settings/email-sync → current Gmail sync status
"""
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from app.config import settings
from app.core.dependencies import AdminUser, CurrentUser, DBSession
from app.core.exceptions import ForbiddenError, UnauthorizedError
from app.models.deal import DEAL_STAGES
from app.models.settings import (
    DealFunnelSettingsRead,
    DealFunnelSettingsUpdate,
    GmailConnectUrlRead,
    GmailSettingsRead,
    GmailSettingsUpdate,
    OutreachContentSettingsRead,
    OutreachContentSettingsUpdate,
    OutreachSettingsRead,
    OutreachSettingsUpdate,
    PipelineSummarySettingsRead,
    PipelineSummarySettingsUpdate,
    StageBucketSettings,
    WorkspaceSettings,
)
from app.services.gmail_oauth import build_gmail_connect_url, create_gmail_oauth_state, decode_gmail_oauth_state, exchange_gmail_code

router = APIRouter(prefix="/settings", tags=["settings"])

_DEFAULTS = [0, 3, 7]
_DEFAULT_OUTREACH_CONTENT = {
    "general_prompt": (
        "Write concise enterprise outbound emails for Beacon.li. Personalize to the contact and company, "
        "avoid hype, avoid fluff, and keep the CTA low-friction."
    ),
    "linkedin_prompt": (
        "Keep LinkedIn notes conversational and specific to the person's role or recent company context."
    ),
    "step_templates": [
        {
            "step_number": 1,
            "label": "Initial email",
            "goal": "Start a personalized conversation with a specific reason for reaching out.",
            "subject_hint": "Quick question about {{company_name}}",
            "body_template": (
                "Hi {{first_name}},\n\n"
                "Noticed {{company_name}} is pushing on {{reason_to_reach_out}}. Beacon helps teams reduce "
                "implementation drag without replacing the systems they already run.\n\n"
                "Worth a quick compare?"
            ),
            "prompt_hint": "Open with a strong personalization point and end with a simple CTA.",
        },
        {
            "step_number": 2,
            "label": "Follow-up",
            "goal": "Add one fresh signal or proof point without repeating the first note.",
            "subject_hint": "Re: {{company_name}} implementation motion",
            "body_template": (
                "Hi {{first_name}},\n\n"
                "Following up with one more angle: teams like yours use Beacon to remove manual coordination "
                "from implementation work and get faster rollout consistency.\n\n"
                "Happy to share a quick example if useful."
            ),
            "prompt_hint": "Reference the first email lightly and contribute one new idea, signal, or stat.",
        },
        {
            "step_number": 3,
            "label": "Final touch",
            "goal": "Close the loop politely while keeping the door open.",
            "subject_hint": "Re: {{company_name}}",
            "body_template": (
                "Hi {{first_name}},\n\n"
                "Last nudge from me. If implementation orchestration is on your roadmap this quarter, "
                "I can share what Beacon is doing for teams with similar rollout complexity.\n\n"
                "If not relevant, no worries."
            ),
            "prompt_hint": "Be brief, respectful, and easy to ignore without sounding passive-aggressive.",
        },
    ],
}
_DEFAULT_DEAL_FUNNEL = {
    "tofu": ["qualified_lead", "poc_agreed"],
    "mofu": ["poc_wip", "poc_done", "commercial_negotiation", "msa_review", "workshop"],
    "bofu": ["closed_won"],
}
_DEFAULT_PROSPECT_FUNNEL = {
    "tofu": ["outreach"],
    "mofu": ["in_progress"],
    "bofu": ["meeting_booked"],
}
_PROSPECT_STAGES = {"outreach", "in_progress", "meeting_booked", "negative_response", "no_response", "not_a_fit"}


async def _get_or_create(session) -> WorkspaceSettings:
    """Return the single settings row, creating it with defaults if absent."""
    row = await session.get(WorkspaceSettings, 1)
    if row is None:
        row = WorkspaceSettings(
            id=1,
            outreach_step_delays=_DEFAULTS,
            outreach_content_settings=_DEFAULT_OUTREACH_CONTENT,
            deal_funnel_config=_DEFAULT_DEAL_FUNNEL,
            prospect_funnel_config=_DEFAULT_PROSPECT_FUNNEL,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _normalized_bucket_config(value: dict | None, default: dict[str, list[str]]) -> StageBucketSettings:
    raw = value if isinstance(value, dict) else {}
    return StageBucketSettings(
        tofu=list(raw.get("tofu") or default["tofu"]),
        mofu=list(raw.get("mofu") or default["mofu"]),
        bofu=list(raw.get("bofu") or default["bofu"]),
    )


def _normalized_outreach_content(value: dict | None, step_count: int | None = None) -> OutreachContentSettingsRead:
    raw = value if isinstance(value, dict) else {}
    raw_steps = raw.get("step_templates")
    steps = raw_steps if isinstance(raw_steps, list) and raw_steps else _DEFAULT_OUTREACH_CONTENT["step_templates"]
    normalized_steps = []
    for idx, step in enumerate(steps, start=1):
        if not isinstance(step, dict):
            continue
        normalized_steps.append(
            {
                "step_number": int(step.get("step_number") or idx),
                "label": str(step.get("label") or f"Step {idx}"),
                "goal": str(step.get("goal") or ""),
                "subject_hint": str(step.get("subject_hint") or "") or None,
                "body_template": str(step.get("body_template") or "") or None,
                "prompt_hint": str(step.get("prompt_hint") or "") or None,
            }
        )
    if not normalized_steps:
        normalized_steps = _DEFAULT_OUTREACH_CONTENT["step_templates"]
    normalized_steps.sort(key=lambda step: step["step_number"])
    target_steps = step_count or len(normalized_steps)
    while len(normalized_steps) < target_steps:
        last = normalized_steps[-1]
        normalized_steps.append(
            {
                **last,
                "step_number": len(normalized_steps) + 1,
                "label": f"Step {len(normalized_steps) + 1}",
            }
        )
    return OutreachContentSettingsRead(
        general_prompt=str(raw.get("general_prompt") or _DEFAULT_OUTREACH_CONTENT["general_prompt"]),
        linkedin_prompt=str(raw.get("linkedin_prompt") or _DEFAULT_OUTREACH_CONTENT["linkedin_prompt"]),
        step_templates=normalized_steps,
    )


def _normalized_deal_funnel_config(value: dict | None) -> DealFunnelSettingsRead:
    normalized = _normalized_bucket_config(value, _DEFAULT_DEAL_FUNNEL)
    return DealFunnelSettingsRead(tofu=normalized.tofu, mofu=normalized.mofu, bofu=normalized.bofu)


def _normalized_pipeline_summary_settings(row: WorkspaceSettings) -> PipelineSummarySettingsRead:
    return PipelineSummarySettingsRead(
        deal=_normalized_bucket_config(row.deal_funnel_config, _DEFAULT_DEAL_FUNNEL),
        prospect=_normalized_bucket_config(row.prospect_funnel_config, _DEFAULT_PROSPECT_FUNNEL),
    )


def _validate_funnel_stage_ids(stage_ids: list[str], allowed_stages: set[str] | list[str], scope: str) -> None:
    allowed = set(allowed_stages)
    invalid = [stage for stage in stage_ids if stage not in allowed]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown {scope} stages in funnel settings: {', '.join(sorted(set(invalid)))}")


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


@router.get("/outreach-content", response_model=OutreachContentSettingsRead)
async def get_outreach_content_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    step_count = len(row.outreach_step_delays or _DEFAULTS)
    return _normalized_outreach_content(row.outreach_content_settings, step_count=step_count)


@router.patch("/outreach-content", response_model=OutreachContentSettingsRead)
async def update_outreach_content_settings(
    body: OutreachContentSettingsUpdate,
    session: DBSession,
    _admin: AdminUser,
):
    if len(body.step_templates) < 1 or len(body.step_templates) > 10:
        raise HTTPException(status_code=422, detail="step_templates must have 1–10 entries")

    seen_numbers: set[int] = set()
    normalized_steps = []
    for idx, step in enumerate(sorted(body.step_templates, key=lambda item: item.step_number), start=1):
        if step.step_number < 1 or step.step_number > 10:
            raise HTTPException(status_code=422, detail="step_number must be between 1 and 10")
        if step.step_number in seen_numbers:
            raise HTTPException(status_code=422, detail="step_numbers must be unique")
        seen_numbers.add(step.step_number)
        normalized_steps.append(
            {
                "step_number": step.step_number,
                "label": step.label.strip() or f"Step {idx}",
                "goal": step.goal.strip(),
                "subject_hint": (step.subject_hint or "").strip() or None,
                "body_template": (step.body_template or "").strip() or None,
                "prompt_hint": (step.prompt_hint or "").strip() or None,
            }
        )

    row = await _get_or_create(session)
    row.outreach_content_settings = {
        "general_prompt": body.general_prompt.strip(),
        "linkedin_prompt": body.linkedin_prompt.strip(),
        "step_templates": normalized_steps,
    }
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_outreach_content(row.outreach_content_settings)


@router.get("/deal-funnel", response_model=DealFunnelSettingsRead)
async def get_deal_funnel_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_deal_funnel_config(row.deal_funnel_config)


@router.patch("/deal-funnel", response_model=DealFunnelSettingsRead)
async def update_deal_funnel_settings(body: DealFunnelSettingsUpdate, session: DBSession, _admin: AdminUser):
    _validate_funnel_stage_ids(body.tofu, DEAL_STAGES, "deal")
    _validate_funnel_stage_ids(body.mofu, DEAL_STAGES, "deal")
    _validate_funnel_stage_ids(body.bofu, DEAL_STAGES, "deal")

    row = await _get_or_create(session)
    row.deal_funnel_config = {
        "tofu": body.tofu,
        "mofu": body.mofu,
        "bofu": body.bofu,
    }
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_deal_funnel_config(row.deal_funnel_config)


@router.get("/pipeline-summary", response_model=PipelineSummarySettingsRead)
async def get_pipeline_summary_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_pipeline_summary_settings(row)


@router.patch("/pipeline-summary", response_model=PipelineSummarySettingsRead)
async def update_pipeline_summary_settings(
    body: PipelineSummarySettingsUpdate,
    session: DBSession,
    _admin: AdminUser,
):
    for bucket in (body.deal.tofu, body.deal.mofu, body.deal.bofu):
        _validate_funnel_stage_ids(bucket, DEAL_STAGES, "deal")
    for bucket in (body.prospect.tofu, body.prospect.mofu, body.prospect.bofu):
        _validate_funnel_stage_ids(bucket, _PROSPECT_STAGES, "prospect")

    row = await _get_or_create(session)
    row.deal_funnel_config = {
        "tofu": body.deal.tofu,
        "mofu": body.deal.mofu,
        "bofu": body.deal.bofu,
    }
    row.prospect_funnel_config = {
        "tofu": body.prospect.tofu,
        "mofu": body.prospect.mofu,
        "bofu": body.prospect.bofu,
    }
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_pipeline_summary_settings(row)


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
