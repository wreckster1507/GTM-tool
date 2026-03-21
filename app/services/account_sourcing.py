"""
Account sourcing service — tiered enrichment orchestrator.

Pipeline per company:
  Tier 1 (free):  Website scraping + DuckDuckGo intent signals
  Tier 2 (paid):  Apollo org/enrich + people/search
  Tier 3 (paid):  Hunter.io domain search + email verification (fills Apollo gaps)
  AI tier:        Claude summarization + ICP scoring + persona classification

Credit conservation:
  - Always runs Tier 1 first (free)
  - Apollo single-record calls only (no bulk)
  - Hunter.io only for NEW contacts not already found by Apollo
  - Caches all API responses in company.enrichment_cache JSONB
  - Re-enrich always runs (user controls via timestamp visibility)
"""
from __future__ import annotations

import csv
import copy
import io
import logging
import re
from datetime import datetime
from typing import Any, Optional
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import update as sa_update
from sqlalchemy.exc import MissingGreenlet
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.company import Company
from app.models.contact import Contact
from app.models.sourcing_batch import SourcingBatch
from app.services.icp_scorer import score_company

logger = logging.getLogger(__name__)


# ── CSV Parsing (reuses alias logic from prospecting) ─────────────────────────

_ALIASES: dict[str, list[str]] = {
    "name":           ["name", "company name", "company", "organization"],
    "domain":         ["domain", "domain name", "website", "url", "web"],
    "industry":       ["industry", "sector", "sector (pratice area & feed)",
                       "sector (practice area & feed)", "vertical", "category"],
    "employee_count": ["employee_count", "total employee count", "employees",
                       "headcount", "employee count", "no. of employees"],
    "funding_stage":  ["funding_stage", "company stage", "stage",
                       "funding stage", "round", "series"],
    "country":        ["country"],
    "city":           ["city", "location"],
    "description":    ["description", "overview", "about", "summary"],
    "total_funding":  ["total funding (usd)", "total funding",
                       "annual revenue (usd)", "annual revenue", "arr", "revenue"],
}


def _find(row: dict, field: str) -> str:
    for alias in _ALIASES.get(field, [field]):
        val = row.get(alias, "").strip()
        if val:
            return val
    return ""


def _clean_domain(raw: str) -> str:
    raw = raw.strip().lower()
    if not raw:
        return ""
    if raw.startswith("http"):
        parsed = urlparse(raw)
        raw = parsed.netloc.lstrip("www.")
    raw = raw.lstrip("www.")
    return raw.split("/")[0]


def _slugify(name: str) -> str:
    s = name.lower()
    s = re.sub(r"[^a-z0-9\s]", "", s)
    s = re.sub(r"\s+", "", s.strip())
    return s or "unknown"


def _parse_employee_count(val: str) -> Optional[int]:
    if not val:
        return None
    base = val.split("(")[0]
    digits = re.sub(r"[^\d]", "", base)
    try:
        return int(digits) if digits else None
    except ValueError:
        return None


def _parse_number(val: str) -> Optional[float]:
    if not val:
        return None
    cleaned = re.sub(r"[,$\s]", "", val)
    try:
        return float(cleaned)
    except ValueError:
        return None


_COMMITTEE_ROLE_LABELS = {
    "economic_buyer": "Economic Buyer",
    "champion": "Champion",
    "technical_evaluator": "Technical Evaluator",
    "implementation_owner": "Implementation Owner",
}

_IMPLEMENTATION_OWNER_KEYWORDS = [
    "ops", "operations", "admin", "administrator", "systems", "enablement",
    "implementation", "program", "project", "revops", "hris", "people ops",
    "people operations", "it manager", "it director", "business systems",
]


def _canonical_persona(
    persona: Optional[str] = None,
    persona_type: Optional[str] = None,
) -> str:
    mapping = {
        "buyer": "economic_buyer",
        "economic_buyer": "economic_buyer",
        "champion": "champion",
        "evaluator": "technical_evaluator",
        "technical_evaluator": "technical_evaluator",
        "blocker": "unknown",
        "unknown": "unknown",
    }
    for candidate in (persona, persona_type):
        normalized = mapping.get((candidate or "").strip().lower())
        if normalized:
            return normalized
    return "unknown"


