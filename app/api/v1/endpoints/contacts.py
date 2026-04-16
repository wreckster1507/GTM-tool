from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlmodel import SQLModel, select

from app.core.dependencies import AdminUser, CurrentUser, DBSession, Pagination
from app.core.exceptions import NotFoundError
from app.models.company import Company
from app.models.contact import Contact, ContactCreate, ContactRead, ContactUpdate
from app.repositories.contact import ContactRepository
from app.schemas.common import PaginatedResponse
from app.services.account_sourcing import (
    parse_prospect_upload_file,
    refresh_company_prospecting_fields,
    refresh_contact_sequence_plan,
    row_to_company_fields,
    row_to_contact_fields,
)
from app.services.contact_tracking import apply_contact_tracking, to_contact_read
from app.services.permissions import require_workspace_permission
from app.services.persona_classifier import classify_persona

router = APIRouter(prefix="/contacts", tags=["contacts"])


class ProspectImportMissingCompany(SQLModel):
    name: str
    domain: Optional[str] = None
    contacts_count: int = 0


class ProspectImportResponse(SQLModel):
    imported_rows: int
    created_count: int
    updated_count: int
    skipped_count: int
    missing_company_count: int
    missing_companies: list[ProspectImportMissingCompany]
    message: str


async def _resolve_uploaded_company(session: DBSession, row: dict[str, str]) -> Company | None:
    company_fields = row_to_company_fields(row)
    domain = (company_fields.get("domain") or "").strip().lower()
    name = (company_fields.get("name") or "").strip()

    company: Company | None = None
    if domain and not domain.endswith(".unknown"):
        company = (
            await session.execute(select(Company).where(Company.domain == domain).limit(1))
        ).scalars().first()
    if not company and name:
        company = (
            await session.execute(
                select(Company).where(func.lower(Company.name) == name.lower()).limit(1)
            )
        ).scalars().first()
    return company


def _placeholder_company_domain(name: str) -> str:
    base = "".join(ch.lower() if ch.isalnum() else "-" for ch in (name or "").strip())
    slug = "-".join(part for part in base.split("-") if part) or "unknown-company"
    return f"{slug}.unknown"


async def _get_or_create_uploaded_placeholder_company(
    session: DBSession,
    row: dict[str, str],
    current_user: CurrentUser,
) -> tuple[Company | None, bool]:
    company = await _resolve_uploaded_company(session, row)
    if company:
        return company, False

    company_fields = row_to_company_fields(row)
    company_name = (company_fields.get("name") or "").strip()
    if not company_name:
        return None, False

    company_domain = (company_fields.get("domain") or "").strip().lower() or _placeholder_company_domain(company_name)
    company = Company(
        name=company_name,
        domain=company_domain,
        industry=(company_fields.get("industry") or "").strip() or None,
        region=(company_fields.get("region") or "").strip() or None,
        headquarters=(company_fields.get("headquarters") or "").strip() or None,
        description=(company_fields.get("description") or "").strip() or None,
        assigned_rep_email=(company_fields.get("assigned_rep_email") or "").strip() or None,
        recommended_outreach_lane=(company_fields.get("recommended_outreach_lane") or "").strip() or None,
        enrichment_sources={
            "prospect_import_placeholder": {
                "source": "prospect_import",
                "uploaded_by": current_user.email,
                "needs_enrichment": True,
            }
        },
    )
    session.add(company)
    await session.flush()
    return company, True


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
    ae_id: Optional[str] = Query(default=None, description="Filter by one or more assigned AE user IDs"),
    sdr_id: Optional[str] = Query(default=None, description="Filter by one or more assigned SDR user IDs"),
    prospect_only: bool = Query(default=False, description="Exclude internal/generated contacts and obvious company mismatches"),
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
        ae_id=ae_id,
        sdr_id=sdr_id,
        prospect_only=prospect_only,
        skip=pagination.skip,
        limit=pagination.limit,
    )
    return PaginatedResponse.build(items, total, pagination.skip, pagination.limit)


