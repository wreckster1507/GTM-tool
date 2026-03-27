"""
Pre-Meeting Intelligence Service.

Orchestrates ALL available research sources for a sales meeting:
  1.  Company profile from DB (ICP, tech stack, funding stage, industry)
  2.  Company background (own website scraped + GPT-4o summary)
  3.  Deep website analysis (pricing, careers, customers pages)
  4.  DuckDuckGo recent news (funding rounds, launches, PR)
  5.  Company milestones (history, founding events)
  6.  Intent signals (hiring, funding, product/growth — via DuckDuckGo)
  7.  Google News RSS feed (latest headlines)
  8.  Hunter.io contact discovery + email pattern
  9.  Hunter.io company enrichment (firmographics)
  10. Competitive landscape (DuckDuckGo competitor search)
  11. Stakeholder profiles (contacts linked to company, enriched from DB)
  12. Relevant battlecards (matched by industry/vertical)
  13. GPT-4o executive briefing (synthesises all data into actionable prep)

Result is stored in meeting.research_data (JSONB) and meeting.demo_strategy (Text).
"""
from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime
from typing import Any
from uuid import UUID

import httpx
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

_COMMITTEE_ROLE_LABELS = {
    "economic_buyer": "Economic Buyer",
    "champion": "Champion",
    "technical_evaluator": "Technical Evaluator",
    "implementation_owner": "Implementation Owner",
}

_ROLE_FOCUS = {
    "economic_buyer": "ROI, time-to-value, deployment risk, and executive visibility.",
    "champion": "Operational pain, internal adoption friction, and proof they can reuse internally.",
    "technical_evaluator": "Architecture fit, integrations, security, and rollout feasibility.",
    "implementation_owner": "Project effort, change management, and admin burden during rollout.",
    "unknown": "Role clarity, current process pain, and where Beacon would slot into the rollout.",
}

_ROLE_TALK_TRACK = {
    "economic_buyer": "Anchor the conversation on failed rollouts, slower time-to-value, and how Beacon reduces deployment drag.",
    "champion": "Give them a clear before/after story they can share internally and use to win sponsorship.",
    "technical_evaluator": "Show how Beacon works with the existing stack instead of forcing a rip-and-replace motion.",
    "implementation_owner": "Focus on workflow orchestration, ownership, approvals, and how Beacon reduces manual coordination.",
    "unknown": "Use discovery to understand where they sit in the buying process before jumping into product depth.",
}

_ROLE_QUESTION_BANK = {
    "economic_buyer": [
        "What rollout delays or adoption gaps are most expensive for the business right now?",
        "How do you measure time-to-value after a new SaaS deployment goes live?",
    ],
    "champion": [
        "Where does implementation coordination break down most often today?",
        "What internal friction do you hit when trying to drive adoption across teams?",
    ],
    "technical_evaluator": [
        "Which systems would Beacon need to orchestrate or read from first?",
        "What integration, security, or governance constraints matter most in evaluation?",
    ],
    "implementation_owner": [
        "Who owns the rollout plan today and where does work fall between teams?",
        "What tasks are still manual when a deployment moves from plan to execution?",
    ],
    "unknown": [
        "What does a successful deployment look like for your team this quarter?",
        "Where do projects tend to stall after purchase but before adoption is real?",
    ],
}

_IMPLEMENTATION_OWNER_KEYWORDS = [
    "ops", "operations", "admin", "administrator", "systems", "enablement",
    "implementation", "program", "project", "revops", "hris", "people ops",
    "people operations", "business systems",
]


def _canonical_persona(persona: str | None, persona_type: str | None = None) -> str:
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
    title: str | None,
    persona: str | None,
    persona_type: str | None = None,
) -> str:
    title_lower = (title or "").strip().lower()
    if any(keyword in title_lower for keyword in _IMPLEMENTATION_OWNER_KEYWORDS):
        return "implementation_owner"

    canonical = _canonical_persona(persona, persona_type)
    if canonical in _COMMITTEE_ROLE_LABELS:
        return canonical
    return "unknown"


