from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Query

from app.core.dependencies import DBSession, Pagination
from app.core.exceptions import NotFoundError
from app.models.contact import Contact, ContactCreate, ContactRead, ContactUpdate
from app.repositories.contact import ContactRepository
from app.schemas.common import PaginatedResponse
from app.services.contact_tracking import apply_contact_tracking, to_contact_read
from app.services.persona_classifier import classify_persona

router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.get("/", response_model=PaginatedResponse[ContactRead])
async def list_contacts(
    session: DBSession,
    pagination: Pagination,
    company_id: Optional[UUID] = Query(default=None),
    q: Optional[str] = Query(default=None, description="Search by name, email, title, or company"),
    persona: Optional[str] = Query(default=None),
    outreach_lane: Optional[str] = Query(default=None),
    sequence_status: Optional[str] = Query(default=None),
    email_state: Optional[str] = Query(default=None, description="has_email | missing_email | verified | unverified"),
):
    """
    Returns contacts with company_name populated via a single SQL JOIN.
    No second API call to /companies needed on the frontend.
    """
    repo = ContactRepository(session)
    items, total = await repo.list_with_company_name(
        company_id=company_id,
        q=q,
        persona=persona,
        outreach_lane=outreach_lane,
        sequence_status=sequence_status,
        email_state=email_state,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=ContactRead, status_code=201)
async def create_contact(payload: ContactCreate, session: DBSession):
    contact = Contact(**payload.model_dump())
    if not contact.persona:
        contact.persona = classify_persona(contact)
    saved = await ContactRepository(session).save(contact)
    return await to_contact_read(session, saved)


@router.get("/{contact_id}", response_model=ContactRead)
async def get_contact(contact_id: UUID, session: DBSession):
    contact = await ContactRepository(session).get_or_raise(contact_id)
    return await to_contact_read(session, contact)


@router.put("/{contact_id}", response_model=ContactRead)
async def update_contact(contact_id: UUID, payload: ContactUpdate, session: DBSession):
    repo = ContactRepository(session)
    contact = await repo.get_or_raise(contact_id)
    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(contact, key, value)
    if "title" in update_data or "seniority" in update_data:
        contact.persona = classify_persona(contact)
    contact.updated_at = datetime.utcnow()
    saved = await repo.save(contact)
    return await to_contact_read(session, saved)


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(contact_id: UUID, session: DBSession):
    repo = ContactRepository(session)
    await repo.get_or_raise(contact_id)
    await repo.delete_with_cascade(contact_id)


@router.post("/{contact_id}/enrich")
async def enrich_contact(contact_id: UUID, session: DBSession):
    repo = ContactRepository(session)
    contact = await repo.get_or_raise(contact_id)

    from app.clients.hunter import HunterClient
    hunter = HunterClient()
    enriched_fields: list[str] = []

    if contact.email:
        try:
            result = await hunter.verify_email(contact.email)
            if result:
                new_verified = result.get("result") == "deliverable"
                if new_verified != contact.email_verified:
                    contact.email_verified = new_verified
                    enriched_fields.append("email_verified")
        except Exception:
            pass

    old_persona = contact.persona
    contact.persona = classify_persona(contact)
    if contact.persona != old_persona:
        enriched_fields.append("persona")

    contact.updated_at = datetime.utcnow()
    await repo.save(contact)
    contact_read = await to_contact_read(session, contact)
    return {
        "contact_id": str(contact_id),
        "status": "enriched",
        "fields_updated": enriched_fields,
        "contact": contact_read,
    }


@router.post("/discover/{company_id}", response_model=list[ContactRead], status_code=201)
async def discover_contacts(company_id: UUID, session: DBSession):
    """
    Call Hunter domain-search for the given company and create any new contacts found.
    Skips duplicates by email. Returns the newly created contacts.
    """
    from app.repositories.company import CompanyRepository
    from app.clients.hunter import HunterClient
    from app.services.persona_classifier import classify_persona
    from sqlmodel import select

    company = await CompanyRepository(session).get_or_raise(company_id)

    # If the company was imported without a real domain, try to resolve it via AI first
    if company.domain.endswith(".unknown"):
        from app.services.domain_resolver import resolve_and_update_domain
        resolved = await resolve_and_update_domain(company, session)
        if not resolved:
            return []  # Can't search Hunter without a real domain

    hunter = HunterClient()
    hunter_data = await hunter.domain_search(company.domain)
    raw_contacts = (hunter_data or {}).get("contacts", [])

    created: list[Contact] = []
    for c in raw_contacts:
        email = (c.get("email") or "").strip()
        if not email:
            continue
        # Use first-row existence check to tolerate historical duplicate rows.
        existing = await session.execute(
            select(Contact).where(Contact.email == email).limit(1)
        )
        if existing.scalars().first():
            continue
        first = (c.get("first_name") or "").strip()
        last = (c.get("last_name") or "").strip()
        if not first and not last:
            prefix = email.split("@")[0]
            parts = prefix.replace(".", " ").replace("_", " ").split()
            first = parts[0].capitalize() if parts else prefix
            last = parts[1].capitalize() if len(parts) > 1 else ""
        contact = Contact(
            first_name=first,
            last_name=last,
            email=email,
            title=c.get("title"),
            linkedin_url=c.get("linkedin_url"),
            company_id=company.id,
        )
        contact.persona = classify_persona(contact)
        session.add(contact)
        created.append(contact)

    await session.commit()
    for c in created:
        await session.refresh(c)

    reads = [ContactRead.model_validate(c) for c in created]
    await apply_contact_tracking(session, reads)
    return reads


@router.get("/{contact_id}/brief")
async def get_contact_brief(contact_id: UUID, session: DBSession):
    """Generate AI stakeholder brief (Playwright + GPT-4o, 5-20s). Not cached."""
    from app.services.contact_intelligence import generate_contact_brief
    result = await generate_contact_brief(contact_id, session)
    if "error" in result:
        raise NotFoundError(result["error"])
    return result