@router.post("/", response_model=ContactRead, status_code=201)
async def create_contact(payload: ContactCreate, session: DBSession, _user: CurrentUser):
    contact = Contact(**payload.model_dump())
    current_enrichment = contact.enrichment_data if isinstance(contact.enrichment_data, dict) else {}
    current_enrichment.setdefault("source", "manual_prospect")
    current_enrichment.setdefault("uploaded_by", _user.email)
    current_enrichment.setdefault("uploaded_at", datetime.utcnow().isoformat())
    contact.enrichment_data = current_enrichment
    if not contact.persona:
        contact.persona = classify_persona(contact)
    saved = await ContactRepository(session).save(contact)
    return await to_contact_read(session, saved)


@router.get("/{contact_id}", response_model=ContactRead)
async def get_contact(contact_id: UUID, session: DBSession):
    contact = await ContactRepository(session).get_or_raise(contact_id)
    return await to_contact_read(session, contact)


@router.put("/{contact_id}", response_model=ContactRead)
async def update_contact(contact_id: UUID, payload: ContactUpdate, session: DBSession, _user: CurrentUser):
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


@router.delete("/bulk", status_code=204)
async def bulk_delete_contacts(session: DBSession, _admin: AdminUser):
    """Delete all contacts. Admin only."""
    repo = ContactRepository(session)
    await repo.delete_all()


@router.delete("/{contact_id}", status_code=204)
async def delete_contact(contact_id: UUID, session: DBSession, _user: CurrentUser):
    repo = ContactRepository(session)
    await repo.get_or_raise(contact_id)
    await repo.delete_with_cascade(contact_id)


@router.post("/{contact_id}/enrich")
async def enrich_contact(contact_id: UUID, session: DBSession, _user: CurrentUser):
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
async def discover_contacts(company_id: UUID, session: DBSession, _user: CurrentUser):
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