def _stakeholder_priority_score(stakeholder: dict[str, Any]) -> int:
    role = _infer_committee_role(
        stakeholder.get("title"),
        stakeholder.get("persona"),
        stakeholder.get("persona_type"),
    )
    score = {
        "economic_buyer": 40,
        "champion": 35,
        "technical_evaluator": 32,
        "implementation_owner": 28,
        "unknown": 18,
    }.get(role, 18)

    seniority = (stakeholder.get("seniority") or "").lower()
    if seniority in {"c_suite", "csuite", "c-suite", "founder", "owner"}:
        score += 12
    elif seniority == "vp":
        score += 9
    elif seniority in {"director", "head"}:
        score += 6

    if stakeholder.get("email"):
        score += 3
    if stakeholder.get("linkedin_url"):
        score += 2

    return score


def _normalize_meeting_attendees(attendees: Any) -> list[dict[str, Any]]:
    if not isinstance(attendees, list):
        return []

    normalized: list[dict[str, Any]] = []
    for item in attendees:
        if not isinstance(item, dict):
            continue
        normalized.append({
            "contact_id": str(item.get("contact_id")) if item.get("contact_id") else None,
            "name": (item.get("name") or item.get("full_name") or "").strip(),
            "title": (item.get("title") or "").strip(),
            "email": (item.get("email") or "").strip().lower(),
        })
    return normalized


def _match_attendee_to_stakeholder(
    attendee: dict[str, Any],
    stakeholders: list[dict[str, Any]],
) -> dict[str, Any] | None:
    contact_id = attendee.get("contact_id")
    if contact_id:
        for stakeholder in stakeholders:
            if stakeholder.get("id") == contact_id:
                return stakeholder

    email = attendee.get("email")
    if email:
        for stakeholder in stakeholders:
            if (stakeholder.get("email") or "").strip().lower() == email:
                return stakeholder

    name = (attendee.get("name") or "").strip().lower()
    if name:
        for stakeholder in stakeholders:
            if (stakeholder.get("name") or "").strip().lower() == name:
                return stakeholder

    return None


def _build_stakeholder_card(
    *,
    stakeholder: dict[str, Any] | None,
    attendee: dict[str, Any] | None,
    status: str,
) -> dict[str, Any]:
    title = attendee.get("title") if attendee else None
    if stakeholder and stakeholder.get("title"):
        title = stakeholder.get("title")

    persona = _canonical_persona(
        (stakeholder or {}).get("persona"),
        (stakeholder or {}).get("persona_type"),
    )
    role = _infer_committee_role(title, persona, (stakeholder or {}).get("persona_type"))
    role_key = role if role in _ROLE_FOCUS else "unknown"
    question_bank = _ROLE_QUESTION_BANK[role_key]

    return {
        "contact_id": (stakeholder or {}).get("id"),
        "name": (
            (attendee or {}).get("name")
            or (stakeholder or {}).get("name")
            or "Unknown attendee"
        ),
        "title": title,
        "email": (attendee or {}).get("email") or (stakeholder or {}).get("email"),
        "linkedin_url": (stakeholder or {}).get("linkedin_url"),
        "persona": persona,
        "role": role,
        "role_label": _COMMITTEE_ROLE_LABELS.get(role, "Stakeholder"),
        "status": status,
        "priority": "high" if role in {"economic_buyer", "champion", "technical_evaluator"} else "medium",
        "likely_focus": _ROLE_FOCUS[role_key],
        "talk_track": _ROLE_TALK_TRACK[role_key],
        "questions_to_ask": question_bank[:2],
    }


