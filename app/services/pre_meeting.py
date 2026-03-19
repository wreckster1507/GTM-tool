"""
Pre-meeting intelligence service.

Orchestrates:
  1. Playwright scrape of company homepage + /about
  2. Google News RSS signals (already fetched during enrichment, or re-fetched live)
  3. GPT-4o account brief generation via summarise_account

Returns a structured account brief ready to display in the UI.
"""
import logging
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.clients.azure_openai import AzureOpenAIClient
from app.clients.playwright_scraper import scrape_company_homepage
from app.models.company import Company

logger = logging.getLogger(__name__)

ai_client = AzureOpenAIClient()


async def generate_account_brief(company_id: UUID, session: AsyncSession) -> dict:
    """
    Full pre-meeting intelligence pipeline for a company.

    Returns:
        {
            company_id, company_name, domain,
            scraped: { title, description, body_text, about_text },
            news_signals: [...],
            brief: "• bullet 1\n• bullet 2\n• bullet 3",
            tech_stack: {...},
        }
    """
    # Load company from DB
    company = await session.get(Company, company_id)
    if not company:
        return {"error": "Company not found"}

    result = {
        "company_id": str(company_id),
        "company_name": company.name,
        "domain": company.domain,
        "scraped": {},
        "news_signals": [],
        "tech_stack": company.tech_stack or {},
        "brief": None,
    }

    # 1. Playwright scrape
    logger.info(f"Scraping {company.domain} with Playwright…")
    scraped = await scrape_company_homepage(company.domain)
    result["scraped"] = scraped

    # 2. Pull news signals from enrichment_sources if already saved
    news_signals = []
    enrichment_sources = company.enrichment_sources or {}
    if "news" in enrichment_sources:
        news_data = enrichment_sources["news"]
        funding = news_data.get("funding_signals", [])
        pr = news_data.get("pr_signals", [])
        news_signals = funding + pr
    else:
        # Re-fetch live
        from app.clients.news import NewsClient
        news_client = NewsClient()
        news_data = await news_client.get_company_signals(company.name, company.domain) or {}
        news_signals = news_data.get("funding_signals", []) + news_data.get("pr_signals", [])

    result["news_signals"] = news_signals[:6]

    # 3. Build enriched context for GPT-4o
    # Combine scraped website text with DB data for richer prompt
    homepage_context = ""
    if scraped.get("description"):
        homepage_context += f"Website description: {scraped['description']}\n"
    if scraped.get("body_text"):
        homepage_context += f"Homepage content: {scraped['body_text'][:800]}\n"
    if scraped.get("about_text"):
        homepage_context += f"About page: {scraped['about_text'][:600]}\n"

    # Extend the standard summarise_account with scraped web content
    brief_text = await _generate_rich_brief(
        company_name=company.name,
        news_signals=news_signals,
        tech_stack=company.tech_stack or {},
        homepage_context=homepage_context,
        industry=company.industry or "",
        funding_stage=company.funding_stage or "",
        employee_count=company.employee_count,
    )

    result["brief"] = brief_text
    return result


async def _generate_rich_brief(
    company_name: str,
    news_signals: list,
    tech_stack: dict,
    homepage_context: str,
    industry: str = "",
    funding_stage: str = "",
    employee_count: Optional[int] = None,
) -> Optional[str]:
    """GPT-4o prompt enriched with Playwright-scraped website content."""
    if ai_client.mock:
        return (
            f"• {company_name} operates in {industry or 'SaaS'} — review their website for current positioning.\n"
            "• No recent news signals found — research manually before the call.\n"
            "• Suggested angle: lead with implementation speed and reduced IT overhead."
        )

    news_text = "\n".join(f"- {a['title']}" for a in news_signals[:5]) or "No recent news."
    tech_text = ", ".join(f"{k}: {v}" for k, v in (tech_stack or {}).items()) or "Unknown"
    size_text = f"{employee_count:,} employees" if employee_count else "Unknown size"

    system = (
        "You are a sales intelligence analyst preparing a rep for a first meeting. "
        "Write exactly 3 bullet points (start each with •). Be specific, actionable, and concise. "
        "Each bullet: max 2 sentences."
    )
    user = (
        f"Company: {company_name}\n"
        f"Industry: {industry} | Size: {size_text} | Funding: {funding_stage}\n"
        f"Tech stack: {tech_text}\n"
        f"Recent news:\n{news_text}\n"
        f"Website intel:\n{homepage_context or 'Not available.'}\n\n"
        "Write 3 bullets covering:\n"
        "1. Business context & what they do (use website intel)\n"
        "2. Buying signal or trigger event (use news)\n"
        "3. Recommended conversation angle for Beacon.li (AI implementation orchestration)"
    )

    return await ai_client.complete(system, user, max_tokens=350)
