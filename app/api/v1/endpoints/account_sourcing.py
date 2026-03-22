"""
Account Sourcing — CSV upload, tiered enrichment, re-enrich.

Endpoints:
  POST /upload              Upload CSV → create batch + companies → queue enrichment
  GET  /batches/{id}        Poll batch status
  GET  /batches/{id}/companies  Companies in a batch with enrichment data
  GET  /companies           All sourced companies (across batches)
  PUT  /companies/{id}      Update sourcing owner / feedback fields
  GET  /export              Export sourced companies to CSV
  POST /companies/{id}/re-enrich     Re-run standard pipeline
  GET  /companies/{id}/contacts      Contacts discovered for a company
  POST /contacts/{id}/re-enrich      Re-enrich a single contact
  POST /companies/{id}/push-instantly  Push contacts to Instantly (placeholder)
"""
import csv
import io
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlmodel import select

from app.core.dependencies import DBSession, Pagination
from app.models.company import Company, CompanyRead, CompanyUpdate
from app.models.contact import Contact, ContactRead, ContactUpdate
from app.models.sourcing_batch import SourcingBatch, SourcingBatchRead
from app.repositories.company import CompanyRepository
from app.services.account_sourcing import (
    account_priority_snapshot,
    merge_company_from_upload,
    parse_tabular_file,
    refresh_contact_sequence_plan,
    refresh_company_prospecting_fields,
    row_to_company_fields,
    row_to_contact_fields,
)
from app.services.icp_scorer import score_company

router = APIRouter(prefix="/account-sourcing", tags=["account-sourcing"])


def _joined_signal_values(items: object) -> str:
    if not isinstance(items, list):
        return ""
    values: list[str] = []
    for item in items:
        if isinstance(item, dict):
            value = str(item.get("value") or item.get("key") or "").strip()
        else:
            value = str(item).strip()
        if value:
            values.append(value)
    return " | ".join(values)


def _company_export_row(company: Company) -> dict[str, str]:
    import_block = company.enrichment_sources.get("import") if isinstance(company.enrichment_sources, dict) else {}
    raw_row = import_block.get("raw_row") if isinstance(import_block, dict) and isinstance(import_block.get("raw_row"), dict) else {}
    analyst = import_block.get("analyst") if isinstance(import_block, dict) and isinstance(import_block.get("analyst"), dict) else {}
    uploaded_signals = import_block.get("uploaded_signals") if isinstance(import_block, dict) and isinstance(import_block.get("uploaded_signals"), dict) else {}
    profile = company.prospecting_profile if isinstance(company.prospecting_profile, dict) else {}
    outreach_plan = company.outreach_plan if isinstance(company.outreach_plan, dict) else {}
    priority = account_priority_snapshot(company)

    row = {
        "company_id": str(company.id),
        "name": company.name,
        "domain": company.domain,
        "industry": company.industry or "",
        "employee_count": str(company.employee_count or ""),
        "funding_stage": company.funding_stage or "",
        "arr_estimate": str(company.arr_estimate or ""),
        "icp_score": str(company.icp_score or ""),
        "icp_tier": company.icp_tier or "",
        "assigned_rep": company.assigned_rep or "",
        "assigned_rep_email": company.assigned_rep_email or "",
        "assigned_rep_name": company.assigned_rep_name or "",
        "outreach_status": company.outreach_status or "",
        "disposition": company.disposition or "",
        "rep_feedback": company.rep_feedback or "",
        "recommended_outreach_lane": company.recommended_outreach_lane or "",
        "instantly_campaign_id": company.instantly_campaign_id or "",
        "account_thesis": company.account_thesis or "",
        "why_now": company.why_now or "",
        "beacon_angle": company.beacon_angle or "",
        "prospecting_recommended_strategy": str(profile.get("recommended_outreach_strategy") or ""),
        "prospecting_conversation_starter": str(profile.get("conversation_starter") or ""),
        "prospecting_warm_path_count": str(len(profile.get("warm_paths") or []) if isinstance(profile.get("warm_paths"), list) else 0),
        "outreach_owner_email": str(outreach_plan.get("owner_email") or ""),
        "outreach_sequence_family": str(outreach_plan.get("sequence_family") or ""),
        "outreach_next_best_action": str(outreach_plan.get("next_best_action") or ""),
        "last_outreach_at": company.last_outreach_at.isoformat() if company.last_outreach_at else "",
        "priority_score": str(priority["priority_score"]),
        "priority_band": str(priority["priority_band"]),
        "interest_level": str(priority["interest_level"]),
        "description": company.description or "",
        "uploaded_classification": str(analyst.get("classification") or ""),
        "uploaded_fit_type": str(analyst.get("fit_type") or ""),
        "uploaded_confidence": str(analyst.get("confidence") or ""),
        "uploaded_icp_score_0_10": str(analyst.get("icp_fit_score") or ""),
        "uploaded_intent_score_0_10": str(analyst.get("intent_score") or ""),
        "uploaded_icp_why": str(analyst.get("icp_why") or ""),
        "uploaded_intent_why": str(analyst.get("intent_why") or ""),
        "uploaded_positive_signals": _joined_signal_values(uploaded_signals.get("positive") if isinstance(uploaded_signals, dict) else []),
        "uploaded_negative_signals": _joined_signal_values(uploaded_signals.get("negative") if isinstance(uploaded_signals, dict) else []),
        "enriched_at": company.enriched_at.isoformat() if company.enriched_at else "",
        "created_at": company.created_at.isoformat(),
        "updated_at": company.updated_at.isoformat(),
    }

    if isinstance(raw_row, dict):
        for key, value in raw_row.items():
            row[f"source_{key}"] = str(value or "")

    return row


