from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlmodel import select

from app.core.dependencies import AdminUser, CurrentUser, DBSession, Pagination
from app.core.exceptions import ConflictError, NotFoundError
from app.models.company import Company, CompanyCreate, CompanyRead, CompanyUpdate
from app.models.deal import Deal, DealRead
from app.repositories.company import CompanyRepository
from app.schemas.common import PaginatedResponse
from app.services.icp_scorer import score_company

router = APIRouter(prefix="/companies", tags=["companies"])


def _visible_company_selector_filter():
    # Global company selectors should only show source-of-truth accounts that
    # came through Account Sourcing/manual add. Hidden/imported shells stay out
    # of user-facing pickers until they are upgraded by a real upload.
    return Company.sourcing_batch_id.isnot(None)


class DuplicateCheckRequest(BaseModel):
    names: list[str] = []
    domains: list[str] = []


class DuplicateCheckResponse(BaseModel):
    duplicate_names: list[str]   # names that already exist (lowercased)
    duplicate_domains: list[str] # domains that already exist (lowercased)


@router.post("/check-duplicates", response_model=DuplicateCheckResponse)
async def check_duplicates(payload: DuplicateCheckRequest, session: DBSession, _user: CurrentUser):
    """
    Given lists of company names and domains from a CSV preview, return which
    ones already exist in the DB. Single query per dimension — O(1) DB round-trips.
    """
    dup_names: list[str] = []
    dup_domains: list[str] = []

    if payload.names:
        normalised = [n.strip().lower() for n in payload.names if n.strip()]
        rows = await session.execute(
            select(func.lower(func.trim(Company.name))).where(
                func.lower(func.trim(Company.name)).in_(normalised)
            )
        )
        dup_names = list(rows.scalars().all())

    if payload.domains:
        normalised_d = [d.strip().lower() for d in payload.domains if d.strip()]
        rows = await session.execute(
            select(Company.domain).where(
                Company.domain.in_(normalised_d)
            )
        )
        dup_domains = list(rows.scalars().all())

    return DuplicateCheckResponse(
        duplicate_names=dup_names,
        duplicate_domains=dup_domains,
    )


@router.get("/", response_model=PaginatedResponse[CompanyRead])
async def list_companies(
    session: DBSession,
    _user: CurrentUser,
    pagination: Pagination,
    icp_tier: Optional[str] = Query(default=None),
):
    repo = CompanyRepository(session)
    filters = [_visible_company_selector_filter()]
    if icp_tier:
        filters.append(Company.icp_tier == icp_tier)
    items, total = await repo.list_paginated(
        *filters,
        skip=pagination.skip,
        limit=pagination.limit,
        order_by=Company.icp_score.desc(),
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=CompanyRead, status_code=201)
async def create_company(payload: CompanyCreate, session: DBSession, _user: CurrentUser):
    from app.services.company_auto_mapping import backfill_orphans_for_company

    repo = CompanyRepository(session)
    if await repo.get_by_domain(payload.domain):
        raise ConflictError(f"Company with domain '{payload.domain}' already exists")

    data = payload.model_dump()
    company = Company(**data)
    company.icp_score, company.icp_tier = score_company(company)
    saved = await repo.save(company)
    await backfill_orphans_for_company(session, saved)
    await session.commit()
    return saved


@router.get("/{company_id}", response_model=CompanyRead)
async def get_company(company_id: UUID, session: DBSession, _user: CurrentUser):
    return await CompanyRepository(session).get_or_raise(company_id)


@router.put("/{company_id}", response_model=CompanyRead)
async def update_company(company_id: UUID, payload: CompanyUpdate, session: DBSession, _user: CurrentUser):
    repo = CompanyRepository(session)
    company = await repo.get_or_raise(company_id)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(company, key, value)
    company.icp_score, company.icp_tier = score_company(company)
    company.updated_at = datetime.utcnow()
    return await repo.save(company)


@router.patch("/{company_id}", response_model=CompanyRead)
async def patch_company(company_id: UUID, payload: CompanyUpdate, session: DBSession, _user: CurrentUser):
    repo = CompanyRepository(session)
    company = await repo.get_or_raise(company_id)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(company, key, value)
    company.updated_at = datetime.utcnow()
    return await repo.save(company)


@router.delete("/{company_id}", status_code=204)
async def delete_company(company_id: UUID, session: DBSession, _admin: AdminUser):
    repo = CompanyRepository(session)
    await repo.get_or_raise(company_id)  # 404 if not found
    await repo.delete_with_cascade(company_id)


@router.get("/{company_id}/deals", response_model=List[DealRead])
async def get_company_deals(company_id: UUID, session: DBSession, _user: CurrentUser):
    result = await session.execute(
        select(Deal)
        .where(Deal.company_id == company_id)
        .order_by(Deal.created_at.desc())
    )
    return result.scalars().all()
