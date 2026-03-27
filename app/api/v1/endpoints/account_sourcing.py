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
from sqlalchemy import func
from sqlmodel import select

from app.core.dependencies import DBSession, Pagination
from app.models.angel import AngelInvestor, AngelMapping
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
from app.services.data_reset import (
    reset_account_sourcing_data,
    reset_prospecting_data,
    reset_workspace_data,
)
from app.services.icp_scorer import score_company

router = APIRouter(prefix="/account-sourcing", tags=["account-sourcing"])


async def _auto_create_angel_records(
    session,
    company: Company,
    contact: Contact,
) -> int:
    """
    Read warm_paths and investor data from company.prospecting_profile,
    get-or-create AngelInvestor records, and create AngelMapping links.
    Also populates the company's investor text columns.
    Returns the number of mappings created.
    """
    # `prospecting_profile` stores the generated warm-intro/investor intelligence
    # as JSON. This helper turns the useful parts into relational records so the
    # rest of the app can query and edit them normally.
    profile = company.prospecting_profile if isinstance(company.prospecting_profile, dict) else {}
    warm_paths = profile.get("warm_paths") if isinstance(profile.get("warm_paths"), list) else []
    investors = profile.get("investors") if isinstance(profile.get("investors"), dict) else {}

    # ── Populate company investor text columns ──────────────────────────
    ownership = profile.get("ownership_stage")
    if ownership and not company.ownership_stage:
        company.ownership_stage = str(ownership)[:500]

    pe_list = investors.get("pe") if isinstance(investors.get("pe"), list) else []
    if pe_list and not company.pe_investors:
        company.pe_investors = "; ".join(str(item).strip() for item in pe_list if str(item).strip())

    vc_list = investors.get("vc_growth") if isinstance(investors.get("vc_growth"), list) else []
    if vc_list and not company.vc_investors:
        company.vc_investors = "; ".join(str(item).strip() for item in vc_list if str(item).strip())

    strategic_list = investors.get("strategic") if isinstance(investors.get("strategic"), list) else []
    if strategic_list and not company.strategic_investors:
        company.strategic_investors = "; ".join(str(item).strip() for item in strategic_list if str(item).strip())

    if any([pe_list, vc_list, strategic_list, ownership]):
        session.add(company)

    # ── Create angel investor + mapping records ─────────────────────────
    mappings_created = 0
    for rank, connector in enumerate(warm_paths, start=1):
        if not isinstance(connector, dict):
            continue
        angel_name = str(connector.get("name") or "").strip()
        if not angel_name:
            continue

        # Get or create angel investor (case-insensitive match)
        existing_angel = (
            await session.execute(
                select(AngelInvestor).where(
                    func.lower(AngelInvestor.name) == angel_name.lower()
                ).limit(1)
            )
        ).scalars().first()

        if existing_angel:
            angel = existing_angel
        else:
            angel = AngelInvestor(name=angel_name)
            session.add(angel)
            await session.flush()

        # Check for duplicate mapping (same contact + angel)
        existing_mapping = (
            await session.execute(
                select(AngelMapping).where(
                    AngelMapping.contact_id == contact.id,
                    AngelMapping.angel_investor_id == angel.id,
                ).limit(1)
            )
        ).scalars().first()

        if existing_mapping:
            continue

        strength_raw = connector.get("strength")
        strength = int(strength_raw) if strength_raw is not None else 3
        strength = max(1, min(5, strength))

        mapping = AngelMapping(
            contact_id=contact.id,
            company_id=company.id,
            angel_investor_id=angel.id,
            strength=strength,
            rank=min(rank, 10),
            connection_path=connector.get("connection_path"),
            why_it_works=connector.get("why_it_works"),
        )
        session.add(mapping)
        mappings_created += 1

    return mappings_created


