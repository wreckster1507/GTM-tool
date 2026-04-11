from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import or_, select

from app.core.dependencies import DBSession
from app.models.activity import Activity
from app.models.company_stage_milestone import CompanyStageMilestone
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.meeting import Meeting
from app.models.user import User
from app.services.company_stage_milestones import MILESTONE_LABELS, backfill_company_stage_milestones
from app.services.deal_stages import get_configured_deal_stages

router = APIRouter(prefix="/analytics", tags=["analytics"])

DEFAULT_STAGE_PROBABILITIES: dict[str, float] = {
    "reprospect": 0.1,
    "demo_scheduled": 0.2,
    "demo_done": 0.3,
    "qualified_lead": 0.4,
    "poc_agreed": 0.55,
    "poc_wip": 0.65,
    "poc_done": 0.75,
    "commercial_negotiation": 0.85,
    "msa_review": 0.9,
    "workshop": 0.7,
    "on_hold": 0.15,
    "nurture": 0.1,
    "closed_won": 1.0,
    "closed": 1.0,
}
PROPOSAL_STAGES = {"poc_agreed", "poc_wip", "poc_done", "commercial_negotiation", "msa_review", "workshop"}
HOT_MEETING_MARKERS = {"meeting_booked", "call booked", "demo booked"}


class SalesSummary(BaseModel):
    pipeline_amount: float
    weighted_pipeline_amount: float
    forecast_amount: float
    active_deals: int
    average_deal_size: float
    overdue_close_count: int
    missing_close_date_count: int
    stale_deal_count: int


class RepActivityRow(BaseModel):
    key: str
    user_id: Optional[UUID] = None
    rep_name: str
    calls: int
    emails: int
    meetings: int
    total: int
    active_deals: int
    pipeline_amount: float


class StageBucket(BaseModel):
    key: str
    label: str
    color: str
    deal_count: int
    amount: float
    weighted_amount: float = 0


class PipelineOwnerRow(BaseModel):
    key: str
    user_id: Optional[UUID] = None
    rep_name: str
    deal_count: int
    amount: float
    weighted_amount: float
    stages: list[StageBucket]


class VelocityRow(BaseModel):
    key: str
    label: str
    color: str
    deal_count: int
    average_days_in_stage: float
    stale_deals: int


class ForecastRow(BaseModel):
    key: str
    label: str
    deal_count: int
    amount: float
    weighted_amount: float


class FunnelStep(BaseModel):
    key: str
    label: str
    count: int
    conversion_from_previous: Optional[float] = None


class QuotaState(BaseModel):
    configured: bool
    title: str
    message: str


class MonthlyUniqueFunnelRow(BaseModel):
    month_key: str
    label: str
    demo_done: int
    poc_wip: int
    poc_done: int
    closed_won: int


class SalesDashboardRead(BaseModel):
    generated_at: datetime
    window_days: int
    summary: SalesSummary
    highlights: list[str]
    rep_activity: list[RepActivityRow]
    pipeline_by_stage: list[StageBucket]
    pipeline_by_owner: list[PipelineOwnerRow]
    velocity_by_stage: list[VelocityRow]
    forecast_by_month: list[ForecastRow]
    conversion_funnel: list[FunnelStep]
    monthly_unique_funnel: list[MonthlyUniqueFunnelRow]
    quota: QuotaState


def _to_float(value) -> float:
    return float(value or 0)


def _month_label(month_key: str) -> str:
    return datetime.strptime(month_key, "%Y-%m").strftime("%b %Y")


def _month_key_for_datetime(value: datetime) -> str:
    return value.strftime("%Y-%m")


def _stage_probability(stage_id: str) -> float:
    return DEFAULT_STAGE_PROBABILITIES.get(stage_id, 0.0)


def _stage_meta(stage_map: dict[str, dict[str, str]], stage_id: str) -> dict[str, str]:
    return stage_map.get(
        stage_id,
        {
            "id": stage_id,
            "label": stage_id.replace("_", " ").title(),
            "group": "active",
            "color": "#94a3b8",
        },
    )


def _average(values: list[int]) -> float:
    if not values:
        return 0.0
    return round(sum(values) / len(values), 1)


def _conversion(previous: int, current: int) -> Optional[float]:
    if previous <= 0:
        return None
    return round((current / previous) * 100, 1)


def _label_for_rep(rep_id: UUID | None, users: dict[UUID, str]) -> tuple[str, Optional[UUID], str]:
    if rep_id and rep_id in users:
        return str(rep_id), rep_id, users[rep_id]
    return "unassigned", None, "Unassigned"


