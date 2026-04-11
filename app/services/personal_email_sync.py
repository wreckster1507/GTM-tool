"""
Personal email sync service.

Core logic for processing a batch of EmailMessage objects fetched from a
user's personal Gmail. Handles:

  1. Deal/contact matching via email address → domain → AI fallback
  2. CRM gap-filling: auto-create contacts and companies from emails
  3. Activity logging (deduped by message_id + deal_id)
  4. AI-driven task generation from email thread context

Called by the Celery task (personal_email_sync.py) which handles fetching,
token refresh, and cursor management.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.gmail_inbox import EmailMessage
from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal, DealContact
from app.models.task import Task
from app.models.user import User
from app.models.user_email_connection import UserEmailConnection

logger = logging.getLogger(__name__)

# ── AI task triggers ──────────────────────────────────────────────────────────
# Maps intent phrases → (system_key, suggested_action_label)
INTENT_TASK_MAP = [
    (["agreed to poc", "agree to poc", "proceed with poc", "let's do a poc", "happy to start poc",
      "interested in poc", "keen on poc", "move to poc"], "move_deal_stage:poc_agreed"),
    (["signed the msa", "msa signed", "contracts signed", "signed agreement",
      "send over the contract", "finalize the contract"], "move_deal_stage:commercial_negotiation"),
    (["closed", "going with you", "selected beacon", "chosen beacon",
      "moving forward with beacon"], "move_deal_stage:closed_won"),
    (["not interested", "not a fit", "no longer pursuing", "decided against",
      "going with another vendor", "not moving forward"], "move_deal_stage:not_a_fit"),
    (["send pricing", "share pricing", "what does it cost", "pricing details",
      "can you send a quote", "send a proposal"], "send_pricing_package"),
    (["schedule a call", "book a meeting", "can we meet", "set up a call",
      "let's connect", "find a time", "calendar invite"], "book_workshop_session"),
    (["following up", "circling back", "checking in", "any update",
      "just wanted to follow", "haven't heard"], "follow_up_buyer_thread"),
    (["poc update", "poc progress", "poc status", "how is the poc",
      "update on the poc"], "move_deal_stage:poc_wip"),
]


def _normalize_domain(value: str | None) -> str:
    domain = (value or "").strip().lower()
    if domain.startswith("www."):
        domain = domain[4:]
    return domain


def _domain_from_email(addr: str) -> str:
    if "@" not in addr:
        return ""
    return _normalize_domain(addr.split("@", 1)[1])


def _infer_name_from_email(addr: str) -> tuple[str, str]:
    local = (addr.split("@", 1)[0] if "@" in addr else addr).strip()
    parts = [p for p in local.replace("_", ".").replace("-", ".").split(".") if p]
    if not parts:
        return "Unknown", "Contact"
    if len(parts) == 1:
        return parts[0].title(), "Contact"
    return parts[0].title(), " ".join(p.title() for p in parts[1:])


def _detect_intent(text: str) -> str | None:
    """Return a system_key if the email text signals a CRM action."""
    lower = text.lower()
    for phrases, system_key in INTENT_TASK_MAP:
        if any(phrase in lower for phrase in phrases):
            return system_key
    return None


async def _ai_classify_email(
    subject: str,
    body: str,
    company_names: list[str],
    contact_names: list[str],
) -> dict | None:
    """
    Ask Claude Haiku to identify which company/contact this email is about
    and whether it contains a CRM-relevant intent.

    Returns dict with keys: company_name, contact_name, intent_key (all optional).
    Only called when domain matching fails — keeps cost near-zero.
    """
    from app.config import settings

    if not settings.claude_api_key:
        return None

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
        known_companies = ", ".join(company_names[:20]) if company_names else "none known"
        known_contacts = ", ".join(contact_names[:20]) if contact_names else "none known"

        prompt = (
            "You are a CRM assistant. Analyze this sales email and answer ONLY with valid JSON.\n\n"
            f"Known CRM companies: {known_companies}\n"
            f"Known CRM contacts: {known_contacts}\n\n"
            f"Subject: {subject}\n\n"
            f"Email body (first 1000 chars):\n{body[:1000]}\n\n"
            "Return JSON with these optional fields:\n"
            '  "company_name": the CRM company name this email is about (or null)\n'
            '  "contact_name": the CRM contact name in this email (or null)\n'
            '  "intent": one of: poc_agreed, poc_wip, commercial_negotiation, '
            'closed_won, not_a_fit, send_pricing_package, book_workshop_session, '
            'follow_up_buyer_thread, or null\n\n'
            "Only match known CRM companies/contacts. Return null for unknowns."
        )

        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=150,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text.strip()
        # Strip markdown code fences if present
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
        import json
        return json.loads(text)
    except Exception as e:
        logger.warning("AI email classification failed: %s", e)
        return None


async def _generate_email_summary(subject: str, body: str) -> str | None:
    """One-line summary for activity.ai_summary."""
    from app.config import settings

    if not settings.claude_api_key or len(body) < 100:
        return None
    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)
        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": (
                    "Summarize this sales email in one sentence (max 15 words). "
                    "Focus on the key action or outcome.\n\n"
                    f"Subject: {subject}\n\n{body[:1200]}"
                ),
            }],
        )
        return response.content[0].text.strip()
    except Exception:
        return None


async def _get_or_create_company_by_domain(
    session: AsyncSession,
    domain: str,
    suggested_name: str | None = None,
) -> Company | None:
    """Find a company by domain. Create a stub if not found."""
    if not domain or domain in ("gmail.com", "yahoo.com", "outlook.com",
                                 "hotmail.com", "icloud.com", "protonmail.com"):
        return None  # Never auto-create free email providers as companies

    result = await session.execute(
        select(Company).where(Company.domain == domain)
    )
    company = result.scalar_one_or_none()
    if company:
        return company

    # Create a stub company — lean, no enrichment yet
    name = suggested_name or domain.split(".")[0].title()
    company = Company(
        name=name,
        domain=domain,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(company)
    await session.flush()  # get the id without committing
    logger.info("personal_email_sync: auto-created company '%s' (domain=%s)", name, domain)
    return company


async def _get_or_create_contact_by_email(
    session: AsyncSession,
    email_addr: str,
    display_name: str | None,
    company_id: UUID | None,
    sync_user_id: UUID,
) -> Contact:
    """Find or create a contact by email address."""
    result = await session.execute(
        select(Contact).where(Contact.email == email_addr)
    )
    contact = result.scalar_one_or_none()
    if contact:
        return contact

    first_name, last_name = _infer_name_from_email(email_addr)
    if display_name and display_name.strip():
        parts = display_name.strip().split(" ", 1)
        first_name = parts[0]
        last_name = parts[1] if len(parts) > 1 else "Contact"

    contact = Contact(
        first_name=first_name,
        last_name=last_name,
        email=email_addr,
        company_id=company_id,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(contact)
    await session.flush()
    logger.info(
        "personal_email_sync: auto-created contact '%s %s' <%s>",
        first_name, last_name, email_addr,
    )
    return contact


async def _ensure_deal_contact(
    session: AsyncSession,
    deal_id: UUID,
    contact_id: UUID,
) -> None:
    """Link a contact to a deal if not already linked."""
    existing = await session.execute(
        select(DealContact).where(
            DealContact.deal_id == deal_id,
            DealContact.contact_id == contact_id,
        )
    )
    if not existing.scalar_one_or_none():
        session.add(DealContact(deal_id=deal_id, contact_id=contact_id))
        await session.flush()


async def _create_ai_task_for_deal(
    session: AsyncSession,
    deal_id: UUID,
    deal: Deal,
    intent_key: str,
    email_subject: str,
    synced_by_user_id: UUID,
) -> bool:
    """
    Create a system task on a deal based on an AI-detected intent.
    Returns True if a task was created.
    """
    # intent_key is either "move_deal_stage:POC_AGREED" or a plain action
    if ":" in intent_key:
        action, target_stage = intent_key.split(":", 1)
    else:
        action = intent_key
        target_stage = None

    system_key = f"personal_email_intent:{intent_key}"

    # Dedup: skip if an open task with this system_key already exists for this deal
    existing = await session.execute(
        select(Task).where(
            Task.entity_type == "deal",
            Task.entity_id == deal_id,
            Task.system_key == system_key,
            Task.status == "open",
        )
    )
    if existing.scalar_one_or_none():
        return False

    # Build title from intent
    title_map = {
        "move_deal_stage": f"Move deal to {(target_stage or '').replace('_', ' ').title()}",
        "send_pricing_package": "Send pricing package to client",
        "book_workshop_session": "Book a meeting / workshop session",
        "follow_up_buyer_thread": "Follow up on unanswered email thread",
    }
    title = title_map.get(action, f"Action required: {action.replace('_', ' ').title()}")
    description = (
        f"Detected from email: \"{email_subject}\"\n\n"
        f"AI identified this conversation as requiring: {title}"
    )
    if target_stage:
        description += f"\n\nSuggested stage move: {target_stage.replace('_', ' ').title()}"

    action_payload = {"action": action}
    if target_stage:
        action_payload["target_stage"] = target_stage

    task = Task(
        title=title,
        description=description,
        entity_type="deal",
        entity_id=deal_id,
        task_type="system",
        system_key=system_key,
        action_payload=action_payload,
        status="open",
        priority="normal",
        assigned_to_id=deal.assigned_to_id,
        created_by_id=synced_by_user_id,
        source="personal_email_sync",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(task)
    await session.flush()
    logger.info(
        "personal_email_sync: created task '%s' for deal %s (intent=%s)",
        title, deal_id, intent_key,
    )
    return True


# ── Main processing entry point ───────────────────────────────────────────────

async def process_personal_emails(
    session: AsyncSession,
    messages: list[EmailMessage],
    connection: UserEmailConnection,
    sync_user: User,
) -> dict:
    """
    Process a batch of EmailMessages fetched from a user's personal inbox.

    Returns summary dict: {activities_created, contacts_created,
                           companies_created, tasks_created, emails_processed}
    """
    stats = {
        "activities_created": 0,
        "contacts_created": 0,
        "companies_created": 0,
        "tasks_created": 0,
        "emails_processed": 0,
    }

    if not messages:
        return stats

    # Pre-load all company domains for fast lookup (avoid N+1 queries)
    all_companies_result = await session.execute(
        select(Company.id, Company.name, Company.domain)
    )
    company_domain_map: dict[str, tuple[UUID, str]] = {}  # domain → (id, name)
    all_company_names: list[str] = []
    for row in all_companies_result.all():
        d = _normalize_domain(row.domain)
        if d:
            company_domain_map[d] = (row.id, row.name)
        all_company_names.append(row.name)

    # Pre-load all contact emails for fast lookup
    all_contacts_result = await session.execute(
        select(Contact.id, Contact.email, Contact.first_name, Contact.last_name)
    )
    contact_email_map: dict[str, UUID] = {}
    all_contact_names: list[str] = []
    for row in all_contacts_result.all():
        if row.email:
            contact_email_map[row.email.lower().strip()] = row.id
        all_contact_names.append(f"{row.first_name} {row.last_name}")

    for msg in messages:
        stats["emails_processed"] += 1

        # Collect all addresses in this message, excluding the user's own address
        all_addrs: set[str] = set()
        all_addrs.add(msg.from_addr)
        all_addrs.update(msg.to_addrs)
        all_addrs.update(msg.cc_addrs)
        all_addrs.discard("")
        all_addrs.discard(connection.email_address.lower())

        if not all_addrs:
            continue

        # ── Pass 1: exact email address match → contact → deal ──────────────
        matched_contact_ids: list[UUID] = []
        for addr in all_addrs:
            cid = contact_email_map.get(addr)
            if cid:
                matched_contact_ids.append(cid)

        deal_ids: list[UUID] = []
        if matched_contact_ids:
            dc_result = await session.execute(
                select(DealContact.deal_id).where(
                    DealContact.contact_id.in_(matched_contact_ids)
                ).distinct()
            )
            deal_ids = [row.deal_id for row in dc_result.all()]

        # ── Pass 2: company domain match ─────────────────────────────────────
        if not deal_ids:
            external_domains = {
                _domain_from_email(addr)
                for addr in all_addrs
                if _domain_from_email(addr)
            }
            # Remove the user's own company domain (don't match internal mail)
            user_domain = _domain_from_email(connection.email_address)
            external_domains.discard(user_domain)

            for domain in external_domains:
                if domain in company_domain_map:
                    company_id, _ = company_domain_map[domain]
                    # Find deals linked to this company
                    deal_result = await session.execute(
                        select(Deal.id, Deal.assigned_to_id, Deal.stage).where(
                            Deal.company_id == company_id
                        )
                    )
                    for row in deal_result.all():
                        if row.id not in deal_ids:
                            deal_ids.append(row.id)

        # ── Pass 3: AI classification fallback ───────────────────────────────
        if not deal_ids and (msg.subject or msg.body_text):
            ai_result = await _ai_classify_email(
                subject=msg.subject,
                body=msg.body_text,
                company_names=all_company_names,
                contact_names=all_contact_names,
            )
            if ai_result:
                ai_company = (ai_result.get("company_name") or "").strip()
                if ai_company:
                    # Try to find a matching company by name (case-insensitive)
                    comp_result = await session.execute(
                        select(Company.id).where(
                            Company.name.ilike(ai_company)
                        )
                    )
                    comp_row = comp_result.scalar_one_or_none()
                    if comp_row:
                        deal_result = await session.execute(
                            select(Deal.id).where(Deal.company_id == comp_row)
                        )
                        deal_ids = [r.id for r in deal_result.all()]

        if not deal_ids:
            # No match found — still may need gap-fill (new contact from external domain)
            await _gap_fill_contacts(
                session, msg, all_addrs, connection, sync_user.id,
                company_domain_map, stats,
            )
            continue

        # ── Gap-fill: create missing contacts ────────────────────────────────
        newly_created_contact_ids: list[tuple[UUID, UUID | None]] = []  # (contact_id, deal_id_hint)
        for addr in all_addrs:
            if addr in contact_email_map:
                continue
            domain = _domain_from_email(addr)
            if not domain:
                continue
            company_id: UUID | None = None
            if domain in company_domain_map:
                company_id = company_domain_map[domain][0]
            else:
                # Try to auto-create company from the domain
                company = await _get_or_create_company_by_domain(
                    session, domain,
                    suggested_name=None,
                )
                if company:
                    company_id = company.id
                    company_domain_map[domain] = (company.id, company.name)
                    stats["companies_created"] += 1

            display_name = msg.from_name if addr == msg.from_addr else None
            contact = await _get_or_create_contact_by_email(
                session, addr, display_name, company_id, sync_user.id,
            )
            contact_email_map[addr] = contact.id
            matched_contact_ids.append(contact.id)
            stats["contacts_created"] += 1
            newly_created_contact_ids.append((contact.id, deal_ids[0] if deal_ids else None))

        # Link new contacts to deals
        for contact_id, _ in newly_created_contact_ids:
            for deal_id in deal_ids:
                await _ensure_deal_contact(session, deal_id, contact_id)

        # ── Activity logging ──────────────────────────────────────────────────
        sender_contact_id: UUID | None = contact_email_map.get(msg.from_addr)
        ai_summary = await _generate_email_summary(msg.subject, msg.body_text)

        # Detect intent from raw text (cheap, no AI)
        body_lower = (msg.subject + " " + msg.body_text).lower()
        intent_key = _detect_intent(body_lower)

        for deal_id in deal_ids:
            # Dedup check
            existing = await session.execute(
                select(Activity.id).where(
                    and_(
                        Activity.email_message_id == msg.message_id,
                        Activity.deal_id == deal_id,
                    )
                )
            )
            if existing.first():
                continue

            deal = await session.get(Deal, deal_id)
            if not deal:
                continue

            activity = Activity(
                type="email",
                source="personal_email_sync",
                deal_id=deal_id,
                contact_id=sender_contact_id,
                content=msg.body_text[:2000] if msg.body_text else None,
                ai_summary=ai_summary,
                email_message_id=msg.message_id,
                email_subject=msg.subject,
                email_from=msg.from_addr,
                email_to=", ".join(msg.to_addrs),
                email_cc=", ".join(msg.cc_addrs),
                created_by_id=sync_user.id,
                event_metadata={
                    "synced_by_user_id": str(sync_user.id),
                    "synced_by_email": connection.email_address,
                    "gmail_thread_id": msg.thread_id or None,
                    "intent_detected": intent_key,
                },
            )
            session.add(activity)
            stats["activities_created"] += 1

            # AI task generation
            if intent_key:
                created = await _create_ai_task_for_deal(
                    session, deal_id, deal,
                    intent_key=intent_key,
                    email_subject=msg.subject,
                    synced_by_user_id=sync_user.id,
                )
                if created:
                    stats["tasks_created"] += 1

    await session.commit()
    return stats


async def _gap_fill_contacts(
    session: AsyncSession,
    msg: EmailMessage,
    all_addrs: set[str],
    connection: UserEmailConnection,
    sync_user_id: UUID,
    company_domain_map: dict[str, tuple[UUID, str]],
    stats: dict,
) -> None:
    """
    When no deal match is found, still create contacts for external addresses
    if their domain matches a known company. This ensures we capture new
    stakeholders even if they haven't been linked to a deal yet.
    """
    user_domain = _domain_from_email(connection.email_address)
    for addr in all_addrs:
        domain = _domain_from_email(addr)
        if not domain or domain == user_domain:
            continue
        if domain not in company_domain_map:
            continue

        contact_result = await session.execute(
            select(Contact.id).where(Contact.email == addr)
        )
        if contact_result.scalar_one_or_none():
            continue

        company_id = company_domain_map[domain][0]
        display_name = msg.from_name if addr == msg.from_addr else None
        await _get_or_create_contact_by_email(
            session, addr, display_name, company_id, sync_user_id,
        )
        stats["contacts_created"] += 1