@router.post("/reset/{scope}")
async def reset_sourcing_data(scope: str, session: DBSession = None):
    # These reset scopes intentionally target different slices of the GTM app so
    # admins can clear one workflow without wiping unrelated work.
    normalized = (scope or "").strip().lower()
    if normalized == "account-sourcing":
        summary = await reset_account_sourcing_data(session)
    elif normalized == "prospecting":
        summary = await reset_prospecting_data(session)
    elif normalized == "workspace":
        summary = await reset_workspace_data(session)
    else:
        raise HTTPException(status_code=400, detail="Unsupported reset scope")
    return {"scope": normalized, "summary": summary}


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
    # Prefer uploaded analyst values when they exist, but fall back to generated
    # research so exports stay usable for both manual and AI-enriched batches.
    import_block = company.enrichment_sources.get("import") if isinstance(company.enrichment_sources, dict) else {}
    raw_row = import_block.get("raw_row") if isinstance(import_block, dict) and isinstance(import_block.get("raw_row"), dict) else {}
    uploaded_analyst = import_block.get("uploaded_analyst") if isinstance(import_block, dict) and isinstance(import_block.get("uploaded_analyst"), dict) else {}
    analyst = uploaded_analyst or (import_block.get("analyst") if isinstance(import_block, dict) and isinstance(import_block.get("analyst"), dict) else {})
    generated_analyst = import_block.get("generated_analyst") if isinstance(import_block, dict) and isinstance(import_block.get("generated_analyst"), dict) else {}
    uploaded_signals = import_block.get("uploaded_signals") if isinstance(import_block, dict) and isinstance(import_block.get("uploaded_signals"), dict) else {}
    generated_signals = import_block.get("generated_signals") if isinstance(import_block, dict) and isinstance(import_block.get("generated_signals"), dict) else {}
    profile = company.prospecting_profile if isinstance(company.prospecting_profile, dict) else {}
    outreach_plan = company.outreach_plan if isinstance(company.outreach_plan, dict) else {}
    cache = company.enrichment_cache if isinstance(company.enrichment_cache, dict) else {}
    icp_entry = cache.get("icp_analysis") if isinstance(cache.get("icp_analysis"), dict) else {}
    icp = icp_entry.get("data") if isinstance(icp_entry, dict) and isinstance(icp_entry.get("data"), dict) else {}
    research_quality_entry = cache.get("research_quality") if isinstance(cache.get("research_quality"), dict) else {}
    research_quality = research_quality_entry.get("data") if isinstance(research_quality_entry, dict) and isinstance(research_quality_entry.get("data"), dict) else {}
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
        "researched_company_overview": str(icp.get("company_overview") or generated_analyst.get("company_overview") or company.description or ""),
        "researched_industry": str(icp.get("industry") or generated_analyst.get("industry") or company.industry or ""),
        "researched_category": str(icp.get("category") or generated_analyst.get("category") or company.vertical or ""),
        "researched_core_focus": str(icp.get("core_focus") or generated_analyst.get("core_focus") or ""),
        "researched_fit_type": str(icp.get("fit_type") or generated_analyst.get("fit_type") or ""),
        "researched_classification": str(icp.get("classification") or generated_analyst.get("classification") or ""),
        "researched_confidence": str(icp.get("confidence") or generated_analyst.get("confidence") or ""),
        "researched_financial_capacity_met": str(icp.get("financial_capacity_met") or generated_analyst.get("financial_capacity_met") or ""),
        "researched_revenue_funding": str(icp.get("revenue_funding") or generated_analyst.get("revenue_funding") or ""),
        "researched_icp_score_0_10": str(icp.get("icp_fit_score") or generated_analyst.get("icp_fit_score") or ""),
        "researched_icp_why": str(icp.get("icp_why") or generated_analyst.get("icp_why") or ""),
        "researched_intent_score_0_10": str(icp.get("intent_score") or generated_analyst.get("intent_score") or ""),
        "researched_intent_why": str(icp.get("intent_why") or generated_analyst.get("intent_why") or ""),
        "researched_ps_impl_hiring": str(icp.get("ps_impl_hiring") or ""),
        "researched_leadership_org_moves": str(icp.get("leadership_org_moves") or ""),
        "researched_pr_funding_expansion": str(icp.get("pr_funding_expansion") or ""),
        "researched_events_thought_leadership": str(icp.get("events_thought_leadership") or ""),
        "researched_reviews_case_studies": str(icp.get("reviews_case_studies") or ""),
        "researched_internal_ai_overlap": str(icp.get("internal_ai_overlap") or ""),
        "researched_strategic_constraints": str(icp.get("strategic_constraints") or ""),
        "researched_ps_cs_contraction": str(icp.get("ps_cs_contraction") or ""),
        "researched_build_vs_buy": str(icp.get("build_vs_buy") or ""),
        "researched_ai_acquisition": str(icp.get("ai_acquisition") or ""),
        "researched_employee_count": str(icp.get("employee_count") or generated_analyst.get("employee_count") or company.employee_count or ""),
        "researched_funding_stage": str(icp.get("funding_stage") or generated_analyst.get("funding_stage") or company.funding_stage or ""),
        "researched_arr_estimate": str(icp.get("arr_estimate") or generated_analyst.get("arr_estimate") or company.arr_estimate or ""),
        "researched_committee_coverage": str(icp.get("committee_coverage") or generated_analyst.get("committee_coverage") or profile.get("committee_coverage") or ""),
        "researched_open_gaps": " | ".join(str(item).strip() for item in (icp.get("open_gaps") or generated_analyst.get("open_gaps") or profile.get("open_gaps") or []) if str(item).strip()) if isinstance((icp.get("open_gaps") or generated_analyst.get("open_gaps") or profile.get("open_gaps")), list) else str(icp.get("open_gaps") or generated_analyst.get("open_gaps") or profile.get("open_gaps") or ""),
        "researched_icp_personas": " | ".join(
            " - ".join(part for part in [str(item.get("title") or "").strip(), str(item.get("name") or "").strip(), str(item.get("relevance") or "").strip()] if part)
            for item in (icp.get("icp_personas") or profile.get("icp_personas") or [])
            if isinstance(item, dict)
        ),
        "researched_account_thesis": str(icp.get("account_thesis") or generated_analyst.get("account_thesis") or company.account_thesis or ""),
        "researched_why_now": str(icp.get("why_now") or generated_analyst.get("why_now") or company.why_now or ""),
        "researched_beacon_angle": str(icp.get("beacon_angle") or generated_analyst.get("beacon_angle") or company.beacon_angle or ""),
        "researched_recommended_outreach_strategy": str(icp.get("recommended_outreach_strategy") or generated_analyst.get("recommended_outreach_strategy") or profile.get("recommended_outreach_strategy") or ""),
        "researched_conversation_starter": str(icp.get("conversation_starter") or generated_analyst.get("conversation_starter") or profile.get("conversation_starter") or ""),
        "researched_next_steps": str(icp.get("next_steps") or generated_analyst.get("next_steps") or profile.get("next_steps") or ""),
        "researched_generated_positive_signals": _joined_signal_values(generated_signals.get("positive") if isinstance(generated_signals, dict) else []),
        "researched_generated_negative_signals": _joined_signal_values(generated_signals.get("negative") if isinstance(generated_signals, dict) else []),
        "researched_evidence_level": str(research_quality.get("evidence_level") or ""),
        "researched_evidence_score": str(research_quality.get("evidence_score") or ""),
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

