"""
Outreach routes — generate and manage AI-powered email/LinkedIn sequences.

Endpoints:
  POST /outreach/generate/{contact_id}      — generate sequence for one contact
  POST /outreach/bulk/{company_id}          — generate sequences for all contacts at a company
  GET  /outreach/sequences/{contact_id}     — retrieve sequence for a contact
  PATCH /outreach/sequences/{sequence_id}   — edit a draft (before sending)
  GET  /outreach/company/{company_id}       — all sequences for a company
"""
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.outreach import OutreachSequence, OutreachSequenceRead
from app.services.outreach_generator import generate_sequence

router = APIRouter(prefix="/outreach", tags=["outreach"])


@router.post("/generate/{contact_id}", response_model=OutreachSequenceRead)
async def generate_contact_sequence(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Generate a 3-touch email cadence + LinkedIn message for a single contact.
    Uses GPT-4o persona-aware prompts (economic_buyer / champion / technical_evaluator).
    Re-generates if a sequence already exists.
    """
    seq = await generate_sequence(contact_id, session)
    if not seq:
        raise HTTPException(status_code=404, detail="Contact not found")
    return seq


@router.post("/bulk/{company_id}")
async def generate_bulk_sequences(
    company_id: UUID,
    persona_filter: Optional[str] = None,
    session: AsyncSession = Depends(get_session),
):
    """
    Generate sequences for all contacts at a company.
    Optionally filter by persona (economic_buyer, champion, technical_evaluator).
    Skips contacts who already have a sequence unless you call generate/{contact_id} directly.
    """
    from app.models.contact import Contact

    query = select(Contact).where(Contact.company_id == company_id)
    if persona_filter:
        query = query.where(Contact.persona == persona_filter)

    result = await session.execute(query)
    contacts = result.scalars().all()

    if not contacts:
        raise HTTPException(status_code=404, detail="No contacts found for this company")

    generated = []
    skipped = []
    failed = []

    for contact in contacts:
        # Skip if sequence already exists
        existing = await session.execute(
            select(OutreachSequence).where(OutreachSequence.contact_id == contact.id)
        )
        if existing.scalar_one_or_none():
            skipped.append(str(contact.id))
            continue

        try:
            seq = await generate_sequence(contact.id, session)
            if seq:
                generated.append({
                    "contact_id": str(contact.id),
                    "name": f"{contact.first_name} {contact.last_name}",
                    "persona": contact.persona,
                    "sequence_id": str(seq.id),
                })
        except Exception as e:
            failed.append({"contact_id": str(contact.id), "error": str(e)})

    return {
        "company_id": str(company_id),
        "total_contacts": len(contacts),
        "generated": len(generated),
        "skipped_existing": len(skipped),
        "failed": len(failed),
        "sequences": generated,
    }


@router.get("/sequences/{contact_id}", response_model=OutreachSequenceRead)
async def get_contact_sequence(
    contact_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """Retrieve the current outreach sequence for a contact."""
    result = await session.execute(
        select(OutreachSequence).where(OutreachSequence.contact_id == contact_id)
    )
    seq = result.scalar_one_or_none()
    if not seq:
        raise HTTPException(status_code=404, detail="No sequence found. Call POST /outreach/generate/{contact_id} first.")
    return seq


@router.patch("/sequences/{sequence_id}", response_model=OutreachSequenceRead)
async def update_sequence(
    sequence_id: UUID,
    updates: dict,
    session: AsyncSession = Depends(get_session),
):
    """
    Edit a sequence draft — update email body, subject lines, or LinkedIn message.
    Accepted fields: email_1, email_2, email_3, subject_1, subject_2, subject_3,
                     linkedin_message, status.
    """
    from datetime import datetime

    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")

    allowed_fields = {
        "email_1", "email_2", "email_3",
        "subject_1", "subject_2", "subject_3",
        "linkedin_message", "status",
    }
    for field, value in updates.items():
        if field in allowed_fields:
            setattr(seq, field, value)

    seq.updated_at = datetime.utcnow()
    session.add(seq)
    await session.commit()
    await session.refresh(seq)
    return seq


@router.get("/company/{company_id}")
async def get_company_sequences(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """List all outreach sequences for every contact at a company."""
    from app.models.contact import Contact

    result = await session.execute(
        select(OutreachSequence, Contact)
        .join(Contact, OutreachSequence.contact_id == Contact.id)
        .where(OutreachSequence.company_id == company_id)
    )
    rows = result.all()

    return [
        {
            "sequence_id": str(seq.id),
            "contact_id": str(seq.contact_id),
            "contact_name": f"{contact.first_name} {contact.last_name}",
            "title": contact.title,
            "persona": seq.persona,
            "status": seq.status,
            "subject_1": seq.subject_1,
            "email_1_preview": (seq.email_1 or "")[:200] + "..." if seq.email_1 else None,
            "generated_at": seq.generated_at.isoformat() if seq.generated_at else None,
        }
        for seq, contact in rows
    ]
