from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter
from sqlmodel import select

from app.core.dependencies import DBSession
from app.core.exceptions import NotFoundError, ValidationError
from app.models.contact import Contact
from app.models.outreach import OutreachSequence, OutreachSequenceRead
from app.repositories.outreach import OutreachRepository
from app.services.outreach_generator import generate_sequence

router = APIRouter(prefix="/outreach", tags=["outreach"])

_ALLOWED_SEQUENCE_FIELDS = frozenset(
    ["email_1", "email_2", "email_3", "subject_1", "subject_2", "subject_3",
     "linkedin_message", "status"]
)


@router.post("/generate/{contact_id}", response_model=OutreachSequenceRead)
async def generate_contact_sequence(contact_id: UUID, session: DBSession):
    """Generate a 3-touch email cadence + LinkedIn message for a single contact."""
    seq = await generate_sequence(contact_id, session)
    if not seq:
        raise NotFoundError("Contact not found")
    return seq


@router.post("/bulk/{company_id}")
async def generate_bulk_sequences(
    company_id: UUID,
    session: DBSession,
    persona_filter: Optional[str] = None,
):
    """Generate sequences for all contacts at a company (skips existing)."""
    query = select(Contact).where(Contact.company_id == company_id)
    if persona_filter:
        query = query.where(Contact.persona == persona_filter)

    contacts = (await session.execute(query)).scalars().all()
    if not contacts:
        raise NotFoundError("No contacts found for this company")

    repo = OutreachRepository(session)
    generated, skipped, failed = [], [], []

    for contact in contacts:
        if await repo.exists_for_contact(contact.id):
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
async def get_contact_sequence(contact_id: UUID, session: DBSession):
    seq = await OutreachRepository(session).get_by_contact(contact_id)
    if not seq:
        raise NotFoundError(
            "No sequence found. Call POST /outreach/generate/{contact_id} first."
        )
    return seq


@router.patch("/sequences/{sequence_id}", response_model=OutreachSequenceRead)
async def update_sequence(sequence_id: UUID, updates: dict, session: DBSession):
    repo = OutreachRepository(session)
    seq = await repo.get_or_raise(sequence_id)

    clean = {k: v for k, v in updates.items() if k in _ALLOWED_SEQUENCE_FIELDS}
    if not clean:
        raise ValidationError(f"No valid fields. Allowed: {sorted(_ALLOWED_SEQUENCE_FIELDS)}")

    clean["updated_at"] = datetime.utcnow()
    return await repo.update(seq, clean)


@router.get("/company/{company_id}")
async def get_company_sequences(company_id: UUID, session: DBSession):
    rows = (
        await session.execute(
            select(OutreachSequence, Contact)
            .join(Contact, OutreachSequence.contact_id == Contact.id)
            .where(OutreachSequence.company_id == company_id)
        )
    ).all()

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
