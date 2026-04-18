from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Body
from sqlmodel import select

from app.clients.instantly import InstantlyClient, InstantlyError
from app.config import settings
from app.core.dependencies import CurrentUser, DBSession
from app.core.exceptions import NotFoundError, ValidationError
from app.models.contact import Contact
from app.models.outreach import (
    OutreachSequence,
    OutreachSequenceRead,
    OutreachStep,
    OutreachStepCreate,
    OutreachStepRead,
    OutreachStepUpdate,
)
from app.repositories.outreach import OutreachRepository
from app.services.outreach_generator import generate_sequence

router = APIRouter(prefix="/outreach", tags=["outreach"])

_ALLOWED_SEQUENCE_FIELDS = frozenset(
    ["email_1", "email_2", "email_3", "subject_1", "subject_2", "subject_3",
     "linkedin_message", "status"]
)


def _normalize_variants_payload(raw):
    if isinstance(raw, dict):
        payload = dict(raw)
        payload_variants = payload.get("variants")
        payload["variants"] = payload_variants if isinstance(payload_variants, list) else []
        channel = str(payload.get("channel") or "email").strip().lower()
        payload["channel"] = channel if channel in {"email", "call", "linkedin"} else "email"
        return payload
    if isinstance(raw, list):
        return {"channel": "email", "variants": raw}
    return {"channel": "email", "variants": []}


def _sequence_started(seq: OutreachSequence) -> bool:
    return bool(
        seq.instantly_campaign_id
        or seq.launched_at
        or seq.status in {"launched", "sent", "replied", "completed", "meeting_booked"}
        or seq.instantly_campaign_status in {"active", "paused", "completed"}
    )


# ── Sequence generation ────────────────────────────────────────────────────────

@router.post("/generate/{contact_id}", response_model=OutreachSequenceRead)
async def generate_contact_sequence(contact_id: UUID, session: DBSession, _user: CurrentUser):
    """Generate a multi-step email cadence + LinkedIn message for a contact."""
    seq = await generate_sequence(contact_id, session)
    if not seq:
        raise NotFoundError("Contact not found")
    return seq


@router.post("/bulk/{company_id}")
async def generate_bulk_sequences(
    company_id: UUID,
    session: DBSession,
    _user: CurrentUser,
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


# ── Sequence read / update ─────────────────────────────────────────────────────

@router.get("/sequences/{contact_id}", response_model=OutreachSequenceRead)
async def get_contact_sequence(contact_id: UUID, session: DBSession, _user: CurrentUser):
    seq = await OutreachRepository(session).get_by_contact(contact_id)
    if not seq:
        raise NotFoundError(
            "No sequence found. Call POST /outreach/generate/{contact_id} first."
        )
    return seq


@router.patch("/sequences/{sequence_id}", response_model=OutreachSequenceRead)
async def update_sequence(sequence_id: UUID, updates: dict, session: DBSession, _user: CurrentUser):
    repo = OutreachRepository(session)
    seq = await repo.get_or_raise(sequence_id)

    clean = {k: v for k, v in updates.items() if k in _ALLOWED_SEQUENCE_FIELDS}
    if not clean:
        raise ValidationError(f"No valid fields. Allowed: {sorted(_ALLOWED_SEQUENCE_FIELDS)}")

    clean["updated_at"] = datetime.utcnow()
    return await repo.update(seq, clean)


@router.get("/company/{company_id}")
async def get_company_sequences(company_id: UUID, session: DBSession, _user: CurrentUser):
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
            "instantly_campaign_id": seq.instantly_campaign_id,
            "instantly_campaign_status": seq.instantly_campaign_status,
            "subject_1": seq.subject_1,
            "email_1_preview": (seq.email_1 or "")[:200] + "..." if seq.email_1 else None,
            "generated_at": seq.generated_at.isoformat() if seq.generated_at else None,
            "launched_at": seq.launched_at.isoformat() if seq.launched_at else None,
        }
        for seq, contact in rows
    ]


# ── Steps CRUD ────────────────────────────────────────────────────────────────

@router.get("/sequences/{sequence_id}/steps", response_model=list[OutreachStepRead])
async def get_steps(sequence_id: UUID, session: DBSession, _user: CurrentUser):
    """Get all steps for a sequence, ordered by step_number."""
    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise NotFoundError("Sequence not found")

    result = await session.execute(
        select(OutreachStep)
        .where(OutreachStep.sequence_id == sequence_id)
        .order_by(OutreachStep.step_number)
    )
    return result.scalars().all()


