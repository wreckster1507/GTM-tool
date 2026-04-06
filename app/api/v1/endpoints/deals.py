import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import select

from app.core.dependencies import AdminUser, CurrentUser, DBSession, Pagination
from app.core.exceptions import NotFoundError, ValidationError
from app.models.activity import Activity, ActivityRead
from app.models.contact import Contact
from app.models.deal import (
    ALL_STAGES, DEAL_STAGES, PROSPECT_STAGES, PRIORITIES,
    Deal, DealContactCreate, DealContactRead, DealCreate, DealRead, DealUpdate,
)
from app.models.user import User
from app.repositories.deal import DealRepository
from app.schemas.common import PaginatedResponse
from app.services.deal_stages import get_configured_deal_stage_ids, get_configured_default_deal_stage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/deals", tags=["deals"])


async def _valid_stages(session, pipeline_type: str) -> frozenset[str]:
    return frozenset(await get_configured_deal_stage_ids(session)) if pipeline_type == "deal" else frozenset(PROSPECT_STAGES)


# ── Board ────────────────────────────────────────────────────────────────────

@router.get("/board", response_model=dict[str, list[DealRead]])
async def deal_board(
    session: DBSession,
    pipeline_type: str = Query(default="deal"),
):
    """Return deals grouped by stage for kanban board display."""
    return await DealRepository(session).board(pipeline_type)


# ── List (paginated, backward-compatible) ────────────────────────────────────

@router.get("/", response_model=PaginatedResponse[DealRead])
async def list_deals(
    session: DBSession,
    pagination: Pagination,
    company_id: Optional[UUID] = Query(default=None),
    stage: Optional[str] = Query(default=None),
    pipeline_type: Optional[str] = Query(default=None),
):
    repo = DealRepository(session)
    filters = []
    if company_id:
        filters.append(Deal.company_id == company_id)
    if stage:
        filters.append(Deal.stage == stage)
    if pipeline_type:
        filters.append(Deal.pipeline_type == pipeline_type)
    items, total = await repo.list_paginated(
        *filters,
        skip=pagination.skip,
        limit=pagination.limit,
        order_by=Deal.created_at.desc(),
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


# ── Create ───────────────────────────────────────────────────────────────────

@router.post("/", response_model=DealRead, status_code=201)
async def create_deal(payload: DealCreate, session: DBSession, _user: CurrentUser):
    data = payload.model_dump()

    # Default stage based on pipeline type
    if not data.get("stage"):
        data["stage"] = await get_configured_default_deal_stage(session) if data.get("pipeline_type", "deal") == "deal" else "cold_account"

    valid = await _valid_stages(session, data.get("pipeline_type", "deal"))
    if data["stage"] not in valid:
        raise ValidationError(f"Invalid stage for {data['pipeline_type']}. Must be one of: {sorted(valid)}")

    data["stage_entered_at"] = datetime.utcnow()
    deal = await DealRepository(session).create(data)

    # Auto-log activity
    activity = Activity(
        deal_id=deal.id,
        type="deal_created",
        source="system",
        content=f"Deal created in {deal.pipeline_type} pipeline",
    )
    session.add(activity)
    await session.commit()

    return await DealRepository(session).get_with_joins(deal.id) or deal


# ── Get single ───────────────────────────────────────────────────────────────

@router.get("/{deal_id}", response_model=DealRead)
async def get_deal(deal_id: UUID, session: DBSession):
    result = await DealRepository(session).get_with_joins(deal_id)
    if not result:
        raise NotFoundError(f"Deal {deal_id} not found")
    return result


# ── Update ───────────────────────────────────────────────────────────────────

@router.put("/{deal_id}", response_model=DealRead)
async def update_deal(deal_id: UUID, payload: DealUpdate, session: DBSession, _user: CurrentUser):
    repo = DealRepository(session)
    deal = await repo.get_or_raise(deal_id)
    update_data = payload.model_dump(exclude_unset=True)

    # Validate stage if changed
    if "stage" in update_data and update_data["stage"] != deal.stage:
        pt = update_data.get("pipeline_type", deal.pipeline_type)
        valid = await _valid_stages(session, pt)
        if update_data["stage"] not in valid:
            raise ValidationError(f"Invalid stage. Must be one of: {sorted(valid)}")
        update_data["stage_entered_at"] = datetime.utcnow()
        update_data["days_in_stage"] = 0

    # Auto-log field changes
    changes: list[str] = []
    if "value" in update_data and update_data["value"] != deal.value:
        changes.append(f"Amount changed to ${update_data['value']}")
    if "priority" in update_data and update_data["priority"] != deal.priority:
        changes.append(f"Priority changed to {update_data['priority']}")
    if "assigned_to_id" in update_data and str(update_data.get("assigned_to_id")) != str(deal.assigned_to_id):
        changes.append("Assignee changed")

    update_data["updated_at"] = datetime.utcnow()
    updated = await repo.update(deal, update_data)

    if changes:
        activity = Activity(
            deal_id=deal_id,
            type="field_change",
            source="system",
            content="; ".join(changes),
        )
        session.add(activity)
        await session.commit()

    return await repo.get_with_joins(deal_id) or updated


@router.patch("/{deal_id}", response_model=DealRead)
async def patch_deal(deal_id: UUID, payload: DealUpdate, session: DBSession, _user: CurrentUser):
    """PATCH alias for update_deal — same logic."""
    return await update_deal(deal_id, payload, session, _user)


# ── Stage move ───────────────────────────────────────────────────────────────

@router.patch("/{deal_id}/stage", response_model=DealRead)
async def move_stage(deal_id: UUID, body: dict, session: DBSession, _user: CurrentUser):
    new_stage = body.get("stage")
    if not new_stage:
        raise ValidationError("stage is required")

    repo = DealRepository(session)
    deal = await repo.get_or_raise(deal_id)

    valid = await _valid_stages(session, deal.pipeline_type)
    if new_stage not in valid:
        raise ValidationError(f"Invalid stage for {deal.pipeline_type}. Must be one of: {sorted(valid)}")

    old_stage = deal.stage
    if new_stage == old_stage:
        return await repo.get_with_joins(deal_id)

    await repo.update(deal, {
        "stage": new_stage,
        "stage_entered_at": datetime.utcnow(),
        "days_in_stage": 0,
        "updated_at": datetime.utcnow(),
    })

    # Auto-log stage change
    activity = Activity(
        deal_id=deal_id,
        type="stage_change",
        source="system",
        content=f"Stage moved from {old_stage} to {new_stage}",
    )
    session.add(activity)
    await session.commit()

    return await repo.get_with_joins(deal_id)


# ── Delete ───────────────────────────────────────────────────────────────────

@router.delete("/{deal_id}", status_code=204)
async def delete_deal(deal_id: UUID, session: DBSession, _admin: AdminUser):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)
    await repo.delete_with_cascade(deal_id)