# Headers that indicate the CSV already has rich ICP/analyst data.
# If a CSV has NONE of these (just company name + maybe domain), we trigger
# the full ICP intelligence pipeline to research each company from scratch.
_RICH_DATA_HEADERS = {
    "industry", "sector", "employee_count", "employees", "headcount",
    "funding_stage", "stage", "round", "series", "total funding",
    "annual revenue", "arr", "revenue", "icp fit score", "intent score",
    "classification", "fit type", "confidence", "core focus",
    "icp why", "intent why", "ps impl hiring", "reviews case studies",
    "category", "description", "overview", "what they do",
}


def _is_minimal_upload(rows: list[dict]) -> bool:
    """
    Detect if the uploaded CSV is 'minimal' — just company names (and maybe
    domain/industry) without detailed ICP/analyst columns.

    When minimal, we trigger the full ICP intelligence pipeline that researches
    each company using web search, Apollo, and Claude.
    """
    if not rows:
        return False

    # Normalize all headers in the first row
    from app.services.account_sourcing import _normalize_header
    headers = {_normalize_header(h) for h in rows[0].keys()}

    # Count how many "rich data" headers are present with actual values
    rich_count = 0
    for row in rows[:3]:  # Sample first few rows
        for header, value in row.items():
            normalized = _normalize_header(header)
            if normalized in _RICH_DATA_HEADERS and value and str(value).strip():
                rich_count += 1
                break  # One rich value per row is enough

    # If fewer than half the sampled rows have rich data, it's minimal
    sample_size = min(len(rows), 3)
    return rich_count < (sample_size / 2)


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

    # The request path only normalizes and persists uploaded data. Expensive
    # research is queued afterward so the browser is not held open for minutes.
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
    created, attached_existing, skipped, failed = 0, 0, 0, 0
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
                already_in_batch = company.sourcing_batch_id == batch.id
                company = merge_company_from_upload(company, fields)
                company.sourcing_batch_id = batch.id
                company.updated_at = datetime.utcnow()
                company = refresh_company_prospecting_fields(company)
                company.icp_score, company.icp_tier = score_company(company)
                session.add(company)
                await session.commit()
                await session.refresh(company)
                if already_in_batch:
                    skipped += 1
                else:
                    attached_existing += 1
            else:
                company = Company(**fields, sourcing_batch_id=batch.id)
                company = refresh_company_prospecting_fields(company)
                company.icp_score, company.icp_tier = score_company(company)
                session.add(company)
                await session.commit()
                await session.refresh(company)
                created += 1

            # Preserve investor metadata on the company even when the spreadsheet
            # did not include a corresponding contact row.
            profile = company.prospecting_profile if isinstance(company.prospecting_profile, dict) else {}
            inv = profile.get("investors") if isinstance(profile.get("investors"), dict) else {}
            ownership = profile.get("ownership_stage")
            if ownership and not company.ownership_stage:
                company.ownership_stage = str(ownership)[:500]
            pe = inv.get("pe") if isinstance(inv.get("pe"), list) else []
            if pe and not company.pe_investors:
                company.pe_investors = "; ".join(str(i).strip() for i in pe if str(i).strip())
            vc = inv.get("vc_growth") if isinstance(inv.get("vc_growth"), list) else []
            if vc and not company.vc_investors:
                company.vc_investors = "; ".join(str(i).strip() for i in vc if str(i).strip())
            strat = inv.get("strategic") if isinstance(inv.get("strategic"), list) else []
            if strat and not company.strategic_investors:
                company.strategic_investors = "; ".join(str(i).strip() for i in strat if str(i).strip())
            if any([pe, vc, strat, ownership]):
                session.add(company)
                await session.commit()

            contact_fields = row_to_contact_fields(row, fields)
            if contact_fields:
                # Contact rows are optional. When present, we merge them now so the
                # background enrichment can build on the imported humans instead of
                # discovering everything from scratch.
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
                    resolved_contact = existing_contact
                else:
                    contact = Contact(**contact_fields, company_id=company.id)
                    refresh_contact_sequence_plan(contact, company)
                    session.add(contact)
                    resolved_contact = contact
                await session.commit()
                await session.refresh(resolved_contact)

                # Auto-create angel investor + mapping records from warm_paths
                try:
                    await _auto_create_angel_records(session, company, resolved_contact)
                    await session.commit()
                except Exception:
                    await session.rollback()

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
    batch.created_companies = created + attached_existing
    batch.skipped_rows = skipped
    batch.failed_rows = failed
    batch.error_log = errors if errors else None
    batch.status = "processing"
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    await session.commit()
    batch_id = batch.id

    try:
        from app.tasks.enrichment import icp_research_batch_task
        # Queue only after the batch and companies are committed so the worker sees
        # durable records and a valid batch id.
        icp_research_batch_task.delay(str(batch_id))
    except Exception as exc:
        batch.status = "failed"
        batch.error_log = [*(batch.error_log or []), {"batch": str(batch_id), "error": str(exc)}]
        batch.updated_at = datetime.utcnow()
        session.add(batch)
        await session.commit()
        raise HTTPException(status_code=500, detail="Failed to queue batch enrichment") from exc

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
        # First-touch timestamps are inferred from the first non-default status so
        # the UI can sort/filter on outreach recency without extra client logic.
        company.last_outreach_at = datetime.utcnow()

    if update_data.get("assigned_rep_email") and not update_data.get("assigned_rep"):
        company.assigned_rep = update_data["assigned_rep_email"]
    if update_data.get("assigned_rep_name") and not update_data.get("assigned_rep"):
        company.assigned_rep = update_data["assigned_rep_name"]

    contacts = (
        await session.execute(select(Contact).where(Contact.company_id == company.id))
    ).scalars().all()
    for contact in contacts:
        # Keep contact-level sequencing aligned with the latest company owner and
        # outreach lane whenever the account record changes.
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
    """Re-run the deep TAL / ICP research pipeline for a company."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    try:
        from app.tasks.enrichment import icp_research_single_task

        task = icp_research_single_task.delay(str(company_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to queue company re-enrichment") from exc
    return {
        "company_id": str(company_id),
        "task_id": task.id,
        "status": "queued",
        "message": "Deep research re-enrichment started",
    }


@router.post("/companies/{company_id}/icp-research")
async def icp_research_company(company_id: UUID, session: DBSession = None):
    """Run the full ICP intelligence pipeline for a single company.

    Uses web search, Apollo, website scraping, and Claude AI to produce
    comprehensive ICP analysis with TAL filtering and intent scoring.
    """
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")
    try:
        from app.tasks.enrichment import icp_research_single_task

        task = icp_research_single_task.delay(str(company_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to queue ICP research") from exc
    return {
        "company_id": str(company_id),
        "task_id": task.id,
        "status": "queued",
        "message": "ICP intelligence research started — this takes 15-30 seconds per company",
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
    try:
        from app.tasks.enrichment import re_enrich_contact_task

        task = re_enrich_contact_task.delay(str(contact_id))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Failed to queue contact re-enrichment") from exc
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