def _build_committee_coverage(stakeholder_cards: list[dict[str, Any]]) -> dict[str, Any]:
    discovered_roles = {
        card["role"]
        for card in stakeholder_cards
        if card.get("role") in _COMMITTEE_ROLE_LABELS
    }
    attending_roles = {
        card["role"]
        for card in stakeholder_cards
        if card.get("status") == "attending" and card.get("role") in _COMMITTEE_ROLE_LABELS
    }
    missing_roles = [
        role for role in _COMMITTEE_ROLE_LABELS
        if role not in discovered_roles
    ]
    meeting_gaps = [
        role for role in _COMMITTEE_ROLE_LABELS
        if role not in attending_roles
    ]

    return {
        "coverage_score": round((len(discovered_roles) / max(len(_COMMITTEE_ROLE_LABELS), 1)) * 100),
        "discovered_roles": [
            {"role": role, "label": _COMMITTEE_ROLE_LABELS[role]}
            for role in _COMMITTEE_ROLE_LABELS
            if role in discovered_roles
        ],
        "attending_roles": [
            {"role": role, "label": _COMMITTEE_ROLE_LABELS[role]}
            for role in _COMMITTEE_ROLE_LABELS
            if role in attending_roles
        ],
        "missing_roles": [
            {"role": role, "label": _COMMITTEE_ROLE_LABELS[role]}
            for role in missing_roles
        ],
        "meeting_gaps": [
            {"role": role, "label": _COMMITTEE_ROLE_LABELS[role]}
            for role in meeting_gaps
        ],
    }


def _build_attendee_intelligence(
    meeting_attendees: Any,
    stakeholders: list[dict[str, Any]],
) -> dict[str, Any]:
    normalized_attendees = _normalize_meeting_attendees(meeting_attendees)
    stakeholder_cards: list[dict[str, Any]] = []
    used_contact_ids: set[str] = set()

    for attendee in normalized_attendees[:6]:
        matched = _match_attendee_to_stakeholder(attendee, stakeholders)
        if matched and matched.get("id"):
            used_contact_ids.add(str(matched["id"]))
        stakeholder_cards.append(
            _build_stakeholder_card(stakeholder=matched, attendee=attendee, status="attending")
        )

    if not stakeholder_cards:
        sorted_stakeholders = sorted(
            stakeholders,
            key=_stakeholder_priority_score,
            reverse=True,
        )
        covered_roles: set[str] = set()
        for stakeholder in sorted_stakeholders:
            card = _build_stakeholder_card(stakeholder=stakeholder, attendee=None, status="recommended")
            role = card.get("role")
            if role in _COMMITTEE_ROLE_LABELS and role not in covered_roles:
                covered_roles.add(role)
                stakeholder_cards.append(card)
            elif role == "unknown" and len(stakeholder_cards) < 4:
                stakeholder_cards.append(card)
            if len(stakeholder_cards) >= 4:
                break
    else:
        sorted_stakeholders = sorted(
            [stakeholder for stakeholder in stakeholders if stakeholder.get("id") not in used_contact_ids],
            key=_stakeholder_priority_score,
            reverse=True,
        )
        attendee_roles = {
            card["role"] for card in stakeholder_cards if card.get("role") in _COMMITTEE_ROLE_LABELS
        }
        for stakeholder in sorted_stakeholders:
            card = _build_stakeholder_card(stakeholder=stakeholder, attendee=None, status="recommended")
            role = card.get("role")
            if role in _COMMITTEE_ROLE_LABELS and role not in attendee_roles:
                stakeholder_cards.append(card)
                attendee_roles.add(role)
            if len(stakeholder_cards) >= 6:
                break

    return {
        "has_explicit_attendees": len(normalized_attendees) > 0,
        "stakeholder_cards": stakeholder_cards,
        "committee_coverage": _build_committee_coverage(stakeholder_cards),
    }