def _contact_export_row(company: Company, contact: Contact) -> dict[str, str]:
    profile = company.prospecting_profile if isinstance(company.prospecting_profile, dict) else {}
    warm_path = contact.warm_intro_path if isinstance(contact.warm_intro_path, dict) else {}
    talking_points = contact.talking_points if isinstance(contact.talking_points, list) else []
    enrichment = contact.enrichment_data if isinstance(contact.enrichment_data, dict) else {}
    sequence_plan = enrichment.get("sequence_plan") if isinstance(enrichment.get("sequence_plan"), dict) else {}
    sequence_steps = sequence_plan.get("steps") if isinstance(sequence_plan.get("steps"), list) else []
    return {
        "company_id": str(company.id),
        "company_name": company.name,
        "company_domain": company.domain,
        "company_owner_email": company.assigned_rep_email or "",
        "company_owner_name": company.assigned_rep_name or company.assigned_rep or "",
        "company_outreach_lane": company.recommended_outreach_lane or "",
        "contact_id": str(contact.id),
        "first_name": contact.first_name,
        "last_name": contact.last_name,
        "full_name": f"{contact.first_name} {contact.last_name}".strip(),
        "title": contact.title or "",
        "email": contact.email or "",
        "email_verified": "yes" if contact.email_verified else "no",
        "linkedin_url": contact.linkedin_url or "",
        "persona": contact.persona or "",
        "persona_type": contact.persona_type or "",
        "assigned_rep_email": contact.assigned_rep_email or company.assigned_rep_email or "",
        "outreach_lane": contact.outreach_lane or company.recommended_outreach_lane or "",
        "sequence_status": contact.sequence_status or "",
        "instantly_status": contact.instantly_status or "",
        "instantly_campaign_id": contact.instantly_campaign_id or company.instantly_campaign_id or "",
        "warm_intro_strength": str(contact.warm_intro_strength or ""),
        "warm_intro_name": str(warm_path.get("name") or ""),
        "warm_intro_path": str(warm_path.get("connection_path") or ""),
        "warm_intro_why": str(warm_path.get("why_it_works") or ""),
        "conversation_starter": contact.conversation_starter or str(profile.get("conversation_starter") or ""),
        "personalization_notes": contact.personalization_notes or "",
        "talking_points": " | ".join(str(item).strip() for item in talking_points if str(item).strip()),
        "account_thesis": company.account_thesis or "",
        "why_now": company.why_now or "",
        "beacon_angle": company.beacon_angle or "",
        "sequence_family": str(sequence_plan.get("sequence_family") or ""),
        "sequence_goal": str(sequence_plan.get("goal") or ""),
        "sequence_hooks": " | ".join(str(item).strip() for item in sequence_plan.get("personalization_hooks", []) if str(item).strip()) if isinstance(sequence_plan.get("personalization_hooks"), list) else "",
        "sequence_step_1": str(sequence_steps[0].get("objective") or "") if len(sequence_steps) > 0 and isinstance(sequence_steps[0], dict) else "",
        "sequence_step_2": str(sequence_steps[1].get("objective") or "") if len(sequence_steps) > 1 and isinstance(sequence_steps[1], dict) else "",
        "sequence_step_3": str(sequence_steps[2].get("objective") or "") if len(sequence_steps) > 2 and isinstance(sequence_steps[2], dict) else "",
        "sequence_step_4": str(sequence_steps[3].get("objective") or "") if len(sequence_steps) > 3 and isinstance(sequence_steps[3], dict) else "",
        "sequence_step_5": str(sequence_steps[4].get("objective") or "") if len(sequence_steps) > 4 and isinstance(sequence_steps[4], dict) else "",
    }


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
    lower_name = (file.filename or "").lower()
    if not (lower_name.endswith(".csv") or lower_name.endswith(".xlsx")):
        raise HTTPException(status_code=400, detail="File must be a .csv or .xlsx")

    content = await file.read()
    rows = parse_tabular_file(file.filename or "upload.csv", content)
    if not rows:
        raise HTTPException(
            status_code=400,
            detail="No valid rows found. The file needs at least a company name or domain column.",
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
            company = None
            if not domain.endswith(".unknown"):
                company = await repo.get_by_domain(domain)
            if not company:
                company = await repo.get_by_name(name)

            if company:
                company = merge_company_from_upload(company, fields)
                company = refresh_company_prospecting_fields(company)
                company.icp_score, company.icp_tier = score_company(company)
                session.add(company)
                await session.commit()
                await session.refresh(company)
                skipped += 1
            else:
                company = Company(**fields, sourcing_batch_id=batch.id)
                company = refresh_company_prospecting_fields(company)
                company.icp_score, company.icp_tier = score_company(company)
                session.add(company)
                await session.commit()
                await session.refresh(company)
                created += 1

            contact_fields = row_to_contact_fields(row, fields)
            if contact_fields:
                existing_contact = None
                if contact_fields.get("email"):
                    existing_contact = (
                        await session.execute(
                            select(Contact).where(Contact.email == contact_fields["email"]).limit(1)
                        )
                    ).scalars().first()
                if not existing_contact:
                    existing_contact = (
                        await session.execute(
                            select(Contact).where(
                                Contact.company_id == company.id,
                                Contact.first_name == contact_fields.get("first_name"),
                                Contact.last_name == contact_fields.get("last_name"),
                            ).limit(1)
                        )
                    ).scalars().first()

                if existing_contact:
                    for key, value in contact_fields.items():
                        if value and not getattr(existing_contact, key, None):
                            setattr(existing_contact, key, value)
                    refresh_contact_sequence_plan(existing_contact, company)
                    session.add(existing_contact)
                else:
                    contact = Contact(**contact_fields, company_id=company.id)
                    refresh_contact_sequence_plan(contact, company)
                    session.add(contact)
                await session.commit()

                company_contacts = (
                    await session.execute(select(Contact).where(Contact.company_id == company.id))
                ).scalars().all()
                refresh_company_prospecting_fields(company, company_contacts)
                company.icp_score, company.icp_tier = score_company(company)
                session.add(company)
                await session.commit()

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
async def list_sourced_companies(
    session: DBSession = None,
    page: Pagination = None,
    assigned_rep_email: str | None = Query(default=None),
):
    """List all companies that came through account sourcing (have a batch ID)."""
    stmt = (
        select(Company)
        .where(Company.sourcing_batch_id.isnot(None))
        .offset(page.skip)
        .limit(page.limit)
        .order_by(Company.created_at.desc())
    )
    if assigned_rep_email:
        stmt = stmt.where(Company.assigned_rep_email == assigned_rep_email)
    result = await session.execute(stmt)
    return result.scalars().all()


# ── Single Company Detail ─────────────────────────────────────────────────────

@router.get("/companies/{company_id}", response_model=CompanyRead)
async def get_sourced_company(company_id: UUID, session: DBSession = None):
    """Get a single sourced company with full enrichment data (including cache)."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    return company


@router.put("/companies/{company_id}", response_model=CompanyRead)
async def update_sourced_company(company_id: UUID, payload: CompanyUpdate, session: DBSession = None):
    """Update sourced company workflow fields like owner, disposition, and rep feedback."""
    repo = CompanyRepository(session)
    company = await repo.get_or_raise(company_id)

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(company, key, value)

    if (
        "outreach_status" in update_data
        and update_data.get("outreach_status")
        and update_data.get("outreach_status") != "not_started"
        and "last_outreach_at" not in update_data
        and not company.last_outreach_at
    ):
        company.last_outreach_at = datetime.utcnow()

    if update_data.get("assigned_rep_email") and not update_data.get("assigned_rep"):
        company.assigned_rep = update_data["assigned_rep_email"]
    if update_data.get("assigned_rep_name") and not update_data.get("assigned_rep"):
        company.assigned_rep = update_data["assigned_rep_name"]

    contacts = (
        await session.execute(select(Contact).where(Contact.company_id == company.id))
    ).scalars().all()
    for contact in contacts:
        if company.assigned_rep_email:
            contact.assigned_rep_email = company.assigned_rep_email
        if company.recommended_outreach_lane and not contact.outreach_lane:
            contact.outreach_lane = company.recommended_outreach_lane
        refresh_contact_sequence_plan(contact, company)
        session.add(contact)

    refresh_company_prospecting_fields(company, contacts)
    company.updated_at = datetime.utcnow()
    company.icp_score, company.icp_tier = score_company(company)
    return await repo.save(company)


@router.get("/export")
async def export_sourced_companies(
    session: DBSession = None,
    assigned_rep: str | None = Query(default=None),
    assigned_rep_email: str | None = Query(default=None),
    disposition: str | None = Query(default=None),
):
    """Export sourced companies and preserved source columns as CSV."""
    stmt = select(Company).where(Company.sourcing_batch_id.isnot(None)).order_by(Company.created_at.desc())
    if assigned_rep:
        stmt = stmt.where(Company.assigned_rep == assigned_rep)
    if assigned_rep_email:
        stmt = stmt.where(Company.assigned_rep_email == assigned_rep_email)
    if disposition:
        stmt = stmt.where(Company.disposition == disposition)

    companies = (await session.execute(stmt)).scalars().all()
    rows = [_company_export_row(company) for company in companies]

    headers: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in headers:
                headers.append(key)

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers or ["company_id"])
    writer.writeheader()
    if rows:
        writer.writerows(rows)

    content = buffer.getvalue()
    filename = f"sourced_companies_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export-contacts")
async def export_sourced_contacts(
    session: DBSession = None,
    assigned_rep_email: str | None = Query(default=None),
):
    stmt = (
        select(Contact, Company)
        .join(Company, Contact.company_id == Company.id)
        .where(Company.sourcing_batch_id.isnot(None))
        .order_by(Company.created_at.desc(), Contact.created_at.desc())
    )
    if assigned_rep_email:
        stmt = stmt.where(
            (Contact.assigned_rep_email == assigned_rep_email) | (Company.assigned_rep_email == assigned_rep_email)
        )

    rows = []
    for contact, company in (await session.execute(stmt)).all():
        rows.append(_contact_export_row(company, contact))

    headers: list[str] = []
    for row in rows:
        for key in row.keys():
            if key not in headers:
                headers.append(key)

    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=headers or ["contact_id"])
    writer.writeheader()
    if rows:
        writer.writerows(rows)

    content = buffer.getvalue()
    filename = f"sourced_contacts_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@router.get("/contacts/{contact_id}", response_model=ContactRead)
async def get_company_contact(contact_id: UUID, session: DBSession = None):
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    if contact.company_id:
        company = await session.get(Company, contact.company_id)
        if company:
            contact.company_name = company.name
    return contact


@router.put("/contacts/{contact_id}", response_model=ContactRead)
async def update_company_contact(contact_id: UUID, payload: ContactUpdate, session: DBSession = None):
    contact = await session.get(Contact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")

    update_data = payload.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(contact, key, value)

    if contact.company_id:
        company = await session.get(Company, contact.company_id)
        if company:
            refresh_contact_sequence_plan(contact, company)

    contact.updated_at = datetime.utcnow()
    session.add(contact)
    await session.commit()
    await session.refresh(contact)

    if contact.company_id:
        company = await session.get(Company, contact.company_id)
        if company:
            company_contacts = (
                await session.execute(select(Contact).where(Contact.company_id == company.id))
            ).scalars().all()
            refresh_company_prospecting_fields(company, company_contacts)
            company.updated_at = datetime.utcnow()
            session.add(company)
            await session.commit()
    return contact


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
        contact.instantly_status = "pushed"
        contact.sequence_status = "queued_instantly"
        contact.instantly_campaign_id = campaign_id
        session.add(contact)
        results.append(r)

    company.instantly_campaign_id = campaign_id
    session.add(company)
    await session.commit()

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
