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
from app.models.settings import (
    ClickUpCrmSettingsRead,
    ClickUpCrmSettingsUpdate,
    DealStageSettingsRead,
    DealStageSettingsUpdate,
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
    PreMeetingAutomationSettingsRead,
    ProspectStageSettingsRead,
    ProspectStageSettingsUpdate,
    PreMeetingAutomationSettingsUpdate,
    RolePermissionsRead,
    RolePermissionsUpdate,
    StageBucketSettings,
    SyncScheduleSettingsRead,
    SyncScheduleSettingsUpdate,
    WorkspaceSettings,
)
from app.services.deal_stages import (
    DEFAULT_DEAL_STAGE_SETTINGS,
    filter_funnel_config_to_stage_ids,
    get_configured_deal_stage_ids,
    normalize_deal_stage_settings,
)
from app.services.gmail_oauth import build_gmail_connect_url, create_gmail_oauth_state, decode_gmail_oauth_state, exchange_gmail_code
from app.services.meeting_automation import normalize_pre_meeting_settings, run_due_pre_meeting_intel_once
from app.services.permissions import normalize_role_permissions

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
    "active": [
        "reprospect",
        "demo_scheduled",
        "demo_done",
        "qualified_lead",
        "poc_agreed",
        "poc_wip",
        "poc_done",
        "commercial_negotiation",
        "msa_review",
    ],
    "inactive": ["closed_won", "churned", "not_a_fit", "cold", "closed_lost", "on_hold", "nurture", "closed"],
    "tofu": ["qualified_lead", "poc_agreed"],
    "mofu": ["poc_wip", "poc_done", "commercial_negotiation", "msa_review", "workshop"],
    "bofu": ["closed_won"],
}
_DEFAULT_PROSPECT_FUNNEL = {
    "active": ["outreach", "in_progress", "meeting_booked"],
    "inactive": ["negative_response", "no_response", "not_a_fit"],
    "tofu": ["outreach"],
    "mofu": ["in_progress"],
    "bofu": ["meeting_booked"],
}
_DEFAULT_ROLE_PERMISSIONS = {
    "ae": {
        "crm_import": False,
        "prospect_migration": True,
        "manage_team": False,
        "run_pre_meeting_intel": True,
    },
    "sdr": {
        "crm_import": False,
        "prospect_migration": True,
        "manage_team": False,
        "run_pre_meeting_intel": False,
    },
}
_DEFAULT_CLICKUP_CRM_SETTINGS = {
    "team_id": settings.CLICKUP_TEAM_ID or None,
    "space_id": settings.CLICKUP_SPACE_ID or None,
    "deals_list_id": settings.CLICKUP_DEALS_LIST_ID or None,
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
            deal_stage_settings=[dict(item) for item in DEFAULT_DEAL_STAGE_SETTINGS],
            role_permissions=_DEFAULT_ROLE_PERMISSIONS,
            prospect_funnel_config=_DEFAULT_PROSPECT_FUNNEL,
        )
        session.add(row)
        await session.commit()
        await session.refresh(row)
    elif not row.deal_stage_settings:
        row.deal_stage_settings = [dict(item) for item in DEFAULT_DEAL_STAGE_SETTINGS]
        session.add(row)
        await session.commit()
        await session.refresh(row)
    changed = False
    if not row.role_permissions:
        row.role_permissions = _DEFAULT_ROLE_PERMISSIONS
        changed = True
    if not row.pre_meeting_automation_settings:
        row.pre_meeting_automation_settings = normalize_pre_meeting_settings(None)
        changed = True
    if not row.clickup_crm_settings:
        row.clickup_crm_settings = dict(_DEFAULT_CLICKUP_CRM_SETTINGS)
        changed = True
    if changed:
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


def _normalized_role_permissions(value: dict | None) -> RolePermissionsRead:
    normalized = normalize_role_permissions(value)
    return RolePermissionsRead(**normalized)