def _infer_committee_role(
    title: Optional[str],
    persona: Optional[str] = None,
    persona_type: Optional[str] = None,
) -> str:
    title_lower = (title or "").strip().lower()
    if any(keyword in title_lower for keyword in _IMPLEMENTATION_OWNER_KEYWORDS):
        return "implementation_owner"

    canonical_persona = _canonical_persona(persona, persona_type)
    if canonical_persona in _COMMITTEE_ROLE_LABELS:
        return canonical_persona

    return "unknown"


def _contact_priority_score(contact: Contact) -> int:
    score = 0
    role = _infer_committee_role(contact.title, contact.persona, contact.persona_type)
    if role == "economic_buyer":
        score += 40
    elif role == "champion":
        score += 34
    elif role == "technical_evaluator":
        score += 30
    elif role == "implementation_owner":
        score += 26

    seniority = (contact.seniority or "").lower()
    if seniority in {"c_suite", "csuite", "c-suite", "founder", "owner"}:
        score += 16
    elif seniority == "vp":
        score += 12
    elif seniority in {"director", "head"}:
        score += 9
    elif seniority == "manager":
        score += 5

    if contact.email:
        score += 5
    if contact.linkedin_url:
        score += 3

    return score


async def _build_committee_coverage(company: Company, session: AsyncSession) -> dict[str, Any]:
    result = await session.execute(
        select(Contact)
        .where(Contact.company_id == company.id)
        .order_by(Contact.created_at.desc())
    )
    contacts = result.scalars().all()

    covered_roles: set[str] = set()
    persona_counts = {
        "economic_buyer": 0,
        "champion": 0,
        "technical_evaluator": 0,
        "implementation_owner": 0,
        "unknown": 0,
    }
    best_by_role: dict[str, dict[str, Any]] = {}

    for contact in contacts:
        persona = _canonical_persona(contact.persona, contact.persona_type)
        role = _infer_committee_role(contact.title, contact.persona, contact.persona_type)
        persona_counts[role if role in persona_counts else "unknown"] += 1

        if role in _COMMITTEE_ROLE_LABELS:
            covered_roles.add(role)
            candidate = {
                "contact_id": str(contact.id),
                "name": f"{contact.first_name} {contact.last_name}".strip(),
                "title": contact.title,
                "persona": persona,
                "role": role,
                "email": contact.email,
                "score": _contact_priority_score(contact),
            }
            current = best_by_role.get(role)
            if not current or candidate["score"] > current["score"]:
                best_by_role[role] = candidate
        elif persona == "unknown":
            persona_counts["unknown"] += 0

    missing_roles = [
        role for role in _COMMITTEE_ROLE_LABELS
        if role not in covered_roles
    ]

    coverage_score = round((len(covered_roles) / max(len(_COMMITTEE_ROLE_LABELS), 1)) * 100)
    recommended_next_roles = []
    for role in missing_roles:
        if role == "economic_buyer":
            why = "Find the budget owner so outreach can anchor on ROI and deployment risk."
        elif role == "champion":
            why = "Find the day-to-day operator who feels the rollout pain and can push internally."
        elif role == "technical_evaluator":
            why = "Find the technical reviewer who will validate integration, security, and feasibility."
        else:
            why = "Find the implementation owner who will own change management and rollout execution."
        recommended_next_roles.append({
            "role": role,
            "label": _COMMITTEE_ROLE_LABELS[role],
            "why": why,
        })

    best_contacts = [
        {
            "contact_id": value["contact_id"],
            "name": value["name"],
            "title": value["title"],
            "persona": value["persona"],
            "role": value["role"],
            "label": _COMMITTEE_ROLE_LABELS.get(value["role"], value["role"]),
            "email": value["email"],
        }
        for _, value in sorted(best_by_role.items(), key=lambda item: item[1]["score"], reverse=True)
    ]

    return {
        "total_contacts": len(contacts),
        "coverage_score": coverage_score,
        "covered_roles": [
            {"role": role, "label": _COMMITTEE_ROLE_LABELS[role]}
            for role in _COMMITTEE_ROLE_LABELS
            if role in covered_roles
        ],
        "missing_roles": recommended_next_roles,
        "persona_counts": persona_counts,
        "best_contacts": best_contacts,
    }