@router.post("/import-csv", response_model=ProspectImportResponse, status_code=201)
async def import_contacts_csv(
    current_user: CurrentUser,
    session: DBSession,
    file: UploadFile = File(...),
):
    await require_workspace_permission(session, current_user, "prospect_migration")

    lower_name = (file.filename or "").lower()
    if not (lower_name.endswith(".csv") or lower_name.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail="File must be a .csv or .xlsx")

    content = await file.read()
    rows = parse_prospect_upload_file(file.filename or "prospects.csv", content)
    if not rows:
        raise HTTPException(status_code=400, detail="No rows found in the upload")

    created_count = 0
    updated_count = 0
    skipped_count = 0
    touched_company_ids: set[UUID] = set()
    missing_companies: dict[str, ProspectImportMissingCompany] = {}

    for row in rows:
        company, created_placeholder_company = await _get_or_create_uploaded_placeholder_company(session, row, current_user)
        company_fields = row_to_company_fields(row)
        company_context = {
            "assigned_rep_email": company.assigned_rep_email if company else None,
            "recommended_outreach_lane": company.recommended_outreach_lane if company else None,
            "prospecting_profile": company.prospecting_profile if company else None,
            "enrichment_sources": company.enrichment_sources if company else None,
        }
        contact_fields = row_to_contact_fields(row, company_context)
        if not contact_fields:
            skipped_count += 1
            continue

        if not company:
            key = f"{(company_fields.get('domain') or '').strip().lower()}::{(company_fields.get('name') or '').strip().lower()}"
            current = missing_companies.get(key)
            if current:
                current.contacts_count += 1
            else:
                missing_companies[key] = ProspectImportMissingCompany(
                    name=(company_fields.get("name") or "Unknown company").strip(),
                    domain=(company_fields.get("domain") or "").strip() or None,
                    contacts_count=1,
                )
            skipped_count += 1
            continue

        if created_placeholder_company:
            key = f"{(company_fields.get('domain') or '').strip().lower()}::{(company_fields.get('name') or '').strip().lower()}"
            current = missing_companies.get(key)
            if current:
                current.contacts_count += 1
            else:
                missing_companies[key] = ProspectImportMissingCompany(
                    name=(company_fields.get("name") or "Unknown company").strip(),
                    domain=(company_fields.get("domain") or "").strip() or None,
                    contacts_count=1,
                )

        touched_company_ids.add(company.id)
        contact_fields["assigned_to_id"] = contact_fields.get("assigned_to_id") or company.assigned_to_id
        contact_fields["assigned_rep_email"] = contact_fields.get("assigned_rep_email") or company.assigned_rep_email
        contact_fields["sdr_id"] = contact_fields.get("sdr_id") or company.sdr_id
        contact_fields["sdr_name"] = contact_fields.get("sdr_name") or company.sdr_name
        contact_fields["company_id"] = company.id

        raw_enrichment = contact_fields.get("enrichment_data") if isinstance(contact_fields.get("enrichment_data"), dict) else {}
        raw_enrichment["source"] = "prospect_csv_upload"
        raw_enrichment["uploaded_by"] = current_user.email
        raw_enrichment["uploaded_at"] = datetime.utcnow().isoformat()
        contact_fields["enrichment_data"] = raw_enrichment

        email = (contact_fields.get("email") or "").strip().lower() if isinstance(contact_fields.get("email"), str) else None
        first_name = (contact_fields.get("first_name") or "").strip()
        last_name = (contact_fields.get("last_name") or "").strip()

        existing = None
        if email:
            existing = (
                await session.execute(select(Contact).where(Contact.email == email).limit(1))
            ).scalars().first()
        if not existing and first_name and last_name:
            existing = (
                await session.execute(
                    select(Contact).where(
                        Contact.company_id == company.id,
                        Contact.first_name == first_name,
                        Contact.last_name == last_name,
                    ).limit(1)
                )
            ).scalars().first()

        if existing and existing.company_id and existing.company_id != company.id:
            skipped_count += 1
            continue

        if existing:
            changed = False
            for key, value in contact_fields.items():
                if value in (None, "", []):
                    continue
                if key == "enrichment_data":
                    current_enrichment = existing.enrichment_data if isinstance(existing.enrichment_data, dict) else {}
                    current_enrichment.update(value)
                    if current_enrichment != existing.enrichment_data:
                        existing.enrichment_data = current_enrichment
                        changed = True
                    continue
                if getattr(existing, key, None) != value:
                    setattr(existing, key, value)
                    changed = True
            if changed or not existing.persona:
                existing.persona = classify_persona(existing)
                existing.updated_at = datetime.utcnow()
                refresh_contact_sequence_plan(existing, company)
                session.add(existing)
                updated_count += 1
            else:
                skipped_count += 1
        else:
            contact = Contact(**contact_fields)
            contact.persona = classify_persona(contact)
            refresh_contact_sequence_plan(contact, company)
            session.add(contact)
            created_count += 1

    await session.commit()

    for company_id in touched_company_ids:
        company = await session.get(Company, company_id)
        if not company:
            continue
        company_contacts = (
            await session.execute(select(Contact).where(Contact.company_id == company_id))
        ).scalars().all()
        refresh_company_prospecting_fields(company, company_contacts)
        session.add(company)
    await session.commit()

    missing_rows = sorted(missing_companies.values(), key=lambda item: (item.name.lower(), item.domain or ""))
    return ProspectImportResponse(
        imported_rows=len(rows),
        created_count=created_count,
        updated_count=updated_count,
        skipped_count=skipped_count,
        missing_company_count=len(missing_rows),
        missing_companies=missing_rows,
        message=(
            "Prospects imported successfully."
            if not missing_rows
            else "Prospects imported successfully. Placeholder companies were created for rows that still need enrichment."
        ),
    )


@router.get("/{contact_id}/brief")
async def get_contact_brief(contact_id: UUID, session: DBSession):
    """Generate AI stakeholder brief (Playwright + GPT-4o, 5-20s). Not cached."""
    from app.services.contact_intelligence import generate_contact_brief
    result = await generate_contact_brief(contact_id, session)
    if "error" in result:
        raise NotFoundError(result["error"])
    return result