@router.post("/sequences/{sequence_id}/steps", response_model=OutreachStepRead)
async def add_step(sequence_id: UUID, step_in: OutreachStepCreate, session: DBSession, _user: CurrentUser):
    """Add a new step to a sequence (before it's launched to Instantly)."""
    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise NotFoundError("Sequence not found")
    if _sequence_started(seq):
        raise ValidationError("Cannot change sequence timing after sequencing has started")

    step = OutreachStep(
        sequence_id=sequence_id,
        step_number=step_in.step_number,
        subject=step_in.subject,
        body=step_in.body,
        delay_value=step_in.delay_value,
        delay_unit=step_in.delay_unit,
        variants=_normalize_variants_payload(step_in.variants),
    )
    step.channel = step_in.channel
    session.add(step)
    await session.commit()
    await session.refresh(step)
    return step


@router.patch("/steps/{step_id}", response_model=OutreachStepRead)
async def update_step(step_id: UUID, updates: OutreachStepUpdate, session: DBSession, _user: CurrentUser):
    """Edit a step's content, delay, or variants."""
    step = await session.get(OutreachStep, step_id)
    if not step:
        raise NotFoundError("Step not found")

    seq = await session.get(OutreachSequence, step.sequence_id)
    if seq and _sequence_started(seq):
        raise ValidationError("Cannot change sequence timing after sequencing has started")

    update_data = updates.model_dump(exclude_none=True)
    for key, val in update_data.items():
        if key == "variants":
            step.variants = _normalize_variants_payload(val)
        elif key == "channel":
            step.channel = val
        else:
            setattr(step, key, val)
    step.updated_at = datetime.utcnow()

    session.add(step)
    await session.commit()
    await session.refresh(step)
    return step


@router.delete("/steps/{step_id}")
async def delete_step(step_id: UUID, session: DBSession, _user: CurrentUser):
    """Remove a step from a sequence (before launch only)."""
    step = await session.get(OutreachStep, step_id)
    if not step:
        raise NotFoundError("Step not found")

    seq = await session.get(OutreachSequence, step.sequence_id)
    if seq and _sequence_started(seq):
        raise ValidationError("Cannot change sequence timing after sequencing has started")

    await session.delete(step)
    await session.commit()
    return {"status": "deleted", "step_id": str(step_id)}


# ── Launch to Instantly ───────────────────────────────────────────────────────

@router.post("/launch/{sequence_id}")
async def launch_sequence(
    sequence_id: UUID,
    session: DBSession,
    _user: CurrentUser,
    sending_account: str = Body(..., embed=True),
    campaign_name: Optional[str] = Body(None, embed=True),
):
    """
    Launch a sequence to Instantly.ai.

    Flow:
    1. Load sequence + steps (falls back to email_1/2/3 if no steps exist)
    2. Create campaign in Instantly with all steps
    3. Activate the campaign
    4. Add the contact as a lead to the campaign
    5. Update sequence with instantly_campaign_id + status
    6. Update contact instantly_status + sequence_status

    sending_account: the email address of the Instantly sending account to use.
    campaign_name: optional override; defaults to "Contact Name — Company"
    """
    # ── Load sequence ──────────────────────────────────────────────────────────
    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise NotFoundError("Sequence not found")

    if _sequence_started(seq):
        raise ValidationError(
            f"Sequence already launched. Instantly campaign: {seq.instantly_campaign_id}"
        )

    # ── Load contact ───────────────────────────────────────────────────────────
    contact = await session.get(Contact, seq.contact_id)
    if not contact:
        raise NotFoundError("Contact not found")

    if not contact.email:
        raise ValidationError("Contact has no email address — cannot launch sequence")

    # ── Load steps (prefer OutreachStep records, fall back to email_1/2/3) ────
    steps_result = await session.execute(
        select(OutreachStep)
        .where(OutreachStep.sequence_id == sequence_id)
        .order_by(OutreachStep.step_number)
    )
    steps = steps_result.scalars().all()

    if not steps:
        # Fallback: build steps from the legacy email_1/2/3 fields
        steps = _steps_from_legacy(seq)

    if not steps:
        raise ValidationError(
            "No email steps found. Generate the sequence first or add steps manually."
        )

    # ── Build payload for Instantly ────────────────────────────────────────────
    from app.models.company import Company
    company = await session.get(Company, seq.company_id) if seq.company_id else None
    company_name = company.name if company else "Company"

    name = campaign_name or f"{contact.first_name} {contact.last_name} — {company_name}"

    email_steps = [step for step in steps if getattr(step, "channel", "email") == "email"]

    if not email_steps:
        raise ValidationError("This sequence has no email steps to launch yet. Add at least one email touch before launching.")

    instantly_steps = [
        {
            "subject": step.subject or (f"Re: {email_steps[0].subject}" if i > 0 else "Hello"),
            "body": step.body,
            "delay_value": step.delay_value,
            # Omit delay_unit — Instantly defaults to days; including it can
            # cause validation errors if the value doesn't match their allowlist
            "variants": _normalize_variants_payload(step.variants).get("variants") or [],
        }
        for i, step in enumerate(email_steps)
    ]

    # ── Call Instantly API ─────────────────────────────────────────────────────
    client = InstantlyClient()

    try:
        campaign = await client.create_campaign(
            name=name,
            sending_accounts=[sending_account],
            steps=instantly_steps,
        )
    except InstantlyError as e:
        raise ValidationError(f"Instantly campaign creation failed: {e.detail}")

    if not campaign:
        raise ValidationError("Instantly API returned no campaign (check INSTANTLY_API_KEY)")

    campaign_id = campaign.get("id") or campaign.get("campaign_id")

    # Activate the campaign so it starts sending
    try:
        await client.activate_campaign(campaign_id)
    except InstantlyError as e:
        # Non-fatal — campaign exists, activation can be retried
        import logging
        logging.getLogger(__name__).warning("Campaign activation failed: %s", e)

    # ── Add contact as lead ────────────────────────────────────────────────────
    try:
        await client.add_lead(
            campaign_id=campaign_id,
            email=contact.email,
            first_name=contact.first_name or "",
            last_name=contact.last_name or "",
            company_name=company_name,
            job_title=contact.title or "",
            linkedin_url=contact.linkedin_url or "",
            custom_variables={
                "persona": seq.persona or "",
                "conversation_starter": contact.conversation_starter or "",
            },
        )
    except InstantlyError as e:
        raise ValidationError(f"Failed to add lead to Instantly campaign: {e.detail}")

    # ── Persist campaign ID back to CRM ───────────────────────────────────────
    now = datetime.utcnow()

    seq.instantly_campaign_id = campaign_id
    seq.instantly_campaign_status = "active"
    seq.status = "launched"
    seq.launched_at = now
    seq.updated_at = now
    session.add(seq)

    contact.instantly_campaign_id = campaign_id
    contact.instantly_status = "pushed"
    contact.sequence_status = "queued_instantly"
    contact.updated_at = now
    session.add(contact)

    # Register our webhook if not already registered
    if settings.INSTANTLY_WEBHOOK_URL:
        try:
            await client.ensure_webhook(
                url=settings.INSTANTLY_WEBHOOK_URL,
                event_types=[
                    "email_sent", "email_opened", "email_link_clicked",
                    "email_bounced", "reply_received", "lead_unsubscribed",
                    "lead_interested", "lead_not_interested", "lead_meeting_booked",
                ],
            )
        except Exception:
            pass  # Webhook registration failure is non-fatal

    await session.commit()

    return {
        "status": "launched",
        "sequence_id": str(sequence_id),
        "instantly_campaign_id": campaign_id,
        "contact_email": contact.email,
        "steps_count": len(email_steps),
        "campaign_name": name,
    }