def _normalized_pre_meeting_settings(value: dict | None) -> PreMeetingAutomationSettingsRead:
    return PreMeetingAutomationSettingsRead(**normalize_pre_meeting_settings(value))


def _normalized_clickup_crm_settings(value: dict | None) -> ClickUpCrmSettingsRead:
    raw = value if isinstance(value, dict) else {}
    return ClickUpCrmSettingsRead(
        team_id=str(raw.get("team_id") or _DEFAULT_CLICKUP_CRM_SETTINGS["team_id"] or "").strip() or None,
        space_id=str(raw.get("space_id") or _DEFAULT_CLICKUP_CRM_SETTINGS["space_id"] or "").strip() or None,
        deals_list_id=str(raw.get("deals_list_id") or _DEFAULT_CLICKUP_CRM_SETTINGS["deals_list_id"] or "").strip() or None,
    )


def _normalized_bucket_config(value: dict | None, default: dict[str, list[str]]) -> StageBucketSettings:
    raw = value if isinstance(value, dict) else {}
    return StageBucketSettings(
        active=list(raw.get("active") or default.get("active") or []),
        inactive=list(raw.get("inactive") or default.get("inactive") or []),
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
    allowed_deal_stage_ids = [stage["id"] for stage in normalize_deal_stage_settings(row.deal_stage_settings)]
    normalized_deal_funnel = filter_funnel_config_to_stage_ids(row.deal_funnel_config, allowed_deal_stage_ids, _DEFAULT_DEAL_FUNNEL)
    return PipelineSummarySettingsRead(
        deal=_normalized_bucket_config(normalized_deal_funnel, _DEFAULT_DEAL_FUNNEL),
        prospect=_normalized_bucket_config(row.prospect_funnel_config, _DEFAULT_PROSPECT_FUNNEL),
    )


def _validate_funnel_stage_ids(stage_ids: list[str], allowed_stages: set[str] | list[str], scope: str) -> None:
    allowed = set(allowed_stages)
    invalid = [stage for stage in stage_ids if stage not in allowed]
    if invalid:
        raise HTTPException(status_code=422, detail=f"Unknown {scope} stages in funnel settings: {', '.join(sorted(set(invalid)))}")


@router.get("/deal-stages", response_model=DealStageSettingsRead)
async def get_deal_stage_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return DealStageSettingsRead(stages=normalize_deal_stage_settings(row.deal_stage_settings))


@router.patch("/deal-stages", response_model=DealStageSettingsRead)
async def update_deal_stage_settings(body: DealStageSettingsUpdate, session: DBSession, _admin: AdminUser):
    stages = normalize_deal_stage_settings([stage.model_dump() for stage in body.stages])
    if not stages:
        raise HTTPException(status_code=422, detail="At least one deal stage is required")

    stage_ids = [stage["id"] for stage in stages]
    row = await _get_or_create(session)
    row.deal_stage_settings = stages
    row.deal_funnel_config = filter_funnel_config_to_stage_ids(row.deal_funnel_config, stage_ids, _DEFAULT_DEAL_FUNNEL)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return DealStageSettingsRead(stages=normalize_deal_stage_settings(row.deal_stage_settings))


_DEFAULT_PROSPECT_STAGES = [
    {"id": "outreach", "label": "Outreach", "group": "active", "color": "#2563eb"},
    {"id": "in_progress", "label": "In Progress", "group": "active", "color": "#7c3aed"},
    {"id": "meeting_booked", "label": "Meeting Booked", "group": "active", "color": "#0ea5e9"},
    {"id": "negative_response", "label": "Negative Response", "group": "closed", "color": "#ef4444"},
    {"id": "no_response", "label": "No Response", "group": "closed", "color": "#94a3b8"},
    {"id": "not_a_fit", "label": "Not a Fit", "group": "closed", "color": "#9ca3af"},
]


def _normalize_prospect_stage_settings(raw: list[dict] | None) -> list[dict]:
    if not raw:
        return _DEFAULT_PROSPECT_STAGES
    stages = []
    for stage in raw:
        if not isinstance(stage, dict) or not stage.get("id"):
            continue
        stages.append({
            "id": stage["id"],
            "label": stage.get("label") or stage["id"].replace("_", " ").title(),
            "group": stage.get("group", "active") if stage.get("group") in ("active", "closed") else "active",
            "color": stage.get("color") or "#94a3b8",
        })
    return stages or _DEFAULT_PROSPECT_STAGES


@router.get("/prospect-stages", response_model=ProspectStageSettingsRead)
async def get_prospect_stage_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return ProspectStageSettingsRead(stages=_normalize_prospect_stage_settings(row.prospect_stage_settings))


@router.patch("/prospect-stages", response_model=ProspectStageSettingsRead)
async def update_prospect_stage_settings(body: ProspectStageSettingsUpdate, session: DBSession, _admin: AdminUser):
    stages = _normalize_prospect_stage_settings([stage.model_dump() for stage in body.stages])
    if not stages:
        raise HTTPException(status_code=422, detail="At least one prospect stage is required")

    stage_ids = [stage["id"] for stage in stages]
    row = await _get_or_create(session)
    row.prospect_stage_settings = stages
    row.prospect_funnel_config = filter_funnel_config_to_stage_ids(row.prospect_funnel_config, stage_ids, _DEFAULT_PROSPECT_FUNNEL)
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return ProspectStageSettingsRead(stages=_normalize_prospect_stage_settings(row.prospect_stage_settings))


@router.get("/clickup-crm", response_model=ClickUpCrmSettingsRead)
async def get_clickup_crm_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_clickup_crm_settings(row.clickup_crm_settings)


@router.patch("/clickup-crm", response_model=ClickUpCrmSettingsRead)
async def update_clickup_crm_settings(body: ClickUpCrmSettingsUpdate, session: DBSession, _admin: AdminUser):
    row = await _get_or_create(session)
    row.clickup_crm_settings = {
        "team_id": (body.team_id or "").strip() or None,
        "space_id": (body.space_id or "").strip() or None,
        "deals_list_id": (body.deals_list_id or "").strip() or None,
    }
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_clickup_crm_settings(row.clickup_crm_settings)


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
async def get_outreach_settings(session: DBSession, _user: CurrentUser):
    """Return the global outreach sequence timing defaults."""
    row = await _get_or_create(session)
    delays = row.outreach_step_delays or _DEFAULTS
    return OutreachSettingsRead(step_delays=delays, steps_count=len(delays))


@router.patch("/outreach", response_model=OutreachSettingsRead)
async def update_outreach_settings(body: OutreachSettingsUpdate, session: DBSession, _admin: AdminUser):
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
    allowed_deal_stage_ids = await get_configured_deal_stage_ids(session)
    _validate_funnel_stage_ids(body.tofu, allowed_deal_stage_ids, "deal")
    _validate_funnel_stage_ids(body.mofu, allowed_deal_stage_ids, "deal")
    _validate_funnel_stage_ids(body.bofu, allowed_deal_stage_ids, "deal")

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
    allowed_deal_stage_ids = await get_configured_deal_stage_ids(session)
    for bucket in (body.deal.active, body.deal.inactive, body.deal.tofu, body.deal.mofu, body.deal.bofu):
        _validate_funnel_stage_ids(bucket, allowed_deal_stage_ids, "deal")
    for bucket in (body.prospect.active, body.prospect.inactive, body.prospect.tofu, body.prospect.mofu, body.prospect.bofu):
        _validate_funnel_stage_ids(bucket, _PROSPECT_STAGES, "prospect")

    row = await _get_or_create(session)
    row.deal_funnel_config = {
        "active": body.deal.active,
        "inactive": body.deal.inactive,
        "tofu": body.deal.tofu,
        "mofu": body.deal.mofu,
        "bofu": body.deal.bofu,
    }
    row.prospect_funnel_config = {
        "active": body.prospect.active,
        "inactive": body.prospect.inactive,
        "tofu": body.prospect.tofu,
        "mofu": body.prospect.mofu,
        "bofu": body.prospect.bofu,
    }
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_pipeline_summary_settings(row)


@router.get("/role-permissions", response_model=RolePermissionsRead)
async def get_role_permissions(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_role_permissions(row.role_permissions)


@router.patch("/role-permissions", response_model=RolePermissionsRead)
async def update_role_permissions(
    body: RolePermissionsUpdate,
    session: DBSession,
    _admin: AdminUser,
):
    row = await _get_or_create(session)
    row.role_permissions = body.model_dump()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_role_permissions(row.role_permissions)


@router.get("/pre-meeting-automation", response_model=PreMeetingAutomationSettingsRead)
async def get_pre_meeting_automation_settings(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_pre_meeting_settings(row.pre_meeting_automation_settings)


@router.patch("/pre-meeting-automation", response_model=PreMeetingAutomationSettingsRead)
async def update_pre_meeting_automation_settings(
    body: PreMeetingAutomationSettingsUpdate,
    session: DBSession,
    _admin: AdminUser,
):
    if body.send_hours_before < 1 or body.send_hours_before > 168:
        raise HTTPException(status_code=422, detail="send_hours_before must be between 1 and 168")

    row = await _get_or_create(session)
    row.pre_meeting_automation_settings = body.model_dump()
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_pre_meeting_settings(row.pre_meeting_automation_settings)


@router.post("/pre-meeting-automation/run-now", response_model=dict)
async def run_pre_meeting_automation_now(session: DBSession, _admin: AdminUser):
    _ = session
    return await run_due_pre_meeting_intel_once()


SYNC_DEFAULTS = {
    "tldv_sync_hour": 3,
    "tldv_sync_enabled": True,
    "tldv_page_size": 20,
    "tldv_max_pages": 3,
    "email_sync_interval_seconds": 180,
    "deal_health_hour": 2,
}


def _normalized_sync_schedule(value: dict | None) -> SyncScheduleSettingsRead:
    merged = {**SYNC_DEFAULTS, **(value or {})}
    return SyncScheduleSettingsRead(**merged)


@router.get("/sync-schedule", response_model=SyncScheduleSettingsRead)
async def get_sync_schedule(session: DBSession, _user: CurrentUser):
    row = await _get_or_create(session)
    return _normalized_sync_schedule(row.sync_schedule_settings)


@router.patch("/sync-schedule", response_model=SyncScheduleSettingsRead)
async def update_sync_schedule(body: SyncScheduleSettingsUpdate, session: DBSession, _admin: AdminUser):
    row = await _get_or_create(session)
    current = {**SYNC_DEFAULTS, **(row.sync_schedule_settings or {})}
    updates = body.model_dump(exclude_unset=True)
    current.update(updates)
    # Clamp values
    current["tldv_sync_hour"] = max(0, min(23, current["tldv_sync_hour"]))
    current["tldv_page_size"] = max(5, min(100, current["tldv_page_size"]))
    current["tldv_max_pages"] = max(1, min(20, current["tldv_max_pages"]))
    current["email_sync_interval_seconds"] = max(60, min(3600, current["email_sync_interval_seconds"]))
    current["deal_health_hour"] = max(0, min(23, current["deal_health_hour"]))
    row.sync_schedule_settings = current
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return _normalized_sync_schedule(row.sync_schedule_settings)


@router.post("/sync-schedule/tldv-now", response_model=dict)
async def trigger_tldv_sync_now(_admin: AdminUser):
    from app.tasks.tldv_sync import sync_tldv_meetings
    sync_tldv_meetings.delay()
    return {"status": "queued"}


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
