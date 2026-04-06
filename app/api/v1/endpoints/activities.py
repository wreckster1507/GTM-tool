from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.dependencies import CurrentUser, DBSession, Pagination
from app.models.activity import Activity, ActivityCreate, ActivityRead, ActivityUpdate
from app.repositories.activity import ActivityRepository
from app.schemas.common import PaginatedResponse

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/", response_model=PaginatedResponse[ActivityRead])
async def list_activities(
    session: DBSession,
    pagination: Pagination,
    deal_id: Optional[UUID] = Query(default=None),
    contact_id: Optional[UUID] = Query(default=None),
    type: Optional[str] = Query(default=None),
):
    repo = ActivityRepository(session)
    filters = []
    if deal_id:
        filters.append(Activity.deal_id == deal_id)
    if contact_id:
        filters.append(Activity.contact_id == contact_id)
    if type:
        filters.append(Activity.type == type)
    items, total = await repo.list_paginated(
        *filters,
        skip=pagination.skip,
        limit=pagination.limit,
        order_by=Activity.created_at.desc(),
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=ActivityRead, status_code=201)
async def create_activity(payload: ActivityCreate, session: DBSession):
    return await ActivityRepository(session).create(payload.model_dump())


@router.get("/{activity_id}", response_model=ActivityRead)
async def get_activity(activity_id: UUID, session: DBSession):
    return await ActivityRepository(session).get_or_raise(activity_id)


@router.put("/{activity_id}", response_model=ActivityRead)
async def update_activity(activity_id: UUID, payload: ActivityUpdate, session: DBSession):
    repo = ActivityRepository(session)
    activity = await repo.get_or_raise(activity_id)
    return await repo.update(activity, payload.model_dump(exclude_unset=True))


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(activity_id: UUID, session: DBSession):
    repo = ActivityRepository(session)
    activity = await repo.get_or_raise(activity_id)
    await repo.delete(activity)