@router.get("/launch-status/{sequence_id}")
async def get_launch_status(sequence_id: UUID, session: DBSession, _user: CurrentUser):
    """Fetch live campaign stats from Instantly for a launched sequence."""
    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise NotFoundError("Sequence not found")

    if not seq.instantly_campaign_id:
        return {"status": "not_launched"}

    client = InstantlyClient()
    try:
        campaign = await client.get_campaign(seq.instantly_campaign_id)
    except InstantlyError as e:
        raise ValidationError(f"Failed to fetch campaign from Instantly: {e.detail}")

    return {
        "sequence_id": str(sequence_id),
        "instantly_campaign_id": seq.instantly_campaign_id,
        "campaign": campaign,
    }


# ── Replies ───────────────────────────────────────────────────────────────────

@router.get("/replies/{sequence_id}")
async def get_replies(sequence_id: UUID, session: DBSession, _user: CurrentUser):
    """Fetch reply emails from Instantly Unibox for a launched sequence."""
    seq = await session.get(OutreachSequence, sequence_id)
    if not seq:
        raise NotFoundError("Sequence not found")

    if not seq.instantly_campaign_id:
        return {"replies": []}

    contact = await session.get(Contact, seq.contact_id)

    client = InstantlyClient()
    replies = await client.get_reply_thread(
        lead_email=contact.email if contact else "",
        campaign_id=seq.instantly_campaign_id,
    )

    return {"sequence_id": str(sequence_id), "replies": replies}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _steps_from_legacy(seq: OutreachSequence) -> list:
    """
    Convert the legacy email_1/2/3 fields into a list of step-like dicts
    so they can be pushed to Instantly even if OutreachStep records don't exist yet.
    Returns simple namespace objects with the needed attributes.
    """
    from types import SimpleNamespace

    steps = []
    pairs = [
        (seq.subject_1, seq.email_1, 0),
        (seq.subject_2, seq.email_2, 3),
        (seq.subject_3, seq.email_3, 7),
    ]
    for i, (subject, body, delay) in enumerate(pairs):
        if body:
            steps.append(SimpleNamespace(
                channel="email",
                subject=subject,
                body=body,
                delay_value=delay,
                delay_unit="Days",
                variants=None,
            ))
    return steps
