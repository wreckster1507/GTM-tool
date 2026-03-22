"""
AI-powered domain resolver for companies imported without a known domain.

When a company's domain ends with '.unknown' (set by the CSV importer as a placeholder),
this service asks Azure OpenAI GPT-4o to infer the real domain from the company name
and any available metadata (industry, description).

If the AI is confident, the company record is updated in place so all downstream
services (Hunter, BuiltWith, enrichment) can proceed with a real domain.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company

logger = logging.getLogger(__name__)


def _company_name_variants(name: str) -> list[str]:
    raw = (name or "").strip()
    variants: list[str] = []
    if raw:
        variants.append(raw)

    without_parens = re.sub(r"\s*\([^)]*\)", "", raw).strip()
    if without_parens and without_parens not in variants:
        variants.append(without_parens)

    for separator in (" - ", " / ", " | "):
        if separator in without_parens:
            first = without_parens.split(separator)[0].strip()
            if first and first not in variants:
                variants.append(first)

    return variants[:3]


async def resolve_and_update_domain(company: Company, session: AsyncSession) -> bool:
    """
    Attempt to resolve an unknown domain for `company` using AI.

    Returns True if the domain was successfully resolved and updated, False otherwise.
    The caller is responsible for committing the session if needed.
    """
    if not company.domain.endswith(".unknown"):
        return False  # Already has a real domain — nothing to do

    from app.clients.azure_openai import AzureOpenAIClient

    # Pull the strongest imported context first, then fall back to any existing company description.
    description: str | None = company.description
    if isinstance(company.enrichment_sources, dict):
        import_block = company.enrichment_sources.get("import") or {}
        if isinstance(import_block, dict):
            analyst = import_block.get("analyst") or {}
            if isinstance(analyst, dict):
                description = (
                    analyst.get("core_focus")
                    or analyst.get("icp_why")
                    or analyst.get("intent_why")
                    or description
                )

    ai = AzureOpenAIClient()
    resolved = None
    for candidate_name in _company_name_variants(company.name):
        resolved = await ai.resolve_domain(
            company_name=candidate_name,
            industry=company.industry,
            description=description,
        )
        if resolved:
            break

    if not resolved:
        logger.info(f"Domain resolver: no confident domain found for '{company.name}'")
        return False

    # Guard against a duplicate domain already in the DB
    from sqlmodel import select
    existing = await session.execute(
        select(Company).where(Company.domain == resolved, Company.id != company.id)
    )
    if existing.scalar_one_or_none():
        logger.warning(
            f"Domain resolver: '{resolved}' already belongs to another company — skipping update for '{company.name}'"
        )
        return False

    logger.info(f"Domain resolver: '{company.name}' → '{resolved}' (was '{company.domain}')")
    company.domain = resolved
    company.updated_at = datetime.utcnow()
    session.add(company)
    await session.commit()
    await session.refresh(company)
    return True
