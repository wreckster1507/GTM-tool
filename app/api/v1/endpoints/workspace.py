"""
Workspace endpoints — single fast aggregate calls for the Sales Workspace UI.

Design decisions:
- All counts come from server-side SQL aggregates (no full-table fetches)
- Alerts are computed on the fly from existing model state (no extra table)
- Stage status infers readiness from data quality, not a stored flag
"""
from datetime import datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, select

from app.core.dependencies import DBSession
from app.models.battlecard import Battlecard
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.meeting import Meeting

router = APIRouter(prefix="/workspace", tags=["workspace"])

# ── Response schemas ─────────────────────────────────────────────────────────

CLOSED_STAGES = {"closed_won", "closed_lost"}
LATE_STAGES   = {"proposal", "negotiation"}
DEMO_STAGES   = {"demo", "poc"}


class WorkspaceSummary(BaseModel):
    open_deals: int
    total_companies: int
    total_contacts: int
    scheduled_meetings: int
    alerts_count: int


class StageStatus(BaseModel):
    stage: str
    status: str          # ready | needs_action | blocked
    count: int
    blockers: list[str]
    actions: list[str]


class Alert(BaseModel):
    id: str              # deterministic string — no migration needed
    type: str            # stale_deal | no_contacts | no_pre_brief | at_risk | missing_close_date | no_next_steps
    severity: str        # high | medium | low
    title: str
    description: str
    entity_id: Optional[UUID] = None
    entity_name: Optional[str] = None
    entity_type: Optional[str] = None   # deal | company | meeting
    link: Optional[str] = None
    created_at: datetime


# ── Helper: compute all alerts ───────────────────────────────────────────────