# ── Deal Contacts ────────────────────────────────────────────────────────────

@router.get("/{deal_id}/contacts", response_model=list[DealContactRead])
async def list_deal_contacts(deal_id: UUID, session: DBSession):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)
    return await repo.list_contacts(deal_id)


@router.post("/{deal_id}/contacts", response_model=DealContactRead, status_code=201)
async def add_deal_contact(deal_id: UUID, body: DealContactCreate, session: DBSession, _user: CurrentUser):
    repo = DealRepository(session)
    deal = await repo.get_or_raise(deal_id)

    # Verify contact exists
    contact = await session.get(Contact, body.contact_id)
    if not contact:
        raise NotFoundError(f"Contact {body.contact_id} not found")

    dc = await repo.add_contact(deal_id, body.contact_id, body.role)

    # Auto-log
    name = f"{contact.first_name} {contact.last_name}"
    role_str = f" as {body.role}" if body.role else ""
    activity = Activity(
        deal_id=deal_id,
        type="contact_linked",
        source="system",
        content=f"Contact {name} linked{role_str}",
        contact_id=body.contact_id,
    )
    session.add(activity)
    await session.commit()

    contacts = await repo.list_contacts(deal_id)
    return next((c for c in contacts if c.contact_id == body.contact_id), dc)


@router.delete("/{deal_id}/contacts/{contact_id}", status_code=204)
async def remove_deal_contact(deal_id: UUID, contact_id: UUID, session: DBSession, _user: CurrentUser):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)
    removed = await repo.remove_contact(deal_id, contact_id)
    if not removed:
        raise NotFoundError("Contact not linked to this deal")


# ── Deal Activities ──────────────────────────────────────────────────────────

@router.get("/{deal_id}/activities", response_model=list[ActivityRead])
async def list_deal_activities(deal_id: UUID, session: DBSession):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)

    stmt = (
        select(Activity, User.name.label("user_name"))
        .outerjoin(User, Activity.created_by_id == User.id)
        .where(Activity.deal_id == deal_id)
        .order_by(Activity.created_at.desc())
    )
    rows = (await session.execute(stmt)).all()

    result = []
    for act, user_name in rows:
        read = ActivityRead.model_validate(act)
        read.user_name = user_name
        result.append(read)
    return result


@router.post("/{deal_id}/activities", response_model=ActivityRead, status_code=201)
async def add_deal_comment(deal_id: UUID, body: dict, session: DBSession, user: CurrentUser):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)

    content = body.get("body", "").strip()
    if not content:
        raise ValidationError("Comment body is required")

    activity = Activity(
        deal_id=deal_id,
        type="comment",
        source="manual",
        content=content,
        created_by_id=user.id,
    )
    session.add(activity)
    await session.commit()
    await session.refresh(activity)
    read = ActivityRead.model_validate(activity)
    read.user_name = user.name
    return read
