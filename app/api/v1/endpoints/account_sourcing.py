"""
Account Sourcing — CSV upload, tiered enrichment, re-enrich.

Endpoints:
  POST /upload              Upload CSV → create batch + companies → queue enrichment
  GET  /batches/{id}        Poll batch status
  GET  /batches/{id}/companies  Companies in a batch with enrichment data
  GET  /companies           All sourced companies (across batches)
  POST /companies/{id}/re-enrich     Re-run standard pipeline
  GET  /companies/{id}/contacts      Contacts discovered for a company
  POST /contacts/{id}/re-enrich      Re-enrich a single contact
  POST /companies/{id}/push-instantly  Push contacts to Instantly (placeholder)
"""
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, UploadFile
from sqlmodel import select

from app.core.dependencies import DBSession, Pagination
from app.models.company import Company, CompanyRead
from app.models.contact import Contact, ContactRead
from app.models.sourcing_batch import SourcingBatch, SourcingBatchRead
from app.repositories.company import CompanyRepository
from app.services.account_sourcing import parse_csv, row_to_company_fields
from app.services.icp_scorer import score_company

router = APIRouter(prefix="/account-sourcing", tags=["account-sourcing"])


# ── CSV Upload ─────────────────────────────────────────────────────────────────

@router.post("/upload", response_model=SourcingBatchRead, status_code=202)
async def upload_csv(
    file: UploadFile = File(...),
    session: DBSession = None,
):
    """
    Upload a CSV of target companies. Creates a SourcingBatch, parses rows
    into Company records (deduped), and queues background enrichment.
    """
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    rows = parse_csv(content)
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No valid rows found. CSV needs at least a company name or domain column.",
        )

    # Create batch record
    batch = SourcingBatch(
        filename=file.filename or "upload.csv",
        total_rows=len(rows),
        status="pending",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(batch)
    await session.commit()
    await session.refresh(batch)

    repo = CompanyRepository(session)
    created, skipped, failed = 0, 0, 0
    errors = []

    for row in rows:
        fields = row_to_company_fields(row)
        domain = fields["domain"]
        name = fields["name"]

        try:
            # Dedup by domain
            if not domain.endswith(".unknown"):
                if await repo.get_by_domain(domain):
                    skipped += 1
                    continue
            # Dedup by name
            if await repo.get_by_name(name):
                skipped += 1
                continue

            company = Company(**fields, sourcing_batch_id=batch.id)
            company.icp_score, company.icp_tier = score_company(company)
            session.add(company)
            await session.commit()
            await session.refresh(company)
            created += 1

        except Exception as e:
            await session.rollback()
            failed += 1
            errors.append({"name": name, "error": str(e)})

    # Update batch
    batch.created_companies = created
    batch.skipped_rows = skipped
    batch.failed_rows = failed
    batch.error_log = errors if errors else None
    batch.status = "processing"
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    await session.commit()

    # Queue batch enrichment task
    from app.tasks.enrichment import enrich_batch_task
    enrich_batch_task.delay(str(batch.id))

    await session.refresh(batch)
    return batch


# ── Batch Status ───────────────────────────────────────────────────────────────

@router.get("/batches/{batch_id}", response_model=SourcingBatchRead)
async def get_batch_status(batch_id: UUID, session: DBSession = None):
    """Poll batch enrichment progress."""
    batch = await session.get(SourcingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")
    return batch


@router.get("/batches/{batch_id}/companies", response_model=list[CompanyRead])
async def get_batch_companies(batch_id: UUID, session: DBSession = None, page: Pagination = None):
    """List companies belonging to a specific sourcing batch."""
    batch = await session.get(SourcingBatch, batch_id)
    if not batch:
        raise HTTPException(status_code=404, detail="Batch not found")

    result = await session.execute(
        select(Company)
        .where(Company.sourcing_batch_id == batch_id)
        .offset(page.skip)
        .limit(page.limit)
        .order_by(Company.created_at.desc())
    )
    return result.scalars().all()


# ── All Sourced Companies ──────────────────────────────────────────────────────

@router.get("/companies", response_model=list[CompanyRead])
async def list_sourced_companies(session: DBSession = None, page: Pagination = None):
    """List all companies that came through account sourcing (have a batch ID)."""
    result = await session.execute(
        select(Company)
        .where(Company.sourcing_batch_id.isnot(None))
        .offset(page.skip)
        .limit(page.limit)
        .order_by(Company.created_at.desc())
    )
    return result.scalars().all()


# ── Single Company Detail ─────────────────────────────────────────────────────

@router.get("/companies/{company_id}", response_model=CompanyRead)
async def get_sourced_company(company_id: UUID, session: DBSession = None):
    """Get a single sourced company with full enrichment data (including cache)."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


# ── Company Re-enrich ─────────────────────────────────────────────────────────

@router.post("/companies/{company_id}/re-enrich")
async def re_enrich_company(company_id: UUID, session: DBSession = None):
    """Re-run the standard tiered enrichment pipeline for a company."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    from app.tasks.enrichment import re_enrich_company_task
    task = re_enrich_company_task.delay(str(company_id))
    return {
        "company_id": str(company_id),
        "task_id": task.id,
        "status": "queued",
        "message": "Re-enrichment started",
    }


# ── Company Contacts ──────────────────────────────────────────────────────────

@router.get("/companies/{company_id}/contacts", response_model=list[ContactRead])
async def get_company_contacts(company_id: UUID, session: DBSession = None):
    """Get all contacts discovered for a company."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    result = await session.execute(
        select(Contact)
        .where(Contact.company_id == company_id)
        .order_by(Contact.created_at.desc())
    )
    return result.scalars().all()


# ── Contact Re-enrich ─────────────────────────────────────────────────────────

@router.post("/contacts/{contact_id}/re-enrich")
async def re_enrich_contact(contact_id: UUID, session: DBSession = None):
    """Re-enrich a single contact via Apollo + AI persona classification."""
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    from app.tasks.enrichment import re_enrich_contact_task
    task = re_enrich_contact_task.delay(str(contact_id))
    return {
        "contact_id": str(contact_id),
        "task_id": task.id,
        "status": "queued",
        "message": "Contact re-enrichment started",
    }


# ── Push to Instantly (placeholder) ───────────────────────────────────────────

@router.post("/companies/{company_id}/push-instantly")
async def push_to_instantly(
    company_id: UUID,
    campaign_id: str = "default",
    session: DBSession = None,
):
    """Push company contacts to an Instantly email campaign."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    # Get contacts with emails
    result = await session.execute(
        select(Contact)
        .where(Contact.company_id == company_id, Contact.email.isnot(None))
    )
    contacts = result.scalars().all()

    if not contacts:
        raise HTTPException(status_code=400, detail="No contacts with emails found for this company")

    from app.clients.instantly import InstantlyClient
    instantly = InstantlyClient()

    results = []
    for contact in contacts:
        r = await instantly.add_lead(
            campaign_id=campaign_id,
            email=contact.email,
            first_name=contact.first_name,
            last_name=contact.last_name,
            company_name=company.name,
        )
        results.append(r)

    return {
        "company_id": str(company_id),
        "company_name": company.name,
        "contacts_pushed": len(results),
        "campaign_id": campaign_id,
        "results": results,
    }


# ── Batches List ───────────────────────────────────────────────────────────────

@router.get("/batches", response_model=list[SourcingBatchRead])
async def list_batches(session: DBSession = None, page: Pagination = None):
    """List all sourcing batches."""
    result = await session.execute(
        select(SourcingBatch)
        .offset(page.skip)
        .limit(page.limit)
        .order_by(SourcingBatch.created_at.desc())
    )
    return result.scalars().all()
