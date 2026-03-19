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
from datetime import datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.company import Company

logger = logging.getLogger(__name__)


async def resolve_and_update_domain(company: Company, session: AsyncSession) -> bool:
    """
    Attempt to resolve an unknown domain for `company` using AI.

    Returns True if the domain was successfully resolved and updated, False otherwise.
    The caller is responsible for committing the session if needed.
    """
    if not company.domain.endswith(".unknown"):
        return False  # Already has a real domain — nothing to do

    from app.clients.azure_openai import AzureOpenAIClient

    # Pull description from enrichment_sources if available (set during CSV import)
    description: str | None = None
    if isinstance(company.enrichment_sources, dict):
        description = (company.enrichment_sources.get("import") or {}).get("description")

    ai = AzureOpenAIClient()
    resolved = await ai.resolve_domain(
        company_name=company.name,
        industry=company.industry,
        description=description,
    )

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
