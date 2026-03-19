from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.contact import Contact, ContactCreate, ContactRead, ContactUpdate
from app.services.persona_classifier import classify_persona

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("/", response_model=List[ContactRead])
async def list_contacts(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    company_id: Optional[UUID] = Query(default=None),
    session: AsyncSession = Depends(get_session),
):
    query = select(Contact)
    if company_id:
        query = query.where(Contact.company_id == company_id)
    result = await session.execute(query.offset(skip).limit(limit))
    return result.scalars().all()


@router.post("/", response_model=ContactRead, status_code=201)
async def create_contact(
    payload: ContactCreate,
    session: AsyncSession = Depends(get_session),
):
    contact = Contact(**payload.model_dump())
    # Auto-classify persona from title + seniority
    if not contact.persona:
        contact.persona = classify_persona(contact)

    session.add(contact)
    await session.commit()
    await session.refresh(contact)
    return contact


@router.get("/{contact_id}", response_model=ContactRead)
async def get_contact(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    return contact


@router.put("/{contact_id}", response_model=ContactRead)
async def update_contact(
    contact_id: UUID,
    payload: ContactUpdate,
    session: AsyncSession = Depends(get_session),
):
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(contact, key, value)

    # Re-classify if title or seniority changed
    if "title" in update_data or "seniority" in update_data:
        contact.persona = classify_persona(contact)

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    await session.commit()
    await session.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Delete a contact and its dependent outreach sequences and activities."""
    from app.models.outreach import OutreachSequence
    from app.models.activity import Activity

    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    # Delete outreach sequences referencing this contact
    seqs = await session.execute(
        select(OutreachSequence).where(OutreachSequence.contact_id == contact_id)
    )
    for seq in seqs.scalars().all():
        await session.delete(seq)

    # Delete activities referencing this contact
    acts = await session.execute(
        select(Activity).where(Activity.contact_id == contact_id)
    )
    for act in acts.scalars().all():
        await session.delete(act)

    await session.delete(contact)
    await session.commit()


@router.post("/{contact_id}/enrich")
async def enrich_contact(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Re-enrich a single contact: refresh from Hunter (email verification)
    and re-classify persona from title/seniority.
    """
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    from app.clients.hunter import HunterClient
    hunter = HunterClient()

    enriched_fields: list[str] = []

    # Verify email if present
    if contact.email:
        try:
            result = await hunter.verify_email(contact.email)
            if result:
                old_verified = contact.email_verified
                contact.email_verified = result.get("result") == "deliverable"
                if contact.email_verified != old_verified:
                    enriched_fields.append("email_verified")
        except Exception:
            pass

    # Re-classify persona
    old_persona = contact.persona
    contact.persona = classify_persona(contact)
    if contact.persona != old_persona:
        enriched_fields.append("persona")

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    await session.commit()
    await session.refresh(contact)

    return {
        "contact_id": str(contact_id),
        "status": "enriched",
        "fields_updated": enriched_fields,
        "contact": ContactRead.model_validate(contact),
    }


@router.get("/{contact_id}/brief")
async def get_contact_brief(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Generate an AI stakeholder brief for a contact.
    Playwright scrapes their LinkedIn (if URL known) + GPT-4o synthesises.
    Takes 5–20s. Results are NOT persisted — call on demand.
    """
    from app.services.contact_intelligence import generate_contact_brief
    result = await generate_contact_brief(contact_id, session)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result
