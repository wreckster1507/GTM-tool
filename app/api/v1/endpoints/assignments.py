"""
Assignment endpoints — Admin assigns companies/contacts to sales reps.

PATCH /assignments/company/{id}     Assign/unassign a company
PATCH /assignments/contact/{id}     Assign/unassign a contact
PATCH /assignments/bulk-companies   Bulk assign multiple companies
PATCH /assignments/bulk-contacts    Bulk assign multiple contacts
"""
from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter
from pydantic import BaseModel
from sqlmodel import select

from app.core.dependencies import AdminUser, CurrentUser, DBSession
from app.core.exceptions import NotFoundError
from app.models.company import Company, CompanyRead
from app.models.contact import Contact, ContactRead
from app.models.user import User

router = APIRouter(prefix="/assignments", tags=["assignments"])


class AssignRequest(BaseModel):
    user_id: Optional[UUID] = None  # None = unassign
    role: Optional[str] = None      # "ae" (default) or "sdr"


class BulkAssignRequest(BaseModel):
    ids: List[UUID]
    user_id: Optional[UUID] = None  # None = unassign


# ── Single assignment ────────────────────────────────────────────────────────


@router.patch("/company/{company_id}", response_model=CompanyRead)
async def assign_company(
    company_id: UUID,
    body: AssignRequest,
    session: DBSession,
    _admin: AdminUser,
):
    """Assign a company to a sales rep. Admin only. Pass user_id=null to unassign."""
    company = (
        await session.execute(select(Company).where(Company.id == company_id))
    ).scalar_one_or_none()
    if not company:
        raise NotFoundError("Company not found")

    if body.user_id:
        user = (await session.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
        if not user:
            raise NotFoundError("User not found")
        company.assigned_to_id = user.id
        company.assigned_rep = user.name
        company.assigned_rep_email = user.email
        company.assigned_rep_name = user.name
    else:
        company.assigned_to_id = None
        company.assigned_rep = None
        company.assigned_rep_email = None
        company.assigned_rep_name = None

    company.updated_at = datetime.utcnow()
    session.add(company)
    await session.commit()
    await session.refresh(company)
    return company


@router.patch("/contact/{contact_id}", response_model=ContactRead)
async def assign_contact(
    contact_id: UUID,
    body: AssignRequest,
    session: DBSession,
    _admin: AdminUser,
):
    """Assign a contact to a sales rep. Admin only.
    role="ae" (default) sets AE, role="sdr" sets SDR. Pass user_id=null to unassign.
    """
    contact = (
        await session.execute(select(Contact).where(Contact.id == contact_id))
    ).scalar_one_or_none()
    if not contact:
        raise NotFoundError("Contact not found")

    is_sdr = (body.role or "ae") == "sdr"

    if body.user_id:
        user = (await session.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
        if not user:
            raise NotFoundError("User not found")
        if is_sdr:
            contact.sdr_id = user.id
            contact.sdr_name = user.name
        else:
            contact.assigned_to_id = user.id
            contact.assigned_rep_email = user.email
    else:
        if is_sdr:
            contact.sdr_id = None
            contact.sdr_name = None
        else:
            contact.assigned_to_id = None
            contact.assigned_rep_email = None

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    await session.commit()
    await session.refresh(contact)
    return contact


# ── Bulk assignment ──────────────────────────────────────────────────────────


@router.patch("/bulk-companies")
async def bulk_assign_companies(
    body: BulkAssignRequest,
    session: DBSession,
    _admin: AdminUser,
):
    """Bulk assign multiple companies to a sales rep. Admin only."""
    user = None
    if body.user_id:
        user = (await session.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
        if not user:
            raise NotFoundError("User not found")

    updated = 0
    for cid in body.ids:
        company = (
            await session.execute(select(Company).where(Company.id == cid))
        ).scalar_one_or_none()
        if not company:
            continue
        if user:
            company.assigned_to_id = user.id
            company.assigned_rep = user.name
            company.assigned_rep_email = user.email
            company.assigned_rep_name = user.name
        else:
            company.assigned_to_id = None
            company.assigned_rep = None
            company.assigned_rep_email = None
            company.assigned_rep_name = None
        company.updated_at = datetime.utcnow()
        session.add(company)
        updated += 1

    await session.commit()
    return {"updated": updated, "user_id": str(body.user_id) if body.user_id else None}


@router.patch("/bulk-contacts")
async def bulk_assign_contacts(
    body: BulkAssignRequest,
    session: DBSession,
    _admin: AdminUser,
):
    """Bulk assign multiple contacts to a sales rep. Admin only."""
    user = None
    if body.user_id:
        user = (await session.execute(select(User).where(User.id == body.user_id))).scalar_one_or_none()
        if not user:
            raise NotFoundError("User not found")

    updated = 0
    for cid in body.ids:
        contact = (
            await session.execute(select(Contact).where(Contact.id == cid))
        ).scalar_one_or_none()
        if not contact:
            continue
        if user:
            contact.assigned_to_id = user.id
            contact.assigned_rep_email = user.email
        else:
            contact.assigned_to_id = None
            contact.assigned_rep_email = None
        contact.updated_at = datetime.utcnow()
        session.add(contact)
        updated += 1

    await session.commit()
    return {"updated": updated, "user_id": str(body.user_id) if body.user_id else None}
