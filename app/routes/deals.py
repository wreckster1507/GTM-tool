from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.deal import Deal, DealCreate, DealRead, DealUpdate

router = APIRouter(prefix="/deals", tags=["deals"])

VALID_STAGES = ["discovery", "demo", "poc", "proposal", "negotiation", "closed_won", "closed_lost"]


@router.get("/", response_model=List[DealRead])
async def list_deals(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    company_id: Optional[UUID] = Query(default=None),
    stage: Optional[str] = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    query = select(Deal)
    if company_id:
        query = query.where(Deal.company_id == company_id)
    if stage:
        query = query.where(Deal.stage == stage)
    result = await session.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("/", response_model=DealRead, status_code=201)
async def create_deal(
    payload: DealCreate,
    session: AsyncSession = Depends(get_session),
):
    deal_data = payload.model_dump()
    if deal_data.get("stage") and deal_data["stage"] not in VALID_STAGES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid stage. Must be one of: {VALID_STAGES}",
        )

    # Set stage_entered_at when creating
    if not deal_data.get("stage_entered_at"):
        deal_data["stage_entered_at"] = datetime.utcnow()

    deal = Deal(**deal_data)
    session.add(deal)
    await session.commit()
    await session.refresh(deal)
    return deal


@router.get("/{deal_id}", response_model=DealRead)
async def get_deal(
    deal_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    deal = await session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")
    return deal


@router.put("/{deal_id}", response_model=DealRead)
async def update_deal(
    deal_id: UUID,
    payload: DealUpdate,
    session: AsyncSession = Depends(get_session),
):
    deal = await session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    update_data = payload.model_dump(exclude_unset=True)

    # Track stage transitions
    if "stage" in update_data and update_data["stage"] != deal.stage:
        if update_data["stage"] not in VALID_STAGES:
            raise HTTPException(
                status_code=422,
                detail=f"Invalid stage. Must be one of: {VALID_STAGES}",
            )
        update_data["stage_entered_at"] = datetime.utcnow()
        update_data["days_in_stage"] = 0

    for key, value in update_data.items():
        setattr(deal, key, value)
    deal.updated_at = datetime.utcnow()

    session.add(deal)
    await session.commit()
    await session.refresh(deal)
    return deal


@router.delete("/{deal_id}", status_code=204)
async def delete_deal(
    deal_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Delete a deal and its dependent activities."""
    from app.models.activity import Activity

    deal = await session.get(Deal, deal_id)
    if not deal:
        raise HTTPException(status_code=404, detail="Deal not found")

    # Delete activities referencing this deal
    acts = await session.execute(
        select(Activity).where(Activity.deal_id == deal_id)
    )
    for act in acts.scalars().all():
        await session.delete(act)

    await session.delete(deal)
    await session.commit()
