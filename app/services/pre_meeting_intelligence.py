"""
Pre-Meeting Intelligence Service.

Orchestrates all research sources for a sales meeting:
  1. Company profile from DB (ICP, tech stack, funding stage, industry)
  2. Wikipedia background (founding story, company description)
  3. DuckDuckGo recent news (funding rounds, launches, PR)
  4. Stakeholder profiles (contacts linked to company, enriched from DB)
  5. Relevant battlecards (matched by industry/vertical)
  6. GPT-4o Demo Strategy + Story Lineup (Beacon.li positioning)

Result is stored in meeting.research_data (JSONB) and meeting.demo_strategy (Text).
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def run_pre_meeting_intelligence(
    meeting_id: UUID, session: AsyncSession
) -> dict[str, Any]:
    """
    Run the full pre-meeting intelligence pipeline and persist results to the meeting.
    Returns the full intel dict.
    """
    from app.models.meeting import Meeting
    from app.models.company import Company
    from app.repositories.contact import ContactRepository
    from app.repositories.battlecard import BattlecardRepository
    from app.clients.web_search import WebSearchClient
    from app.clients.azure_openai import AzureOpenAIClient

    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        return {"error": "Meeting not found"}

    company: Company | None = None
    if meeting.company_id:
        company = await session.get(Company, meeting.company_id)

    web = WebSearchClient()
    ai = AzureOpenAIClient()

    # ── 1. Company profile ────────────────────────────────────────────────────
    company_profile: dict = {}
    if company:
        company_profile = {
            "name": company.name,
            "domain": company.domain,
            "industry": company.industry,
            "vertical": company.vertical,
            "employee_count": company.employee_count,
            "funding_stage": company.funding_stage,
            "arr_estimate": company.arr_estimate,
            "icp_score": company.icp_score,
            "icp_tier": company.icp_tier,
            "has_dap": company.has_dap,
            "dap_tool": company.dap_tool,
            "tech_stack": company.tech_stack or {},
        }

    # ── 2. Company background (own website scraped + GPT-4o summary) ─────────
    company_background: dict | None = None
    if company and company.domain and not company.domain.endswith(".unknown"):
        try:
            company_background = await web.company_website_summary(
                company.domain, company.name, ai
            )
        except Exception as e:
            logger.warning(f"Website summary failed for {company.name}: {e}")

    # ── 3. Recent news (DuckDuckGo) ───────────────────────────────────────────
    recent_news: list[dict] = []
    milestones: list[dict] = []
    if company:
        try:
            recent_news = await web.recent_news(company.name, company.domain or "")
        except Exception as e:
            logger.warning(f"News search failed for {company.name}: {e}")
        try:
            milestones = await web.company_milestones(company.name)
        except Exception as e:
            logger.warning(f"Milestone search failed for {company.name}: {e}")

    # ── 4. Stakeholder profiles ───────────────────────────────────────────────
    stakeholders: list[dict] = []
    if company:
        contact_repo = ContactRepository(session)
        contacts, _ = await contact_repo.list_with_company_name(
            company_id=company.id, skip=0, limit=20
        )
        for c in contacts:
            stakeholders.append({
                "id": str(c.id),
                "name": f"{c.first_name} {c.last_name}".strip(),
                "title": c.title,
                "email": c.email,
                "persona": c.persona,
                "seniority": c.seniority,
                "linkedin_url": c.linkedin_url,
                "email_verified": c.email_verified,
            })

    # ── 5. Relevant battlecards ───────────────────────────────────────────────
    relevant_battlecards: list[dict] = []
    try:
        bc_repo = BattlecardRepository(session)
        # Search by industry/vertical keywords
        search_term = (
            company.vertical or company.industry or "enterprise"
        ) if company else "enterprise"
        bcs = await bc_repo.search(search_term)
        for bc in bcs[:4]:
            relevant_battlecards.append({
                "id": str(bc.id),
                "title": bc.title,
                "category": bc.category,
                "summary": (bc.content or "")[:300],
            })
    except Exception as e:
        logger.warning(f"Battlecard search failed: {e}")

    # ── Assemble & persist (web research only — demo strategy is separate) ─────
    research_data = {
        "company_profile": company_profile,
        "company_background": company_background,
        "recent_news": recent_news[:5],
        "milestones": milestones[:4],
        "stakeholders": stakeholders,
        "relevant_battlecards": relevant_battlecards,
    }

    from datetime import datetime
    meeting.research_data = research_data
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)

    return {
        "meeting_id": str(meeting_id),
        "research_data": research_data,
    }


async def generate_meeting_demo_strategy(
    meeting_id: UUID, session: AsyncSession
) -> dict[str, Any]:
    """
    Generate (or re-generate) the GPT-4o demo strategy for a meeting.
    Reads existing research_data from the meeting if available; falls back to
    fetching company profile from DB.
    """
    from app.models.meeting import Meeting
    from app.models.company import Company
    from app.clients.azure_openai import AzureOpenAIClient

    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        return {"error": "Meeting not found"}

    ai = AzureOpenAIClient()

    # Prefer cached research_data so we don't re-run web searches
    research: dict = (meeting.research_data or {}) if isinstance(meeting.research_data, dict) else {}
    company_profile = research.get("company_profile", {})
    company_background = research.get("company_background")
    recent_news = research.get("recent_news", [])
    stakeholders = research.get("stakeholders", [])

    # If no cached profile, pull from DB
    if not company_profile and meeting.company_id:
        company: Company | None = await session.get(Company, meeting.company_id)
        if company:
            company_profile = {
                "name": company.name,
                "domain": company.domain,
                "industry": company.industry,
                "vertical": company.vertical,
                "employee_count": company.employee_count,
                "funding_stage": company.funding_stage,
                "arr_estimate": company.arr_estimate,
                "icp_score": company.icp_score,
                "icp_tier": company.icp_tier,
                "has_dap": company.has_dap,
                "dap_tool": company.dap_tool,
                "tech_stack": company.tech_stack or {},
            }

    demo_strategy = await _generate_demo_strategy(
        ai=ai,
        company_profile=company_profile,
        company_background=company_background,
        recent_news=recent_news,
        stakeholders=stakeholders,
        meeting_type=meeting.meeting_type,
    )

    from datetime import datetime
    meeting.demo_strategy = demo_strategy
    meeting.updated_at = datetime.utcnow()
    session.add(meeting)
    await session.commit()
    await session.refresh(meeting)

    return {
        "meeting_id": str(meeting_id),
        "demo_strategy": demo_strategy,
    }


async def _generate_demo_strategy(
    ai,
    company_profile: dict,
    company_background: dict | None,
    recent_news: list[dict],
    stakeholders: list[dict],
    meeting_type: str,
) -> str:
    """Ask GPT-4o to build a demo story lineup tailored to this prospect."""
    if not company_profile:
        return ""

    # Build context for the prompt
    name = company_profile.get("name", "the company")
    industry = company_profile.get("industry", "")
    vertical = company_profile.get("vertical", "")
    employees = company_profile.get("employee_count")
    funding = company_profile.get("funding_stage", "")
    has_dap = company_profile.get("has_dap")
    dap_tool = company_profile.get("dap_tool")
    tech = company_profile.get("tech_stack", {})
    icp_tier = company_profile.get("icp_tier", "")

    bg_extract = company_background.get("extract", "") if company_background else ""
    news_titles = "\n".join(f"- {n['title']}" for n in recent_news[:3]) or "No recent news found."

    persona_summary = ""
    if stakeholders:
        personas = [f"{s['name']} ({s['title'] or s['persona'] or 'unknown'})" for s in stakeholders[:4]]
        persona_summary = ", ".join(personas)

    dap_context = ""
    if has_dap and dap_tool:
        dap_context = f"They currently use {dap_tool} as their DAP/adoption tool — this is a direct displacement opportunity."
    elif has_dap:
        dap_context = "They have a DAP tool in use — position Beacon as the AI-native replacement."
    else:
        dap_context = "No DAP detected — position Beacon as a greenfield AI deployment automation opportunity."

    system = (
        "You are a senior enterprise sales strategist for Beacon.li — an AI implementation "
        "orchestration platform that automates enterprise SaaS deployments (onboarding, adoption, ROI). "
        "You help AEs prepare for demos by creating a tailored story lineup. "
        "Be specific, practical, and concise. Format as numbered bullet points."
    )

    user = f"""