def _build_prospecting_priorities(
    company: Company,
    committee_coverage: dict[str, Any],
    intent: dict[str, Any],
) -> list[str]:
    priorities: list[str] = []

    if (intent or {}).get("funding"):
        priorities.append("Lead with fast time-to-value and rollout control while new budget is available.")
    if (intent or {}).get("hiring"):
        priorities.append("Position Beacon around change-management and onboarding capacity as the team scales.")
    if (intent or {}).get("product"):
        priorities.append("Tie outreach to recent launches or expansion and the need to operationalize adoption quickly.")

    missing_roles = [item.get("label") for item in committee_coverage.get("missing_roles", []) if item.get("label")]
    if missing_roles:
        priorities.append(f"Committee gap: find {', '.join(missing_roles[:3])} before pushing for a late-stage meeting.")

    if company.icp_tier in {"hot", "warm"} and committee_coverage.get("coverage_score", 0) < 75:
        priorities.append("This account fits the ICP, but committee coverage is still thin. Expand contact depth before sequencing heavily.")

    if not priorities:
        priorities.append("Use a role-based sequence: economic buyer, champion, then technical evaluator.")

    return priorities[:4]


def parse_csv(content: bytes) -> list[dict]:
    """Parse CSV bytes into normalized dicts. Skip rows without name or domain."""
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        cleaned = {
            k.strip().lower(): (v or "").strip()
            for k, v in row.items()
            if k and k.strip()
        }
        has_name = any(cleaned.get(a) for a in _ALIASES["name"])
        has_domain = any(cleaned.get(a) for a in _ALIASES["domain"])
        if has_name or has_domain:
            rows.append(cleaned)
    return rows


def row_to_company_fields(row: dict) -> dict:
    """Map a CSV row to Company field dict."""
    name = _find(row, "name") or "Unknown Company"
    domain_raw = _find(row, "domain")
    domain = _clean_domain(domain_raw)
    if not domain:
        domain = f"{_slugify(name)}.unknown"

    fields: dict = {"name": name, "domain": domain}

    industry_raw = _find(row, "industry")
    if industry_raw:
        last_segment = industry_raw.split(">")[-1].split(",")[0].strip()
        fields["industry"] = last_segment[:120]

    emp = _parse_employee_count(_find(row, "employee_count"))
    if emp is not None:
        fields["employee_count"] = emp

    stage = _find(row, "funding_stage")
    if stage:
        fields["funding_stage"] = stage

    funding = _parse_number(_find(row, "total_funding"))
    if funding:
        fields["arr_estimate"] = funding

    desc = _find(row, "description")
    if desc:
        fields["description"] = desc[:1000]

    extra: dict = {}
    for f in ("country", "city"):
        val = _find(row, f)
        if val:
            extra[f] = val[:500]
    if extra:
        fields["enrichment_sources"] = {"import": extra}

    return fields


# ── Tiered Enrichment Pipeline ──────────────────────────────────────────────

