from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.dependencies import DBSession, Pagination
from app.core.exceptions import ValidationError
from app.models.deal import Deal, DealCreate, DealRead, DealUpdate
from app.repositories.deal import DealRepository, VALID_STAGES
from app.schemas.common import PaginatedResponse

router = APIRouter(prefix="/deals", tags=["deals"])


@router.get("/", response_model=PaginatedResponse[DealRead])
async def list_deals(
    session: DBSession,
    pagination: Pagination,
    company_id: Optional[UUID] = Query(default=None),
    stage: Optional[str] = Query(default=None),
):
    repo = DealRepository(session)
    filters = []
    if company_id:
        filters.append(Deal.company_id == company_id)
    if stage:
        filters.append(Deal.stage == stage)
    items, total = await repo.list_paginated(
        *filters,
        skip=pagination.skip,
        limit=pagination.limit,
        order_by=Deal.created_at.desc(),
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=DealRead, status_code=201)
async def create_deal(payload: DealCreate, session: DBSession):
    data = payload.model_dump()
    if data.get("stage") and data["stage"] not in VALID_STAGES:
        raise ValidationError(f"Invalid stage. Must be one of: {sorted(VALID_STAGES)}")
    if not data.get("stage_entered_at"):
        data["stage_entered_at"] = datetime.utcnow()
    return await DealRepository(session).create(data)


@router.get("/{deal_id}", response_model=DealRead)
async def get_deal(deal_id: UUID, session: DBSession):
    return await DealRepository(session).get_or_raise(deal_id)


@router.put("/{deal_id}", response_model=DealRead)
async def update_deal(deal_id: UUID, payload: DealUpdate, session: DBSession):
    repo = DealRepository(session)
    deal = await repo.get_or_raise(deal_id)
    update_data = payload.model_dump(exclude_unset=True)

    if "stage" in update_data and update_data["stage"] != deal.stage:
        if update_data["stage"] not in VALID_STAGES:
            raise ValidationError(f"Invalid stage. Must be one of: {sorted(VALID_STAGES)}")
        update_data["stage_entered_at"] = datetime.utcnow()
        update_data["days_in_stage"] = 0

    update_data["updated_at"] = datetime.utcnow()
    return await repo.update(deal, update_data)


@router.delete("/{deal_id}", status_code=204)
async def delete_deal(deal_id: UUID, session: DBSession):
    repo = DealRepository(session)
    await repo.get_or_raise(deal_id)
    await repo.delete_with_cascade(deal_id)