def _contact_meeting_signal(contact_row) -> bool:
    status_blob = " ".join(
        str(value or "").strip().lower()
        for value in (contact_row.outreach_lane, contact_row.sequence_status, contact_row.instantly_status)
    )
    return any(marker in status_blob for marker in HOT_MEETING_MARKERS)


def _rolling_month_keys(months: int, *, end: date | None = None) -> list[str]:
    cursor = end or date.today()
    year = cursor.year
    month = cursor.month
    keys: list[str] = []
    for _ in range(months):
        keys.append(f"{year:04d}-{month:02d}")
        month -= 1
        if month == 0:
            month = 12
            year -= 1
    keys.reverse()
    return keys


def _build_monthly_unique_funnel_rows(
    milestone_rows,
    *,
    months: int,
) -> list[MonthlyUniqueFunnelRow]:
    keys = _rolling_month_keys(months)
    counts = {
        month_key: {
            "demo_done": 0,
            "poc_wip": 0,
            "poc_done": 0,
            "closed_won": 0,
        }
        for month_key in keys
    }
    for row in milestone_rows:
        month_key = _month_key_for_datetime(row.first_reached_at)
        if month_key not in counts or row.milestone_key not in counts[month_key]:
            continue
        counts[month_key][row.milestone_key] += 1

    return [
        MonthlyUniqueFunnelRow(
            month_key=month_key,
            label=_month_label(month_key),
            demo_done=counts[month_key]["demo_done"],
            poc_wip=counts[month_key]["poc_wip"],
            poc_done=counts[month_key]["poc_done"],
            closed_won=counts[month_key]["closed_won"],
        )
        for month_key in keys
    ]


async def _load_monthly_unique_funnel(
    session: DBSession,
    *,
    months: int = 12,
    rep_id: UUID | None = None,
) -> list[MonthlyUniqueFunnelRow]:
    await backfill_company_stage_milestones(session)
    month_keys = _rolling_month_keys(months)
    earliest_month = datetime.strptime(month_keys[0], "%Y-%m")
    stmt = (
        select(
            CompanyStageMilestone.milestone_key,
            CompanyStageMilestone.first_reached_at,
        ).where(
            CompanyStageMilestone.first_reached_at >= earliest_month,
            CompanyStageMilestone.milestone_key.in_(list(MILESTONE_LABELS.keys())),
        )
    )
    if rep_id:
        stmt = stmt.join(Deal, CompanyStageMilestone.deal_id == Deal.id).where(Deal.assigned_to_id == rep_id)
    milestone_rows = (
        await session.execute(stmt)
    ).all()
    return _build_monthly_unique_funnel_rows(milestone_rows, months=months)


@router.get("/monthly-funnel-summary", response_model=list[MonthlyUniqueFunnelRow])
async def monthly_funnel_summary(
    session: DBSession,
    months: int = Query(12, ge=3, le=24),
):
    return await _load_monthly_unique_funnel(session, months=months)