async def enrich_company_tiered(company_id: UUID, session: AsyncSession) -> Company | None:
    """
    Run the full tiered enrichment pipeline for a single company.
    Tier 1 (free) → Tier 2 (Apollo) → AI (Claude summarization).
    """
    company = await session.get(Company, company_id)
    if not company:
        logger.warning(f"enrich_company_tiered: company {company_id} not found")
        return None

    # Resolve .unknown domain first
    if company.domain.endswith(".unknown"):
        from app.services.domain_resolver import resolve_and_update_domain
        resolved = await resolve_and_update_domain(company, session)
        if not resolved:
            logger.warning(f"Could not resolve domain for '{company.name}', skipping enrichment")
            return company

    # JSONB is not mutation-tracked by default; always work on a deep copy so
    # assignment marks the field dirty and persists new cache content.
    cache: dict = copy.deepcopy(company.enrichment_cache or {})

    # ── Tier 1: Free sources ────────────────────────────────────────────────
    from app.clients.web_search import WebSearchClient
    ws = WebSearchClient()

    # 1a. Scrape website
    try:
        scraped = await ws.scrape_company_pages(company.domain)
        cache["web_scrape"] = {"data": scraped, "fetched_at": datetime.utcnow().isoformat()}
    except Exception as e:
        logger.error(f"Website scrape failed for {company.domain}: {e}")
        scraped = {"text": "", "pages_scraped": 0}

    # 1b. DuckDuckGo intent signals
    try:
        intent = await ws.search_intent_signals(company.name, company.domain)
        cache["intent_signals"] = {"data": intent, "fetched_at": datetime.utcnow().isoformat()}
        company.intent_signals = {
            "hiring": len(intent.get("hiring", [])),
            "funding": len(intent.get("funding", [])),
            "product": len(intent.get("product", [])),
            "details": intent,
        }
    except Exception as e:
        logger.error(f"Intent signal search failed for {company.name}: {e}")
        intent = {}

    # ── Tier 2: Apollo (paid) ───────────────────────────────────────────────
    from app.clients.apollo import ApolloClient
    apollo = ApolloClient()
    apollo_data = None

    # 2a. Company enrichment
    try:
        apollo_data = await apollo.enrich_company(company.domain)
        if apollo_data:
            cache["apollo_company"] = {"data": apollo_data, "fetched_at": datetime.utcnow().isoformat()}
            _apply_apollo(company, apollo_data)
            logger.info(f"Apollo enriched company: {company.domain}")
    except Exception as e:
        logger.error(f"Apollo company enrichment failed for {company.domain}: {e}")

    # 2b. Contact discovery
    try:
        contacts = await apollo.search_people(
            domain=company.domain,
            limit=10,
            seniorities=["c_suite", "vp", "director"],
        )
        cache["apollo_contacts"] = {"data": contacts, "fetched_at": datetime.utcnow().isoformat()}
        if contacts:
            created = await _create_contacts(company, contacts, session)
            logger.info(f"Found {len(contacts)} contacts, created {created} for {company.domain}")
    except Exception as e:
        logger.error(f"Apollo contact search failed for {company.domain}: {e}")
        # Rollback dirty session state so subsequent steps can commit
        if session.in_transaction():
            try:
                await session.rollback()
            except MissingGreenlet as rollback_error:
                logger.warning(f"Skipped rollback due to async context mismatch: {rollback_error}")
            except Exception as rollback_error:
                logger.warning(f"Rollback failed after Apollo contact error: {rollback_error}")
        # Re-fetch company in clean session state
        company = await session.get(Company, company_id)
        if not company:
            return None

    # ── Tier 3: Hunter.io (paid — fills Apollo gaps) ────────────────────────
    from app.clients.hunter import HunterClient
    hunter = HunterClient()

    # 3a. Hunter domain search — discover contacts Apollo missed
    try:
        hunter_result = await hunter.domain_search(company.domain)
        if hunter_result:
            cache["hunter_contacts"] = {"data": hunter_result, "fetched_at": datetime.utcnow().isoformat()}
            hunter_contacts = hunter_result.get("contacts", [])
            if hunter_contacts:
                created = await _create_contacts(company, hunter_contacts, session)
                logger.info(f"Hunter found {len(hunter_contacts)} contacts, created {created} new for {company.domain}")
    except Exception as e:
        logger.error(f"Hunter domain search failed for {company.domain}: {e}")

    # 3b. Hunter company enrichment — firmographic data
    try:
        hunter_company = await hunter.company_enrichment(company.domain)
        if hunter_company:
            cache["hunter_company"] = {"data": hunter_company, "fetched_at": datetime.utcnow().isoformat()}
            logger.info(f"Hunter enriched company: {company.domain}")
    except Exception as e:
        logger.error(f"Hunter company enrichment failed for {company.domain}: {e}")

    # ── AI Tier: Claude summarization ───────────────────────────────────────
    from app.clients.claude_enrichment import summarize_company
    try:
        summary = await summarize_company(
            scraped_data=scraped,
            apollo_data=apollo_data,
            search_results=intent,
            company_name=company.name,
            domain=company.domain,
        )
        summary_source = summary.get("_source", "unknown")
        is_fallback = summary_source == "fallback"

        if not is_fallback and summary.get("description"):
            company.description = summary["description"]
        if not is_fallback and summary.get("industry") and summary["industry"] != "Unknown":
            company.industry = summary["industry"]
        # Apply tech stack if discovered by AI
        if not is_fallback and summary.get("tech_stack_signals") and not company.tech_stack:
            company.tech_stack = summary["tech_stack_signals"]

        prev_ai_entry = cache.get("ai_summary") if isinstance(cache.get("ai_summary"), dict) else None
        prev_ai_data = prev_ai_entry.get("data") if isinstance(prev_ai_entry, dict) else None
        prev_ai_source = prev_ai_data.get("_source") if isinstance(prev_ai_data, dict) else None

        # Keep last good Claude payload when a fallback response is generated.
        if is_fallback and prev_ai_source == "claude":
            logger.warning(f"Keeping previous Claude AI summary for {company.name}; new summary was fallback")
        else:
            cache["ai_summary"] = {"data": summary, "fetched_at": datetime.utcnow().isoformat()}

        logger.info(f"AI summary generated for {company.name} from source={summary_source} with {len(summary)} fields")
    except Exception as e:
        logger.error(f"Claude summarization failed for {company.name}: {e}")

    # ── Committee coverage & prospecting priorities ─────────────────────────
    try:
        committee_coverage = await _build_committee_coverage(company, session)
        cache["committee_coverage"] = {
            "data": committee_coverage,
            "fetched_at": datetime.utcnow().isoformat(),
        }
        cache["prospecting_priorities"] = {
            "data": _build_prospecting_priorities(company, committee_coverage, intent),
            "fetched_at": datetime.utcnow().isoformat(),
        }
    except Exception as e:
        logger.error(f"Committee coverage analysis failed for {company.name}: {e}")

    # ── Persist ─────────────────────────────────────────────────────────────
    company.enrichment_cache = cache
    company.enriched_at = datetime.utcnow()
    company.icp_score, company.icp_tier = score_company(company)
    company.updated_at = datetime.utcnow()

    # Force-write JSONB cache in case ORM dirty tracking misses nested JSON changes.
    await session.execute(
        sa_update(Company)
        .where(Company.id == company.id)
        .values(enrichment_cache=cache)
    )

    session.add(company)
    await session.commit()
    await session.refresh(company)
    return company


