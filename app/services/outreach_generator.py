"""
Outreach sequence generator — uses Azure OpenAI GPT-4o to craft
persona-aware email sequences and LinkedIn messages.

Persona strategy:
  economic_buyer     → ROI, risk reduction, executive framing
  champion           → enablement, internal win, career story
  technical_evaluator → architecture fit, integration depth, proof
  unknown            → generic value-based opening

Each contact gets a 3-touch email cadence + a LinkedIn connection note.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, delete

logger = logging.getLogger(__name__)

# ── Persona prompt fragments ───────────────────────────────────────────────────

_PERSONA_SYSTEM = {
    "economic_buyer": (
        "You are a senior enterprise sales rep at Beacon.li — an AI implementation orchestration platform "
        "that automates enterprise SaaS deployments, reducing onboarding time by 60-80%. "
        "You are writing to a C-suite / VP-level economic buyer. "
        "Focus on: business risk reduction, ROI, time-to-value, and competitive differentiation. "
        "Keep emails under 120 words. Be direct, no fluff. Never use phrases like 'I hope this finds you well'."
    ),
    "champion": (
        "You are a senior enterprise sales rep at Beacon.li — an AI implementation orchestration platform. "
        "You are writing to an internal champion (HR leader, Operations manager, Director-level). "
        "Focus on: making them look good internally, reducing their team's manual work, "
        "enabling them to deliver faster value with less risk. "
        "Keep emails under 120 words. Be consultative and peer-level, not salesy."
    ),
    "technical_evaluator": (
        "You are a senior enterprise sales rep at Beacon.li — an AI implementation orchestration platform. "
        "You are writing to a technical evaluator (CTO, Director of Engineering, Solutions Architect). "
        "Focus on: integration approach, technical architecture, security/compliance, and proof points. "
        "Mention that Beacon connects to their existing SaaS stack without replacing it. "
        "Keep emails under 130 words. Use precise, technical language."
    ),
    "unknown": (
        "You are a senior enterprise sales rep at Beacon.li — an AI implementation orchestration platform "
        "that automates enterprise SaaS deployments. "
        "Write a concise, value-focused outreach email. Keep under 100 words."
    ),
}

_FOLLOWUP_NUDGES = {
    1: "This is a 3-day follow-up. Reference the previous email briefly, add one new insight or stat, and keep a soft CTA.",
    2: "This is a 7-day final follow-up. Be brief. Acknowledge they're busy. Offer a clear exit or a quick 15-minute chat.",
}

_LINKEDIN_SYSTEM = (
    "You are crafting a LinkedIn connection request note (max 300 characters). "
    "Be authentic, specific to their role, and give a clear reason to connect. "
    "Do NOT use generic openers. Do NOT pitch the product in the connection note."
)


async def generate_sequence(
    contact_id: UUID, session: AsyncSession
) -> Optional["OutreachSequence"]:  # noqa: F821
    """
    Generate a full outreach sequence for a contact.
    Fetches contact + company context, calls GPT-4o, persists to DB.
    """
    from app.models.contact import Contact
    from app.models.company import Company
    from app.models.outreach import OutreachSequence, OutreachStep
    from app.models.settings import WorkspaceSettings
    from app.clients.azure_openai import AzureOpenAIClient

    # ── Load contact + company ─────────────────────────────────────────────────
    contact = await session.get(Contact, contact_id)
    if not contact:
        logger.warning(f"generate_sequence: contact {contact_id} not found")
        return None

    company = await session.get(Company, contact.company_id) if contact.company_id else None

    # ── Build context dict ─────────────────────────────────────────────────────
    context = _build_context(contact, company)
    persona = contact.persona or "unknown"
    system_prompt = _PERSONA_SYSTEM.get(persona, _PERSONA_SYSTEM["unknown"])

    # ── Knowledge base context ──────────────────────────────────────────────────
    from app.services.knowledge_context import get_knowledge_context
    kb_context = await get_knowledge_context(session, "outreach", limit=3, max_total_chars=1500)
    context["kb_context"] = kb_context

    ai = AzureOpenAIClient()

    # Check for existing sequence
    existing = await session.execute(
        select(OutreachSequence).where(OutreachSequence.contact_id == contact_id)
    )
    seq = existing.scalar_one_or_none()
    if not seq:
        seq = OutreachSequence(
            contact_id=contact_id,
            company_id=contact.company_id,
            persona=persona,
        )

    # ── Email 1 — initial outreach ────────────────────────────────────────────
    email1_prompt = _build_initial_prompt(context)
    email1_result = await ai.complete(system_prompt, email1_prompt, max_tokens=250)

    seq.email_1 = email1_result
    seq.subject_1 = _extract_subject(email1_result) or f"Quick question for {context['company_name']}"

    # ── Email 2 — 3-day follow-up ────────────────────────────────────────────
    email2_prompt = _build_followup_prompt(context, touch=1, prior_email=email1_result)
    email2_result = await ai.complete(system_prompt, email2_prompt, max_tokens=200)
    seq.email_2 = email2_result
    seq.subject_2 = f"Re: {seq.subject_1}"

    # ── Email 3 — 7-day final follow-up ──────────────────────────────────────
    email3_prompt = _build_followup_prompt(context, touch=2, prior_email=email1_result)
    email3_result = await ai.complete(system_prompt, email3_prompt, max_tokens=150)
    seq.email_3 = email3_result
    seq.subject_3 = f"Re: {seq.subject_1}"

    # ── LinkedIn message ──────────────────────────────────────────────────────
    li_prompt = _build_linkedin_prompt(context)
    li_result = await ai.complete(_LINKEDIN_SYSTEM, li_prompt, max_tokens=80)
    seq.linkedin_message = li_result

    seq.generation_context = context
    seq.generated_at = datetime.utcnow()
    seq.updated_at = datetime.utcnow()

    session.add(seq)
    await session.flush()  # Flush to get seq.id before creating steps

    # ── Load step delays from workspace settings ──────────────────────────────
    ws = await session.get(WorkspaceSettings, 1)
    step_delays = (ws.outreach_step_delays if ws else None) or [0, 3, 7]

    # ── Create OutreachStep records (flexible, non-hardcoded) ─────────────────
    # Delete any existing steps for this sequence before regenerating
    existing_steps = await session.execute(
        select(OutreachStep).where(OutreachStep.sequence_id == seq.id)
    )
    for old_step in existing_steps.scalars().all():
        await session.delete(old_step)

    email_bodies = [email1_result, email2_result, email3_result]
    subjects = [seq.subject_1, seq.subject_2, seq.subject_3]

    for i, delay in enumerate(step_delays):
        body = email_bodies[i] if i < len(email_bodies) else email_bodies[-1]
        subject = subjects[i] if i < len(subjects) else subjects[-1]
        step = OutreachStep(
            sequence_id=seq.id,
            step_number=i + 1,
            subject=subject,
            body=body,
            delay_value=delay,
            delay_unit="days",
        )
        session.add(step)

    await session.commit()
    await session.refresh(seq)

    logger.info(f"Outreach sequence generated for {contact.email} ({persona}) — {len(step_delays)} steps")
    return seq


# ── Prompt builders ────────────────────────────────────────────────────────────

def _build_context(contact, company) -> dict:
    full_name = f"{contact.first_name} {contact.last_name}".strip()
    company_name = company.name if company else "their company"
    industry = getattr(company, "industry", "") or ""
    funding = getattr(company, "funding_stage", "") or ""
    employees = getattr(company, "employee_count", None)
    tech_stack = getattr(company, "tech_stack", None) or {}

    # Pull funding signals from enrichment_sources
    enrichment = getattr(company, "enrichment_sources", {}) or {}
    news = enrichment.get("news", {})
    funding_headlines = [
        a["title"] for a in news.get("funding_signals", [])[:2]
    ] if news else []

    return {
        "contact_name": full_name,
        "first_name": contact.first_name,
        "title": contact.title or "leader",
        "company_name": company_name,
        "industry": industry,
        "funding_stage": funding,
        "employee_count": employees,
        "tech_stack": list(tech_stack.keys())[:5] if isinstance(tech_stack, dict) else [],
        "funding_headlines": funding_headlines,
        "persona": contact.persona or "unknown",
        "linkedin_url": contact.linkedin_url or "",
    }


def _build_initial_prompt(ctx: dict) -> str:
    funding_note = ""
    if ctx["funding_headlines"]:
        funding_note = f"\nRecent news: {ctx['funding_headlines'][0]}"

    emp_note = ""
    if ctx["employee_count"]:
        emp_note = f", ~{ctx['employee_count']} employees"

    stack_note = ""
    if ctx["tech_stack"]:
        stack_note = f"\nTech stack: {', '.join(ctx['tech_stack'])}"

    kb_note = ctx.get("kb_context", "")

    return (
        f"Write a cold outreach email to {ctx['contact_name']}, {ctx['title']} at {ctx['company_name']}.\n"
        f"Industry: {ctx['industry']}{emp_note}\n"
        f"Funding stage: {ctx['funding_stage']}{funding_note}{stack_note}\n\n"
        "Include: a subject line on the first line (format 'Subject: ...'), "
        "then the email body. Reference something specific about their company or role. "
        "End with a clear, low-friction CTA (15-min chat or a simple yes/no question)."
        f"{kb_note}"
    )


def _build_followup_prompt(ctx: dict, touch: int, prior_email: str) -> str:
    nudge = _FOLLOWUP_NUDGES.get(touch, "")
    return (
        f"Contact: {ctx['contact_name']}, {ctx['title']} at {ctx['company_name']}.\n"
        f"Prior email sent:\n{prior_email[:300]}...\n\n"
        f"{nudge}\n"
        "Do NOT repeat the full prior email. Write only the follow-up body (no subject line needed)."
    )


def _build_linkedin_prompt(ctx: dict) -> str:
    return (
        f"Write a LinkedIn connection note to {ctx['contact_name']}, "
        f"{ctx['title']} at {ctx['company_name']} ({ctx['industry']}). "
        "Max 300 characters. Be specific, warm, and give one concrete reason to connect."
    )


def _extract_subject(email_text: Optional[str]) -> Optional[str]:
    """Pull the subject line if GPT included one in 'Subject: ...' format."""
    if not email_text:
        return None
    for line in email_text.splitlines():
        if line.lower().startswith("subject:"):
            subject = line[len("subject:"):].strip()
            # Remove it from the body by returning it
            return subject
    return None