async def _compute_alerts(session) -> list[Alert]:
    alerts: list[Alert] = []
    now = datetime.utcnow()

    # 1. Stale deals — stuck in the same stage for > 14 days
    stale_rows = (await session.execute(
        select(Deal.id, Deal.name, Deal.stage, Deal.days_in_stage, Deal.health)
        .where(
            ~Deal.stage.in_(CLOSED_STAGES),
            Deal.days_in_stage > 14,
        )
        .order_by(Deal.days_in_stage.desc())
        .limit(10)
    )).all()

    for row in stale_rows:
        alerts.append(Alert(
            id=f"stale_deal_{row.id}",
            type="stale_deal",
            severity="high" if row.days_in_stage > 30 else "medium",
            title=f"Deal stalled: {row.name}",
            description=f"Stuck in '{row.stage}' for {row.days_in_stage} days with no stage movement.",
            entity_id=row.id,
            entity_name=row.name,
            entity_type="deal",
            link=f"/deals/{row.id}",
            created_at=now,
        ))

    # 2. At-risk deals — health = red
    atrisk_rows = (await session.execute(
        select(Deal.id, Deal.name, Deal.stage)
        .where(Deal.health == "red", ~Deal.stage.in_(CLOSED_STAGES))
        .limit(10)
    )).all()

    for row in atrisk_rows:
        if f"stale_deal_{row.id}" not in {a.id for a in alerts}:
            alerts.append(Alert(
                id=f"at_risk_{row.id}",
                type="at_risk",
                severity="high",
                title=f"At-risk deal: {row.name}",
                description=f"Deal is flagged red in '{row.stage}' stage. Review and update health score.",
                entity_id=row.id,
                entity_name=row.name,
                entity_type="deal",
                link=f"/deals/{row.id}",
                created_at=now,
            ))

    # 3. Late-stage deals missing close date
    no_close_rows = (await session.execute(
        select(Deal.id, Deal.name, Deal.stage)
        .where(
            Deal.stage.in_(LATE_STAGES),
            Deal.close_date_est.is_(None),
        )
        .limit(10)
    )).all()

    for row in no_close_rows:
        alerts.append(Alert(
            id=f"missing_close_{row.id}",
            type="missing_close_date",
            severity="medium",
            title=f"No close date: {row.name}",
            description=f"Deal is in '{row.stage}' but has no estimated close date. Forecast is blind.",
            entity_id=row.id,
            entity_name=row.name,
            entity_type="deal",
            link=f"/deals/{row.id}",
            created_at=now,
        ))

    # 4. Companies with active deals but zero contacts
    #    Subquery: company IDs that have at least one contact
    contacted_subq = select(Contact.company_id).where(
        Contact.company_id.is_not(None)
    ).distinct().scalar_subquery()

    #    Company IDs that have an open deal
    active_company_subq = select(Deal.company_id).where(
        ~Deal.stage.in_(CLOSED_STAGES),
        Deal.company_id.is_not(None),
    ).distinct().scalar_subquery()

    no_contact_rows = (await session.execute(
        select(Company.id, Company.name)
        .where(
            Company.id.in_(active_company_subq),
            Company.id.not_in(contacted_subq),
        )
        .limit(10)
    )).all()

    for row in no_contact_rows:
        alerts.append(Alert(
            id=f"no_contacts_{row.id}",
            type="no_contacts",
            severity="medium",
            title=f"No contacts: {row.name}",
            description="This account has an active deal but no contacts found. Run Hunter contact discovery.",
            entity_id=row.id,
            entity_name=row.name,
            entity_type="company",
            link=f"/companies/{row.id}",
            created_at=now,
        ))

    # 5. Scheduled meetings within 48h with no pre-brief
    in_48h = now + timedelta(hours=48)
    no_brief_rows = (await session.execute(
        select(Meeting.id, Meeting.title, Meeting.scheduled_at)
        .where(
            Meeting.status == "scheduled",
            Meeting.scheduled_at.is_not(None),
            Meeting.scheduled_at <= in_48h,
            Meeting.pre_brief.is_(None),
        )
        .limit(10)
    )).all()

    for row in no_brief_rows:
        alerts.append(Alert(
            id=f"no_brief_{row.id}",
            type="no_pre_brief",
            severity="high",
            title=f"No pre-brief: {row.title}",
            description="Meeting is within 48 hours but no pre-meeting brief has been generated.",
            entity_id=row.id,
            entity_name=row.title,
            entity_type="meeting",
            link=f"/meetings/{row.id}",
            created_at=now,
        ))

    # 6. Completed meetings with no next steps logged
    no_nextsteps_rows = (await session.execute(
        select(Meeting.id, Meeting.title)
        .where(
            Meeting.status == "completed",
            Meeting.next_steps.is_(None),
        )
        .limit(10)
    )).all()

    for row in no_nextsteps_rows:
        alerts.append(Alert(
            id=f"no_next_steps_{row.id}",
            type="no_next_steps",
            severity="low",
            title=f"No next steps: {row.title}",
            description="Meeting is marked completed but no next steps were logged. Update the debrief.",
            entity_id=row.id,
            entity_name=row.title,
            entity_type="meeting",
            link=f"/meetings/{row.id}",
            created_at=now,
        ))

    # Sort: high → medium → low
    severity_order = {"high": 0, "medium": 1, "low": 2}
    alerts.sort(key=lambda a: severity_order[a.severity])
    return alerts


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/summary", response_model=WorkspaceSummary)
async def workspace_summary(session: DBSession):
    """
    Single fast aggregate response for the Sales Workspace landing page.
    Replaces 4 separate list() API calls in the frontend.
    """
    open_deals = (await session.execute(
        select(func.count(Deal.id)).where(~Deal.stage.in_(CLOSED_STAGES))
    )).scalar_one()

    total_companies = (await session.execute(
        select(func.count(Company.id))
    )).scalar_one()

    total_contacts = (await session.execute(
        select(func.count(Contact.id))
    )).scalar_one()

    scheduled_meetings = (await session.execute(
        select(func.count(Meeting.id)).where(Meeting.status == "scheduled")
    )).scalar_one()

    alerts = await _compute_alerts(session)

    return WorkspaceSummary(
        open_deals=open_deals,
        total_companies=total_companies,
        total_contacts=total_contacts,
        scheduled_meetings=scheduled_meetings,
        alerts_count=len(alerts),
    )


@router.get("/alerts", response_model=list[Alert])
async def workspace_alerts(session: DBSession):
    """
    CRM alerts feed — computed from existing model state, no stored alerts table.
    Covers: stale deals, at-risk deals, missing close dates, contactless accounts,
            upcoming meetings with no brief, completed meetings with no next steps.
    """
    return await _compute_alerts(session)