async def re_enrich_company(company_id: UUID, session: AsyncSession) -> Company | None:
    """Re-run the standard tiered pipeline. Always executes (no cache check)."""
    return await enrich_company_tiered(company_id, session)


async def re_enrich_contact_service(contact_id: UUID, session: AsyncSession) -> Contact | None:
    """Re-enrich a single contact via Apollo people/match."""
    contact = await session.get(Contact, contact_id)
    if not contact:
        return None

    from app.clients.apollo import ApolloClient
    apollo = ApolloClient()

    # Get company domain for enrichment
    domain = ""
    if contact.company_id:
        company = await session.get(Company, contact.company_id)
        if company:
            domain = company.domain

    try:
        person = await apollo.enrich_person(
            email=contact.email or "",
            first_name=contact.first_name,
            last_name=contact.last_name,
            domain=domain,
        )
        if person:
            if person.get("title"):
                contact.title = person["title"]
            if person.get("seniority"):
                contact.seniority = person["seniority"]
            if person.get("email"):
                contact.email = person["email"]
            if person.get("linkedin_url"):
                contact.linkedin_url = person["linkedin_url"]
            if person.get("phone"):
                contact.phone = person["phone"]
            contact.enrichment_data = person
    except Exception as e:
        logger.error(f"Contact re-enrich failed for {contact_id}: {e}")

    # Classify persona
    from app.clients.claude_enrichment import classify_contact_persona
    try:
        company_ctx = ""
        if contact.company_id:
            company = await session.get(Company, contact.company_id)
            if company:
                company_ctx = f"{company.name} - {company.industry or 'Unknown'}"
        contact.persona_type = await classify_contact_persona(
            contact.title or "", contact.seniority, company_ctx
        )
        contact.persona = _canonical_persona(contact.persona, contact.persona_type)
    except Exception as e:
        logger.error(f"Persona classification failed for {contact_id}: {e}")

    contact.enriched_at = datetime.utcnow()
    contact.updated_at = datetime.utcnow()
    session.add(contact)
    await session.commit()
    await session.refresh(contact)
    return contact




