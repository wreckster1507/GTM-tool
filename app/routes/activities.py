from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.activity import Activity, ActivityCreate, ActivityRead, ActivityUpdate

router = APIRouter(prefix="/activities", tags=["activities"])


@router.get("/", response_model=List[ActivityRead])
async def list_activities(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    deal_id: Optional[UUID] = Query(default=None),
    contact_id: Optional[UUID] = Query(default=None),
    type: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    query = select(Activity)
    if deal_id:
        query = query.where(Activity.deal_id == deal_id)
    if contact_id:
        query = query.where(Activity.contact_id == contact_id)
    if type:
        query = query.where(Activity.type == type)
    result = await session.execute(
        query.order_by(Activity.created_at.desc()).offset(skip).limit(limit)
    )
    return result.scalars().all()


@router.post("/", response_model=ActivityRead, status_code=201)
async def create_activity(
    payload: ActivityCreate,
    session: AsyncSession = Depends(get_session),
):
    activity = Activity(**payload.model_dump())
    session.add(activity)
    await session.commit()
    await session.refresh(activity)
    return activity


@router.get("/{activity_id}", response_model=ActivityRead)
async def get_activity(
    activity_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    activity = await session.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return activity


@router.put("/{activity_id}", response_model=ActivityRead)
async def update_activity(
    activity_id: UUID,
    payload: ActivityUpdate,
    session: AsyncSession = Depends(get_session),
):
    activity = await session.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(activity, key, value)

    session.add(activity)
    await session.commit()
    await session.refresh(activity)
    return activity


@router.delete("/{activity_id}", status_code=204)
async def delete_activity(
    activity_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    activity = await session.get(Activity, activity_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    await session.delete(activity)
    await session.commit()