Prospect: {name}
Industry: {industry} / {vertical}
Size: {employees} employees | Stage: {funding} | ICP tier: {icp_tier}
Meeting type: {meeting_type}
Attendees: {persona_summary or 'Unknown'}
Tech context: {dap_context}
Tech stack: {', '.join(f'{k}: {v}' for k, v in tech.items()) or 'Unknown'}
Company background: {bg_extract[:300] if bg_extract else 'Not available'}
Recent signals:
{news_titles}

Generate a Demo Strategy with:
1. Opening hook (30-second value frame specific to their situation)
2. Discovery question to lead with (uncover the pain)
3. Story lineup — 3 demo chapters in order (what to show, why it matters to them)
4. Key differentiation point vs competitors to land
5. Likely objection and how to handle it
6. Suggested next step / call to action
""".strip()

    result = await ai.complete(system, user, max_tokens=600)

    if not result:
        # Fallback: structured mock strategy
        return (
            f"Demo Strategy for {name}\n\n"
            f"1. Opening hook: Lead with the cost of failed SaaS implementations in {industry or 'your industry'}\n"
            f"2. Discovery: 'What does your current onboarding process look like for new software rollouts?'\n"
            f"3. Story lineup:\n"
            f"   • Chapter 1: The Problem — show a failed rollout scenario they recognize\n"
            f"   • Chapter 2: Beacon Automation — live workflow builder, AI decision engine\n"
            f"   • Chapter 3: ROI Proof — time-to-value dashboard, adoption metrics\n"
            f"4. Key differentiation: Unlike {dap_tool or 'point solutions'}, Beacon orchestrates the full deployment lifecycle\n"
            f"5. Objection: 'We already have tools' → 'Beacon connects them — it's the missing orchestration layer'\n"
            f"6. Next step: Technical deep-dive + pilot scoping call with IT/Ops stakeholder"
        )

    return result
