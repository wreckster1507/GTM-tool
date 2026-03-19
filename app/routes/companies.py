from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.company import Company, CompanyCreate, CompanyRead, CompanyUpdate
from app.services.icp_scorer import score_company

router = APIRouter(prefix="/companies", tags=["companies"])


@router.get("/", response_model=List[CompanyRead])
async def list_companies(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    session: AsyncSession = Depends(get_session),
):
    result = await session.execute(select(Company).offset(skip).limit(limit))
    return result.scalars().all()


@router.post("/", response_model=CompanyRead, status_code=201)
async def create_company(
    payload: CompanyCreate,
    session: AsyncSession = Depends(get_session),
):
    existing = await session.execute(
        select(Company).where(Company.domain == payload.domain)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Company with domain '{payload.domain}' already exists",
        )

    company = Company(**payload.model_dump())
    company.icp_score, company.icp_tier = score_company(company)

    session.add(company)
    await session.commit()
    await session.refresh(company)
    return company


@router.get("/{company_id}", response_model=CompanyRead)
async def get_company(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.put("/{company_id}", response_model=CompanyRead)
async def update_company(
    company_id: UUID,
    payload: CompanyUpdate,
    session: AsyncSession = Depends(get_session),
):
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(company, key, value)

    # Re-score after any field change
    company.icp_score, company.icp_tier = score_company(company)
    company.updated_at = datetime.utcnow()

    session.add(company)
    await session.commit()
    await session.refresh(company)
    return company


@router.delete("/{company_id}", status_code=204)
async def delete_company(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Cascade-delete a company and all dependent records in dependency order:
      1. outreach_sequences (references both company_id and contact_id)
      2. activities (references deal_id and contact_id)
      3. deals
      4. contacts
      5. signals (already has ON DELETE CASCADE — handled by DB)
      6. meetings (already has ON DELETE SET NULL — handled by DB)
      7. company
    """
    from app.models.contact import Contact
    from app.models.deal import Deal
    from app.models.activity import Activity
    from app.models.outreach import OutreachSequence

    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # 1. Outreach sequences (FK on both company_id and contact_id)
    seqs = await session.execute(
        select(OutreachSequence).where(OutreachSequence.company_id == company_id)
    )
    for seq in seqs.scalars().all():
        await session.delete(seq)

    # 2. Activities linked to this company's deals or contacts
    contacts_result = await session.execute(
        select(Contact).where(Contact.company_id == company_id)
    )
    contacts = contacts_result.scalars().all()
    contact_ids = [c.id for c in contacts]

    deals_result = await session.execute(
        select(Deal).where(Deal.company_id == company_id)
    )
    deals = deals_result.scalars().all()
    deal_ids = [d.id for d in deals]

    if contact_ids or deal_ids:
        acts_q = select(Activity)
        if contact_ids and deal_ids:
            from sqlalchemy import or_
            acts_q = acts_q.where(
                or_(Activity.contact_id.in_(contact_ids), Activity.deal_id.in_(deal_ids))
            )
        elif contact_ids:
            acts_q = acts_q.where(Activity.contact_id.in_(contact_ids))
        else:
            acts_q = acts_q.where(Activity.deal_id.in_(deal_ids))

        acts = await session.execute(acts_q)
        for act in acts.scalars().all():
            await session.delete(act)

    # 3. Deals
    for deal in deals:
        await session.delete(deal)

    # 4. Contacts (and their outreach sequences not caught above)
    for contact in contacts:
        extra_seqs = await session.execute(
            select(OutreachSequence).where(OutreachSequence.contact_id == contact.id)
        )
        for seq in extra_seqs.scalars().all():
            await session.delete(seq)
        await session.delete(contact)

    # 5. Company (signals/meetings cascade via DB constraints)
    await session.delete(company)
    await session.commit()


@router.get("/{company_id}/deals")
async def get_company_deals(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Return all deals linked to a company."""
    from app.models.deal import Deal, DealRead
    result = await session.execute(
        select(Deal).where(Deal.company_id == company_id).order_by(Deal.created_at.desc())
    )
    deals = result.scalars().all()
    return [DealRead.model_validate(d) for d in deals]