def _build_why_now_signals(
    company_profile: dict[str, Any],
    website_analysis: dict[str, Any] | None,
    recent_news: list[dict[str, Any]],
    intent_signals: dict[str, Any],
    google_news: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    why_now: list[dict[str, Any]] = []

    for key, label in (
        ("funding", "Funding / budget signal"),
        ("hiring", "Hiring / scaling signal"),
        ("product", "Launch / expansion signal"),
    ):
        items = (intent_signals or {}).get(key, [])
        if items:
            first = items[0]
            why_now.append({
                "title": label,
                "detail": first.get("title") or first.get("snippet") or "",
                "source": "web_search",
                "url": first.get("url"),
            })

    for article in (recent_news or [])[:2]:
        why_now.append({
            "title": "Recent company momentum",
            "detail": article.get("title", ""),
            "source": "recent_news",
            "url": article.get("url"),
        })

    for item in (google_news or [])[:2]:
        why_now.append({
            "title": f"Headline from {item.get('source') or 'Google News'}",
            "detail": item.get("title", ""),
            "source": "google_news",
            "url": item.get("url"),
        })

    if website_analysis and website_analysis.get("hiring_signals"):
        why_now.append({
            "title": "Hiring signal from website",
            "detail": website_analysis["hiring_signals"],
            "source": "website_analysis",
        })

    if company_profile.get("icp_tier") in {"hot", "warm"}:
        why_now.append({
            "title": "Strong ICP fit",
            "detail": f"{company_profile.get('name', 'This account')} scores {company_profile.get('icp_score', 'n/a')} and sits in the {company_profile.get('icp_tier')} tier.",
            "source": "crm_profile",
        })

    deduped: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in why_now:
        key = item.get("detail", "").strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return deduped[:6]


def _build_meeting_recommendations(
    meeting_type: str,
    attendee_intelligence: dict[str, Any],
    why_now_signals: list[dict[str, Any]],
    competitive_landscape: list[dict[str, Any]],
) -> list[str]:
    recommendations: list[str] = []
    stakeholder_cards = attendee_intelligence.get("stakeholder_cards", [])
    committee = attendee_intelligence.get("committee_coverage", {})
    meeting_gaps = [item.get("label") for item in committee.get("meeting_gaps", []) if item.get("label")]

    if why_now_signals:
        recommendations.append(f"Open with the timing hook: {why_now_signals[0].get('detail')}")
    if stakeholder_cards:
        lead = stakeholder_cards[0]
        recommendations.append(
            f"Start discovery around {lead.get('name')}'s likely focus: {lead.get('likely_focus')}"
        )
    if meeting_gaps:
        recommendations.append(
            f"Committee gap for this meeting: bring in {', '.join(meeting_gaps[:2])} before advancing too far."
        )
    if competitive_landscape:
        recommendations.append("Expect competitive framing to come up; land Beacon as orchestration rather than another point solution.")
    if meeting_type == "demo":
        recommendations.append("Keep the story concrete: show how Beacon reduces rollout coordination load, not just feature breadth.")
    elif meeting_type == "discovery":
        recommendations.append("Use the first half to validate rollout pain, ownership gaps, and urgency before going deep into product.")

    return recommendations[:5]


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
    from app.clients.hunter import HunterClient

    meeting = await session.get(Meeting, meeting_id)
    if not meeting:
        return {"error": "Meeting not found"}

    company: Company | None = None
    if meeting.company_id:
        company = await session.get(Company, meeting.company_id)

    web = WebSearchClient()
    ai = AzureOpenAIClient()
    hunter = HunterClient()

    domain = (company.domain or "") if company else ""
    name = (company.name or "") if company else ""

    # ── 1. Company profile ────────────────────────────────────────────────────
    company_profile: dict = {}
    if company:
        company_profile = {
            "name": name,
            "domain": domain,
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

    # ── 2-7. Parallel web research (all independent, non-blocking) ───────────
    #     Each task is wrapped so a failure returns a safe default.
    company_background: dict | None = None
    website_pages: dict | None = None
    recent_news: list[dict] = []
    milestones: list[dict] = []
    intent_signals: dict = {}
    google_news: list[dict] = []
    hunter_contacts: dict | None = None
    hunter_company: dict | None = None
    competitive_landscape: list[dict] = []

    async def _website_summary():
        if not domain or domain.endswith(".unknown"):
            return None
        return await web.company_website_summary(domain, name, ai)

    async def _website_pages():
        if not domain or domain.endswith(".unknown"):
            return None
        return await web.scrape_company_pages(domain)

    async def _recent_news():
        if not name:
            return []
        return await web.recent_news(name, domain)

    async def _milestones():
        if not name:
            return []
        return await web.company_milestones(name, domain)

    async def _intent_signals():
        if not name:
            return {}
        return await web.search_intent_signals(name, domain)

    async def _google_news():
        if not name:
            return []
        return await _fetch_google_news_rss(name, domain)

    async def _hunter_search():
        if not domain or domain.endswith(".unknown"):
            return None
        return await hunter.domain_search(domain)

    async def _hunter_enrich():
        if not domain or domain.endswith(".unknown"):
            return None
        return await hunter.company_enrichment(domain)

    async def _competitors():
        if not name:
            return []
        return await web.search(
            f'"{name}" competitors OR alternatives OR "vs" {datetime.utcnow().year}',
            max_results=5,
        )

    # Fire all web research in parallel
    tasks = {
        "bg": _website_summary(),
        "pages": _website_pages(),
        "news": _recent_news(),
        "milestones": _milestones(),
        "intent": _intent_signals(),
        "gnews": _google_news(),
        "hunter": _hunter_search(),
        "hunter_co": _hunter_enrich(),
        "competitors": _competitors(),
    }
    results = await asyncio.gather(
        *tasks.values(), return_exceptions=True
    )
    task_map = dict(zip(tasks.keys(), results))

    def _safe(key, default=None):
        val = task_map.get(key)
        if isinstance(val, Exception):
            logger.warning(f"Pre-meeting intel task '{key}' failed: {val}")
            return default
        return val if val is not None else default

    company_background = _safe("bg")
    website_pages = _safe("pages")
    recent_news = _safe("news", [])
    milestones = _safe("milestones", [])
    intent_signals = _safe("intent", {})
    google_news = _safe("gnews", [])
    hunter_contacts = _safe("hunter")
    hunter_company = _safe("hunter_co")
    competitive_landscape = _safe("competitors", [])

    # ── 8. Deep website analysis (extract pricing/careers/customers insights) ─
    website_analysis: dict | None = None
    if website_pages and website_pages.get("pages_scraped", 0) > 0:
        website_analysis = await _analyse_website_pages(ai, name, website_pages.get("text", ""))

    # ── 9. Stakeholder profiles ───────────────────────────────────────────────
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
                "persona": _canonical_persona(c.persona, c.persona_type),
                "persona_type": c.persona_type,
                "seniority": c.seniority,
                "linkedin_url": c.linkedin_url,
                "email_verified": c.email_verified,
            })

    attendee_intelligence = _build_attendee_intelligence(meeting.attendees, stakeholders)
    why_now_signals = _build_why_now_signals(
        company_profile=company_profile,
        website_analysis=website_analysis,
        recent_news=recent_news,
        intent_signals=intent_signals,
        google_news=google_news,
    )

    # ── 10. Relevant battlecards ──────────────────────────────────────────────
    relevant_battlecards: list[dict] = []
    try:
        bc_repo = BattlecardRepository(session)
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

    # ── 11. Knowledge base context ─────────────────────────────────────────────
    from app.services.knowledge_context import get_knowledge_context
    kb_context = await get_knowledge_context(session, "pre_meeting", limit=5)

    # ── 12. GPT-4o executive briefing ─────────────────────────────────────────
    executive_briefing: str | None = None
    if company_profile:
        executive_briefing = await _generate_executive_briefing(
            ai=ai,
            company_profile=company_profile,
            company_background=company_background,
            website_analysis=website_analysis,
            recent_news=recent_news,
            intent_signals=intent_signals,
            google_news=google_news,
            hunter_company=hunter_company,
            competitive_landscape=competitive_landscape,
            stakeholders=stakeholders,
            attendee_intelligence=attendee_intelligence,
            why_now_signals=why_now_signals,
            meeting_type=meeting.meeting_type,
            kb_context=kb_context,
        )

    meeting_recommendations = _build_meeting_recommendations(
        meeting_type=meeting.meeting_type,
        attendee_intelligence=attendee_intelligence,
        why_now_signals=why_now_signals,
        competitive_landscape=competitive_landscape,
    )

    # ── Assemble & persist ────────────────────────────────────────────────────
    research_data = {
        "company_profile": company_profile,
        "company_background": company_background,
        "website_analysis": website_analysis,
        "recent_news": recent_news[:8],
        "milestones": milestones[:5],
        "intent_signals": intent_signals,
        "google_news": google_news[:6],
        "hunter_contacts": hunter_contacts,
        "hunter_company": hunter_company,
        "competitive_landscape": competitive_landscape[:5],
        "stakeholders": stakeholders,
        "attendee_intelligence": attendee_intelligence,
        "why_now_signals": why_now_signals,
        "meeting_recommendations": meeting_recommendations,
        "relevant_battlecards": relevant_battlecards,
        "executive_briefing": executive_briefing,
    }

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
    attendee_intelligence = research.get("attendee_intelligence", {})
    why_now_signals = research.get("why_now_signals", [])

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

    from app.services.knowledge_context import get_knowledge_context as _get_kb
    kb_context = await _get_kb(session, "demo_strategy", limit=4, max_total_chars=2000)

    demo_strategy = await _generate_demo_strategy(
        ai=ai,
        company_profile=company_profile,
        company_background=company_background,
        recent_news=recent_news,
        stakeholders=stakeholders,
        attendee_intelligence=attendee_intelligence,
        why_now_signals=why_now_signals,
        meeting_type=meeting.meeting_type,
        kb_context=kb_context,
    )

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
    attendee_intelligence: dict | None,
    why_now_signals: list[dict],
    meeting_type: str,
    kb_context: str = "",
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
    tech = company_profile.get("tech_stack") or {}
    icp_tier = company_profile.get("icp_tier", "")

    bg_extract = company_background.get("extract", "") if company_background else ""
    news_titles = "\n".join(f"- {n['title']}" for n in recent_news[:3]) or "No recent news found."

    persona_summary = ""
    stakeholder_cards = (attendee_intelligence or {}).get("stakeholder_cards", [])
    if stakeholder_cards:
        personas = [
            f"{s.get('name')} ({s.get('title') or s.get('role_label') or 'unknown'})"
            for s in stakeholder_cards[:4]
        ]
        persona_summary = ", ".join(personas)
    elif stakeholders:
        personas = [f"{s['name']} ({s['title'] or s['persona'] or 'unknown'})" for s in stakeholders[:4]]
        persona_summary = ", ".join(personas)

    dap_context = ""
    if has_dap and dap_tool:
        dap_context = f"They currently use {dap_tool} as their DAP/adoption tool — this is a direct displacement opportunity."
    elif has_dap:
        dap_context = "They have a DAP tool in use — position Beacon as the AI-native replacement."
    else:
        dap_context = "No DAP detected — position Beacon as a greenfield AI deployment automation opportunity."

    timing_context = "\n".join(
        f"- {signal.get('detail', '')}"
        for signal in (why_now_signals or [])[:3]
        if signal.get("detail")
    ) or "No strong timing signals found."

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
Tech stack: {', '.join(f'{k}: {v}' for k, v in tech.items()) if isinstance(tech, dict) else ', '.join(str(t) for t in tech) if isinstance(tech, list) else 'Unknown'}
Company background: {bg_extract[:300] if bg_extract else 'Not available'}
Recent signals:
{news_titles}
Why now:
{timing_context}
{kb_context}
Generate a Demo Strategy with:
1. Opening hook (30-second value frame specific to their situation)
2. Discovery question to lead with (uncover the pain)
3. Story lineup — 3 demo chapters in order (what to show, why it matters to them)
4. Key differentiation point vs competitors to land
5. Likely objection and how to handle it
6. Suggested next step / call to action
""".strip()

    result = await ai.complete(system, user, max_tokens=600)

    return result


# ── Helper: Google News RSS ──────────────────────────────────────────────────

async def _fetch_google_news_rss(company_name: str, domain: str = "") -> list[dict]:
    """Fetch latest headlines from Google News RSS for the company.
    Uses exact-match quotes + domain to avoid false positives for common words."""
    import xml.etree.ElementTree as ET
    from urllib.parse import quote_plus

    # Use exact phrase + domain to disambiguate (e.g., "Rippling" rippling.com)
    domain_hint = f" {domain}" if domain and not domain.endswith(".unknown") else ""
    query = quote_plus(f'"{company_name}"{domain_hint} company')
    url = f"https://news.google.com/rss/search?q={query}&hl=en-US&gl=US&ceid=US:en"

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                return []

        root = ET.fromstring(resp.text)
        items = root.findall(".//item")
        results = []
        name_lower = company_name.lower()
        for item in items[:15]:  # fetch more, then filter
            title_el = item.find("title")
            link_el = item.find("link")
            pub_el = item.find("pubDate")
            source_el = item.find("source")
            title = title_el.text if title_el is not None else ""

            # Relevance filter: title must contain the company name as a
            # standalone word/brand, not just as a common English verb/adjective
            if name_lower not in title.lower():
                continue

            results.append({
                "title": title,
                "url": link_el.text if link_el is not None else "",
                "published": pub_el.text if pub_el is not None else "",
                "source": source_el.text if source_el is not None else "",
            })
            if len(results) >= 6:
                break
        return results
    except Exception as e:
        logger.warning(f"Google News RSS failed for '{company_name}': {e}")
        return []


# ── Helper: Deep website page analysis ───────────────────────────────────────

async def _analyse_website_pages(ai, company_name: str, raw_text: str) -> dict | None:
    """Use GPT-4o to extract structured insights from scraped website pages."""
    if not raw_text or len(raw_text) < 100:
        return None

    system = (
        "You are a B2B sales intelligence analyst. Given raw text scraped from a company's "
        "website (homepage, about, pricing, careers, customers pages), extract actionable "
        "sales intelligence. Respond in this exact format:\n"
        "PRODUCTS: <comma-separated list of main products/services>\n"
        "TARGET_MARKET: <who they sell to — industry, company size, roles>\n"
        "PRICING_MODEL: <pricing approach if visible — freemium, per-seat, enterprise, etc.>\n"
        "KEY_CUSTOMERS: <notable customer names if mentioned>\n"
        "HIRING_SIGNALS: <what roles they're hiring for, what it implies about growth>\n"
        "TECH_CLUES: <any technology/platform mentions relevant to a sales conversation>\n"
        "PAIN_POINTS: <business challenges they claim to solve for their customers>\n"
        "If a field cannot be determined, write 'Not available' after the colon."
    )
    user = f"Company: {company_name}\n\nScraped content:\n{raw_text[:5000]}"

    try:
        response = await ai.complete(system, user, max_tokens=500)
        if not response:
            return None
        # Parse KEY: value lines
        parsed = {}
        for line in response.strip().splitlines():
            if ":" in line:
                key, value = line.split(":", 1)
                key = key.strip().lower().replace(" ", "_")
                value = value.strip()
                if value and value.lower() != "not available":
                    parsed[key] = value
        return parsed if parsed else None
    except Exception as e:
        logger.warning(f"Website analysis failed for {company_name}: {e}")
        return None


# ── Helper: Executive briefing ───────────────────────────────────────────────

async def _generate_executive_briefing(
    ai,
    company_profile: dict,
    company_background: dict | None,
    website_analysis: dict | None,
    recent_news: list[dict],
    intent_signals: dict,
    google_news: list[dict],
    hunter_company: dict | None,
    competitive_landscape: list[dict],
    stakeholders: list[dict],
    attendee_intelligence: dict[str, Any],
    why_now_signals: list[dict[str, Any]],
    meeting_type: str,
    kb_context: str = "",
) -> str | None:
    """
    GPT-4o synthesises ALL collected intelligence into a concise executive
    briefing — the #1 thing a sales rep reads before walking into the meeting.
    """
    name = company_profile.get("name", "the company")
    industry = company_profile.get("industry", "")
    employees = company_profile.get("employee_count", "")
    funding = company_profile.get("funding_stage", "")
    icp_tier = company_profile.get("icp_tier", "")
    dap_tool = company_profile.get("dap_tool", "")

    bg = company_background.get("extract", "") if company_background else ""

    # Website analysis summary
    wa_lines = ""
    if website_analysis:
        wa_lines = "\n".join(f"  {k}: {v}" for k, v in website_analysis.items())

    # News
    news_lines = "\n".join(
        f"- {n.get('title', '')}" for n in (recent_news or [])[:4]
    ) or "None found."

    # Google News
    gnews_lines = "\n".join(
        f"- [{n.get('source', '')}] {n.get('title', '')}" for n in (google_news or [])[:4]
    ) or "None."

    # Intent signals
    intent_lines = ""
    for category in ("hiring", "funding", "product"):
        items = (intent_signals or {}).get(category, [])
        if items:
            intent_lines += f"\n  {category.title()}:"
            for s in items[:2]:
                intent_lines += f"\n    - {s.get('title', s.get('snippet', ''))}"
    intent_lines = intent_lines or "\n  No strong buying signals detected."

    # Competitors
    comp_lines = "\n".join(
        f"- {c.get('title', '')}" for c in (competitive_landscape or [])[:3]
    ) or "No competitor mentions found."

    # Hunter firmographics
    hunter_lines = ""
    if hunter_company:
        for k in ("industry", "type", "size", "founded", "country"):
            v = hunter_company.get(k)
            if v:
                hunter_lines += f"\n  {k}: {v}"

    # Stakeholders
    personas = ""
    if stakeholders:
        for s in stakeholders[:5]:
            personas += f"\n  - {s['name']} | {s.get('title', 'Unknown title')} | {s.get('persona', 'unknown')}"

    stakeholder_lines = ""
    stakeholder_cards = attendee_intelligence.get("stakeholder_cards", []) if isinstance(attendee_intelligence, dict) else []
    if stakeholder_cards:
        for card in stakeholder_cards[:6]:
            stakeholder_lines += (
                f"\n  - {card.get('name')} | {card.get('title') or 'Unknown title'} | "
                f"{card.get('role_label', 'Stakeholder')} | {card.get('status')}"
                f"\n    focus: {card.get('likely_focus', '')}"
            )

    committee = attendee_intelligence.get("committee_coverage", {}) if isinstance(attendee_intelligence, dict) else {}
    committee_lines = ""
    if committee:
        discovered = ", ".join(item.get("label", "") for item in committee.get("discovered_roles", [])) or "None"
        attending = ", ".join(item.get("label", "") for item in committee.get("attending_roles", [])) or "None"
        missing = ", ".join(item.get("label", "") for item in committee.get("meeting_gaps", [])) or "None"
        committee_lines = (
            f"\n  Coverage score: {committee.get('coverage_score', 0)}"
            f"\n  Discovered roles: {discovered}"
            f"\n  In this meeting: {attending}"
            f"\n  Missing from this meeting: {missing}"
        )

    why_now_lines = "\n".join(
        f"- {item.get('detail', '')}"
        for item in (why_now_signals or [])[:5]
        if item.get("detail")
    ) or "None."

    system = (
        "You are a senior enterprise sales strategist for Beacon.li. "
        "Synthesise the intelligence below into a concise EXECUTIVE BRIEFING that a sales rep "
        "can read in 2 minutes before a meeting. Structure it as:\n\n"
        "## Company Snapshot\n1-2 sentences on who they are and what they do.\n\n"
        "## Why They're a Fit\nTop 3 reasons this prospect matches our ICP.\n\n"
        "## Key Buying Signals\nBullet points of timing/urgency indicators.\n\n"
        "## Potential Risks & Objections\nWhat could block the deal + how to handle.\n\n"
        "## Stakeholder Guidance\nWho is likely in the room, what they care about, and how to tailor the conversation.\n\n"
        "## Recommended Approach\n2-3 sentences on how to run this meeting.\n\n"
        "## Key Questions to Ask\n3-5 discovery questions tailored to their situation.\n\n"
        "Be specific to THIS company. No generic advice."
    )

    user = f"""
Company: {name}
Industry: {industry} | Employees: {employees} | Funding: {funding} | ICP: {icp_tier}
Current DAP: {dap_tool or 'None detected'}
Meeting type: {meeting_type}

Background: {bg[:400] if bg else 'Not available'}

Website Analysis:
{wa_lines or '  Not available'}

Recent News (DuckDuckGo):
{news_lines}

Google News Headlines:
{gnews_lines}

Buying Intent Signals:{intent_lines}

Why Now:
{why_now_lines}

Competitive Landscape:
{comp_lines}

Hunter Firmographics:{hunter_lines or '  Not available'}

Key Stakeholders:{personas or '  No contacts discovered yet.'}

Meeting Stakeholder Matrix:{stakeholder_lines or '  No explicit attendee data. Use discovered contacts as a fallback.'}

Committee Coverage:{committee_lines or '  Not available'}
{kb_context}
""".strip()

    try:
        result = await ai.complete(system, user, max_tokens=800)
        return result
    except Exception as e:
        logger.warning(f"Executive briefing generation failed: {e}")
        return None
