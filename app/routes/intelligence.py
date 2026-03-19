"""
Pre-meeting intelligence routes.

Endpoints:
  GET  /intelligence/{company_id}          — generate account brief (Playwright + GPT-4o)
  POST /outreach/send/{sequence_id}        — send email via Resend
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.database import get_session
from app.models.outreach import OutreachSequence
from app.services.pre_meeting import generate_account_brief

router = APIRouter(tags=["intelligence"])


@router.get("/intelligence/{company_id}")
async def get_account_brief(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
):
    """
    Run full pre-meeting research pipeline:
    Playwright scrapes company website → Google News signals →
    GPT-4o synthesises into 3-bullet account brief.
    Takes 5-15s (Playwright is doing real browser work).
    """
    result = await generate_account_brief(company_id, session)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


@router.post("/outreach/send/{sequence_id}")
async def send_outreach_email(
    sequence_id: UUID,
    payload: dict,
    session: AsyncSession = Depends(get_session),
):
    """
    Send one touch of an outreach sequence via Resend.

    Body: { "email_number": 1 | 2 | 3, "to_email": "prospect@company.com" }

    Updates sequence status to 'sent' after successful delivery.
    """
    from app.clients.resend_client import send_email
    from app.models.contact import Contact

    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")

    email_number = payload.get("email_number", 1)
    to_email = payload.get("to_email", "")

    # If no email provided, use the contact's email from DB
    if not to_email:
        contact = await session.get(Contact, seq.contact_id)
        if contact and contact.email:
            to_email = contact.email
        else:
            raise HTTPException(
                status_code=400,
                detail="No email address provided and contact has no email on file",
            )

    # Pick the right email + subject
    email_map = {
        1: (seq.email_1, seq.subject_1),
        2: (seq.email_2, seq.subject_2),
        3: (seq.email_3, seq.subject_3),
    }
    body, subject = email_map.get(email_number, (seq.email_1, seq.subject_1))

    if not body:
        raise HTTPException(
            status_code=400,
            detail=f"Email {email_number} has no content. Generate the sequence first.",
        )

    result = await send_email(
        to=to_email,
        subject=subject or f"Following up from Beacon.li",
        body=body,
    )

    if result.get("status") in ("sent", "mock_sent"):
        seq.status = "sent"
        seq.updated_at = datetime.utcnow()
        session.add(seq)
        await session.commit()

    return {
        "sequence_id": str(sequence_id),
        "email_number": email_number,
        "to": to_email,
        "subject": subject,
        "resend_id": result.get("id"),
        "status": result.get("status"),
    }