@router.get("/sales-dashboard", response_model=SalesDashboardRead)
async def sales_dashboard(
    session: DBSession,
    window_days: int = Query(90, ge=30, le=365),
    rep_id: UUID | None = Query(default=None),
):
    filter_rep_id = rep_id
    now = datetime.utcnow()
    today = date.today()
    window_start = now - timedelta(days=window_days)
    monthly_unique_funnel = await _load_monthly_unique_funnel(session, months=12, rep_id=filter_rep_id)

    stage_settings = await get_configured_deal_stages(session)
    stage_map = {stage["id"]: stage for stage in stage_settings}
    active_stage_ids = {stage["id"] for stage in stage_settings if stage.get("group") != "closed"}

    deal_stmt = select(
        Deal.id,
        Deal.name,
        Deal.stage,
        Deal.value,
        Deal.close_date_est,
        Deal.days_in_stage,
        Deal.stage_entered_at,
        Deal.assigned_to_id,
        Deal.created_at,
        Deal.updated_at,
    )
    if filter_rep_id:
        deal_stmt = deal_stmt.where(Deal.assigned_to_id == filter_rep_id)
    deal_rows = (await session.execute(deal_stmt)).all()

    contact_stmt = select(
        Contact.id,
        Contact.assigned_to_id,
        Contact.created_at,
        Contact.outreach_lane,
        Contact.sequence_status,
        Contact.instantly_status,
    )
    if filter_rep_id:
        contact_stmt = contact_stmt.where(Contact.assigned_to_id == filter_rep_id)
    contact_rows = (await session.execute(contact_stmt)).all()

    activity_rows = (
        await session.execute(
            select(
                Activity.deal_id,
                Activity.contact_id,
                Activity.type,
                Activity.medium,
                Activity.created_at,
                Activity.created_by_id,
                Activity.aircall_user_name,
            ).where(Activity.created_at >= window_start)
        )
    ).all()

    meetings_rows = (
        await session.execute(
            select(
                Meeting.deal_id,
                Meeting.scheduled_at,
                Meeting.created_at,
                Meeting.status,
            ).where(
                or_(
                    Meeting.scheduled_at >= window_start,
                    Meeting.created_at >= window_start,
                )
            )
        )
    ).all()

    user_rows = (await session.execute(select(User.id, User.name))).all()
    users = {row.id: row.name for row in user_rows}

    contact_owner = {row.id: row.assigned_to_id for row in contact_rows}
    deal_owner = {row.id: row.assigned_to_id for row in deal_rows}

    pipeline_by_stage: dict[str, dict[str, float | int | str]] = {}
    pipeline_by_owner: dict[str, dict] = {}
    velocity_by_stage: dict[str, dict[str, object]] = {}
    forecast_by_month: dict[str, dict[str, float | int | str]] = {}
    rep_activity: dict[str, dict[str, object]] = {}

    pipeline_amount = 0.0
    weighted_pipeline_amount = 0.0
    forecast_amount = 0.0
    overdue_close_count = 0
    missing_close_date_count = 0
    stale_deal_count = 0
    active_deals = 0

    for row in deal_rows:
        stage_id = row.stage or "unknown"
        if stage_id not in active_stage_ids:
            continue

        active_deals += 1
        amount = _to_float(row.value)
        probability = _stage_probability(stage_id)
        weighted_amount = round(amount * probability, 2)
        pipeline_amount += amount
        weighted_pipeline_amount += weighted_amount

        if not row.close_date_est:
            missing_close_date_count += 1
        else:
            if row.close_date_est < today:
                overdue_close_count += 1
            if row.close_date_est <= today + timedelta(days=window_days):
                forecast_amount += amount
            month_key = row.close_date_est.strftime("%Y-%m")
            month_bucket = forecast_by_month.setdefault(
                month_key,
                {
                    "key": month_key,
                    "label": _month_label(month_key),
                    "deal_count": 0,
                    "amount": 0.0,
                    "weighted_amount": 0.0,
                },
            )
            month_bucket["deal_count"] += 1
            month_bucket["amount"] += amount
            month_bucket["weighted_amount"] += weighted_amount

        if (row.days_in_stage or 0) >= 30:
            stale_deal_count += 1

        stage_info = _stage_meta(stage_map, stage_id)
        stage_bucket = pipeline_by_stage.setdefault(
            stage_id,
            {
                "key": stage_id,
                "label": stage_info["label"],
                "color": stage_info["color"],
                "deal_count": 0,
                "amount": 0.0,
                "weighted_amount": 0.0,
            },
        )
        stage_bucket["deal_count"] += 1
        stage_bucket["amount"] += amount
        stage_bucket["weighted_amount"] += weighted_amount

        velocity_bucket = velocity_by_stage.setdefault(
            stage_id,
            {
                "key": stage_id,
                "label": stage_info["label"],
                "color": stage_info["color"],
                "days": [],
                "stale_deals": 0,
            },
        )
        velocity_bucket["days"].append(int(row.days_in_stage or 0))
        if (row.days_in_stage or 0) >= 30:
            velocity_bucket["stale_deals"] += 1

        rep_key, rep_user_id, rep_name = _label_for_rep(row.assigned_to_id, users)
        owner_bucket = pipeline_by_owner.setdefault(
            rep_key,
            {
                "key": rep_key,
                "user_id": rep_user_id,
                "rep_name": rep_name,
                "deal_count": 0,
                "amount": 0.0,
                "weighted_amount": 0.0,
                "stages": {},
            },
        )
        owner_bucket["deal_count"] += 1
        owner_bucket["amount"] += amount
        owner_bucket["weighted_amount"] += weighted_amount
        owner_stage = owner_bucket["stages"].setdefault(
            stage_id,
            {
                "key": stage_id,
                "label": stage_info["label"],
                "color": stage_info["color"],
                "deal_count": 0,
                "amount": 0.0,
                "weighted_amount": 0.0,
            },
        )
        owner_stage["deal_count"] += 1
        owner_stage["amount"] += amount
        owner_stage["weighted_amount"] += weighted_amount

    for rep_key, owner_bucket in pipeline_by_owner.items():
        rep_activity[rep_key] = {
            "key": rep_key,
            "user_id": owner_bucket["user_id"],
            "rep_name": owner_bucket["rep_name"],
            "calls": 0,
            "emails": 0,
            "meetings": 0,
            "total": 0,
            "active_deals": owner_bucket["deal_count"],
            "pipeline_amount": round(float(owner_bucket["amount"]), 2),
        }

    for row in activity_rows:
        row_rep_id = deal_owner.get(row.deal_id) or contact_owner.get(row.contact_id) or row.created_by_id
        if filter_rep_id and row_rep_id != filter_rep_id:
            continue
        rep_key, rep_user_id, rep_name = _label_for_rep(row_rep_id, users)
        activity_bucket = rep_activity.setdefault(
            rep_key,
            {
                "key": rep_key,
                "user_id": rep_user_id,
                "rep_name": rep_name,
                "calls": 0,
                "emails": 0,
                "meetings": 0,
                "total": 0,
                "active_deals": 0,
                "pipeline_amount": 0.0,
            },
        )
        medium = str(row.medium or "").strip().lower()
        kind = str(row.type or "").strip().lower()
        if medium == "call" or kind == "call":
            activity_bucket["calls"] += 1
        elif medium == "email" or kind == "email":
            activity_bucket["emails"] += 1
        elif medium == "meeting" or kind == "meeting":
            activity_bucket["meetings"] += 1
        activity_bucket["total"] = activity_bucket["calls"] + activity_bucket["emails"] + activity_bucket["meetings"]

    for row in meetings_rows:
        if row.status == "cancelled":
            continue
        row_rep_id = deal_owner.get(row.deal_id)
        if filter_rep_id and row_rep_id != filter_rep_id:
            continue
        rep_key, rep_user_id, rep_name = _label_for_rep(row_rep_id, users)
        meeting_bucket = rep_activity.setdefault(
            rep_key,
            {
                "key": rep_key,
                "user_id": rep_user_id,
                "rep_name": rep_name,
                "calls": 0,
                "emails": 0,
                "meetings": 0,
                "total": 0,
                "active_deals": 0,
                "pipeline_amount": 0.0,
            },
        )
        meeting_bucket["meetings"] += 1
        meeting_bucket["total"] = meeting_bucket["calls"] + meeting_bucket["emails"] + meeting_bucket["meetings"]

    rep_activity_rows = [
        RepActivityRow(
            key=str(bucket["key"]),
            user_id=bucket["user_id"],
            rep_name=str(bucket["rep_name"]),
            calls=int(bucket["calls"]),
            emails=int(bucket["emails"]),
            meetings=int(bucket["meetings"]),
            total=int(bucket["total"]),
            active_deals=int(bucket["active_deals"]),
            pipeline_amount=round(float(bucket["pipeline_amount"]), 2),
        )
        for bucket in sorted(
            rep_activity.values(),
            key=lambda value: (-int(value["total"]), -float(value["pipeline_amount"]), str(value["rep_name"]).lower()),
        )
    ]

    pipeline_stage_rows = [
        StageBucket(
            key=stage["key"],
            label=stage["label"],
            color=stage["color"],
            deal_count=int(stage["deal_count"]),
            amount=round(float(stage["amount"]), 2),
            weighted_amount=round(float(stage["weighted_amount"]), 2),
        )
        for stage in sorted(
            pipeline_by_stage.values(),
            key=lambda value: (-float(value["amount"]), -int(value["deal_count"])),
        )
    ]

    owner_rows = [
        PipelineOwnerRow(
            key=str(bucket["key"]),
            user_id=bucket["user_id"],
            rep_name=str(bucket["rep_name"]),
            deal_count=int(bucket["deal_count"]),
            amount=round(float(bucket["amount"]), 2),
            weighted_amount=round(float(bucket["weighted_amount"]), 2),
            stages=[
                StageBucket(
                    key=str(stage["key"]),
                    label=str(stage["label"]),
                    color=str(stage["color"]),
                    deal_count=int(stage["deal_count"]),
                    amount=round(float(stage["amount"]), 2),
                    weighted_amount=round(float(stage["weighted_amount"]), 2),
                )
                for stage in sorted(
                    bucket["stages"].values(),
                    key=lambda value: (-float(value["amount"]), str(value["label"]).lower()),
                )
            ],
        )
        for bucket in sorted(
            pipeline_by_owner.values(),
            key=lambda value: (-float(value["amount"]), str(value["rep_name"]).lower()),
        )
    ]

    velocity_rows = [
        VelocityRow(
            key=str(bucket["key"]),
            label=str(bucket["label"]),
            color=str(bucket["color"]),
            deal_count=len(bucket["days"]),
            average_days_in_stage=_average(bucket["days"]),
            stale_deals=int(bucket["stale_deals"]),
        )
        for bucket in sorted(
            velocity_by_stage.values(),
            key=lambda value: (-_average(value["days"]), -len(value["days"])),
        )
    ]

    forecast_rows = [
        ForecastRow(
            key=str(bucket["key"]),
            label=str(bucket["label"]),
            deal_count=int(bucket["deal_count"]),
            amount=round(float(bucket["amount"]), 2),
            weighted_amount=round(float(bucket["weighted_amount"]), 2),
        )
        for bucket in sorted(forecast_by_month.values(), key=lambda value: str(value["key"]))
    ]

    leads_count = sum(1 for row in contact_rows if row.created_at >= window_start)
    meeting_stage_contacts = sum(1 for row in contact_rows if _contact_meeting_signal(row))
    meetings_count = sum(1 for row in meetings_rows if row.status != "cancelled")
    proposal_count = sum(
        1
        for row in deal_rows
        if row.stage in PROPOSAL_STAGES and row.updated_at >= window_start
    )
    closed_won_count = sum(
        1
        for row in deal_rows
        if row.stage == "closed_won" and row.updated_at >= window_start
    )

    meeting_volume = max(meeting_stage_contacts, meetings_count)
    funnel_rows = [
        FunnelStep(key="lead", label="Lead", count=leads_count),
        FunnelStep(
            key="meeting",
            label="Meeting",
            count=meeting_volume,
            conversion_from_previous=_conversion(leads_count, meeting_volume),
        ),
        FunnelStep(
            key="proposal",
            label="Proposal",
            count=proposal_count,
            conversion_from_previous=_conversion(meeting_volume, proposal_count),
        ),
        FunnelStep(
            key="closed_won",
            label="Closed Won",
            count=closed_won_count,
            conversion_from_previous=_conversion(proposal_count, closed_won_count),
        ),
    ]

    highlights: list[str] = []
    if rep_activity_rows:
        top_rep = rep_activity_rows[0]
        if top_rep.total > 0:
            highlights.append(f"{top_rep.rep_name} leads activity with {top_rep.total} touches in the last {window_days} days.")
    if velocity_rows:
        slowest_stage = velocity_rows[0]
        highlights.append(
            f"{slowest_stage.label} is the slowest stage, averaging {slowest_stage.average_days_in_stage:.1f} days in stage."
        )
    if overdue_close_count > 0:
        highlights.append(f"{overdue_close_count} open deals have overdue close dates and need forecast cleanup.")
    if missing_close_date_count > 0:
        highlights.append(f"{missing_close_date_count} active deals are missing an expected close date.")
    if forecast_rows:
        strongest_month = max(forecast_rows, key=lambda row: row.weighted_amount)
        if strongest_month.weighted_amount > 0:
            highlights.append(
                f"{strongest_month.label} carries the strongest weighted forecast at ${strongest_month.weighted_amount:,.0f}."
            )
    if not highlights:
        highlights.append("Sales analytics is live, but the workspace needs more activity data before trends stand out.")

    average_deal_size = round(pipeline_amount / active_deals, 2) if active_deals else 0.0

    return SalesDashboardRead(
        generated_at=now,
        window_days=window_days,
        summary=SalesSummary(
            pipeline_amount=round(pipeline_amount, 2),
            weighted_pipeline_amount=round(weighted_pipeline_amount, 2),
            forecast_amount=round(forecast_amount, 2),
            active_deals=active_deals,
            average_deal_size=average_deal_size,
            overdue_close_count=overdue_close_count,
            missing_close_date_count=missing_close_date_count,
            stale_deal_count=stale_deal_count,
        ),
        highlights=highlights[:5],
        rep_activity=rep_activity_rows,
        pipeline_by_stage=pipeline_stage_rows,
        pipeline_by_owner=owner_rows,
        velocity_by_stage=velocity_rows,
        forecast_by_month=forecast_rows,
        conversion_funnel=funnel_rows,
        monthly_unique_funnel=monthly_unique_funnel,
        quota=QuotaState(
            configured=False,
            title="Quota setup required",
            message="Add rep or team targets to unlock quota attainment and gap-to-goal charts.",
        ),
    )