@router.get("/stages/{stage}", response_model=StageStatus)
async def stage_status(stage: str, session: DBSession):
    """
    Per-stage health check — returns ready | needs_action | blocked
    plus specific blockers and suggested actions.
    """
    now = datetime.utcnow()

    if stage == "account-sourcing":
        total = (await session.execute(select(func.count(Company.id)))).scalar_one()
        unenriched = (await session.execute(
            select(func.count(Company.id)).where(Company.enriched_at.is_(None))
        )).scalar_one()

        blockers, actions = [], []
        if total == 0:
            blockers.append("No accounts imported yet")
            actions.append("Upload a CSV in Account Sourcing")
            status = "blocked"
        elif unenriched > 0:
            blockers.append(f"{unenriched} account(s) not yet enriched")
            actions.append("Run bulk enrichment from the Accounts page")
            status = "needs_action"
        else:
            status = "ready"

        return StageStatus(stage=stage, status=status, count=total,
                           blockers=blockers, actions=actions)

    if stage == "prospecting":
        total_contacts = (await session.execute(select(func.count(Contact.id)))).scalar_one()

        contacted_ids = select(Contact.company_id).where(
            Contact.company_id.is_not(None)
        ).distinct().scalar_subquery()

        companies_with_deals = (await session.execute(
            select(func.count(Deal.company_id.distinct()))
            .where(~Deal.stage.in_(CLOSED_STAGES), Deal.company_id.is_not(None))
        )).scalar_one()

        companies_no_contacts = (await session.execute(
            select(func.count(Company.id))
            .where(Company.id.not_in(contacted_ids))
        )).scalar_one()

        blockers, actions = [], []
        if total_contacts == 0:
            blockers.append("No contacts discovered yet")
            actions.append("Use Hunter contact discovery on accounts")
            status = "blocked"
        elif companies_no_contacts > 0:
            blockers.append(f"{companies_no_contacts} account(s) have no contacts")
            actions.append("Run 'Find Contacts' on those accounts")
            status = "needs_action"
        else:
            status = "ready"

        return StageStatus(stage=stage, status=status, count=total_contacts,
                           blockers=blockers, actions=actions)

    if stage == "pre-meeting":
        total_meetings = (await session.execute(
            select(func.count(Meeting.id)).where(Meeting.status == "scheduled")
        )).scalar_one()

        no_brief = (await session.execute(
            select(func.count(Meeting.id))
            .where(Meeting.status == "scheduled", Meeting.pre_brief.is_(None))
        )).scalar_one()

        blockers, actions = [], []
        if total_meetings == 0:
            blockers.append("No meetings scheduled yet")
            actions.append("Schedule a meeting from a deal in demo stage")
            status = "blocked"
        elif no_brief > 0:
            blockers.append(f"{no_brief} scheduled meeting(s) missing a pre-brief")
            actions.append("Open each meeting and run 'Run Web Intel'")
            status = "needs_action"
        else:
            status = "ready"

        return StageStatus(stage=stage, status=status, count=total_meetings,
                           blockers=blockers, actions=actions)

    if stage == "custom-demo":
        demo_meetings = (await session.execute(
            select(func.count(Meeting.id))
            .where(Meeting.meeting_type.in_(["demo", "poc"]))
        )).scalar_one()

        no_strategy = (await session.execute(
            select(func.count(Meeting.id))
            .where(
                Meeting.meeting_type.in_(["demo", "poc"]),
                Meeting.demo_strategy.is_(None),
            )
        )).scalar_one()

        blockers, actions = [], []
        if demo_meetings == 0:
            blockers.append("No demo or PoC meetings scheduled")
            actions.append("Move a deal to Demo stage and schedule a meeting")
            status = "blocked"
        elif no_strategy > 0:
            blockers.append(f"{no_strategy} demo meeting(s) have no AI demo strategy")
            actions.append("Open each meeting and run the intel pipeline")
            status = "needs_action"
        else:
            status = "ready"

        return StageStatus(stage=stage, status=status, count=demo_meetings,
                           blockers=blockers, actions=actions)

    if stage == "live-meeting":
        bc_count = (await session.execute(
            select(func.count(Battlecard.id)).where(Battlecard.is_active == True)
        )).scalar_one()

        blockers, actions = [], []
        if bc_count == 0:
            blockers.append("No battlecards loaded")
            actions.append("Seed default Beacon battlecards or create custom ones")
            status = "blocked"
        elif bc_count < 5:
            blockers.append(f"Only {bc_count} battlecard(s) — low coverage")
            actions.append("Add more objection and competitor battlecards")
            status = "needs_action"
        else:
            status = "ready"

        return StageStatus(stage=stage, status=status, count=bc_count,
                           blockers=blockers, actions=actions)

    # crm-insights-alerts / sales-workspace / unknown
    return StageStatus(
        stage=stage,
        status="ready",
        count=1,
        blockers=[],
        actions=[],
    )