async def process_batch(batch_id: UUID, session: AsyncSession) -> SourcingBatch | None:
    """Process all companies in a sourcing batch through tiered enrichment."""
    batch = await session.get(SourcingBatch, batch_id)
    if not batch:
        return None

    batch.status = "processing"
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    await session.commit()

    # Get all companies in this batch
    result = await session.execute(
        select(Company).where(Company.sourcing_batch_id == batch_id)
    )
    companies = result.scalars().all()

    processed = 0
    for company in companies:
        try:
            await enrich_company_tiered(company.id, session)
            processed += 1
        except Exception as e:
            logger.error(f"Batch enrichment failed for {company.name}: {e}")
            errors = batch.error_log or []
            errors.append({"company": company.name, "error": str(e)})
            batch.error_log = errors

        batch.processed_rows = processed
        batch.updated_at = datetime.utcnow()
        session.add(batch)
        await session.commit()

    batch.status = "completed"
    batch.updated_at = datetime.utcnow()
    session.add(batch)
    await session.commit()
    await session.refresh(batch)
    return batch


# ── Helpers ────────────────────────────────────────────────────────────────────

def _apply_apollo(company: Company, data: dict) -> None:
    """Write Apollo fields onto the company only when the value is non-None."""
    scalar_fields = [
        "name", "industry", "vertical", "employee_count",
        "arr_estimate", "funding_stage", "has_dap", "dap_tool",
    ]
    for field in scalar_fields:
        value = data.get(field)
        if value is not None:
            setattr(company, field, value)


async def _create_contacts(company: Company, contacts_data: list[dict], session: AsyncSession) -> int:
    """Create contact records from Apollo search results, skipping duplicates.
    Returns count of newly created contacts."""
    from app.clients.claude_enrichment import classify_contact_persona

    created = 0
    for c in contacts_data:
        try:
            email = (c.get("email") or "").strip() or None
            first = (c.get("first_name") or "").strip()
            last = (c.get("last_name") or "").strip()

            if not first and not last:
                continue

            # Skip duplicate by email (use .first() to handle multiple rows safely)
            if email:
                existing = await session.execute(
                    select(Contact).where(Contact.email == email).limit(1)
                )
                if existing.scalars().first():
                    continue

            # Skip duplicate by name + company
            if first and last:
                existing = await session.execute(
                    select(Contact).where(
                        Contact.company_id == company.id,
                        Contact.first_name == first,
                        Contact.last_name == last,
                    ).limit(1)
                )
                if existing.scalars().first():
                    continue

            contact = Contact(
                first_name=first,
                last_name=last,
                email=email,
                title=(c.get("title") or None),
                seniority=(c.get("seniority") or None),
                linkedin_url=(c.get("linkedin_url") or None),
                phone=(c.get("phone") or None),
                company_id=company.id,
                enriched_at=datetime.utcnow(),
                enrichment_data=c,
            )

            # Classify persona
            try:
                company_ctx = f"{company.name} - {company.industry or 'Unknown'}"
                contact.persona_type = await classify_contact_persona(
                    contact.title or "", contact.seniority, company_ctx
                )
                contact.persona = _canonical_persona(contact.persona, contact.persona_type)
            except Exception:
                from app.services.persona_classifier import classify_persona
                contact.persona = classify_persona(contact)

            session.add(contact)
            created += 1

        except Exception as e:
            logger.warning(f"Skipping contact {first} {last}: {e}")
            continue

    if created:
        await session.commit()
    return created
