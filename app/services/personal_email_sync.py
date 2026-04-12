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

import email.utils
import logging
import re
from datetime import datetime
from typing import Optional
from uuid import UUID, uuid4

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.google_docs import fetch_google_doc_context
from app.clients.gmail_inbox import EmailMessage
from app.config import settings
from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal, DealContact
from app.models.meeting import Meeting
from app.models.task import Task
from app.models.user import User
from app.models.user_email_connection import UserEmailConnection
from app.services.tasks import refresh_system_tasks_for_entity

logger = logging.getLogger(__name__)
FREE_EMAIL_PROVIDERS = {
    "gmail.com",
    "yahoo.com",
    "outlook.com",
    "hotmail.com",
    "icloud.com",
    "protonmail.com",
}

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
    (["poc completed", "poc complete", "completed the poc", "pilot completed",
      "pilot complete", "wrapped up the poc", "finished the poc"], "move_deal_stage:poc_done"),
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


def _normalize_name_key(value: str | None) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", " ", (value or "").strip().lower())
    return " ".join(cleaned.split())


def _match_company_from_text(
    text: str,
    company_name_candidates: list[tuple[str, UUID, str]],
) -> tuple[UUID, str] | None:
    normalized_text = _normalize_name_key(text)
    if not normalized_text:
        return None

    haystack = f" {normalized_text} "
    for normalized_name, company_id, company_name in company_name_candidates:
        if f" {normalized_name} " in haystack:
            return company_id, company_name
    return None


def _detect_intent(text: str) -> str | None:
    """Return a system_key if the email text signals a CRM action."""
    lower = text.lower()
    for phrases, system_key in INTENT_TASK_MAP:
        if any(phrase in lower for phrase in phrases):
            return system_key
    return None


def _parse_message_datetime(value: str | None) -> datetime:
    if not value:
        return datetime.utcnow()
    try:
        parsed = email.utils.parsedate_to_datetime(value)
        if parsed is None:
            return datetime.utcnow()
        if parsed.tzinfo is not None:
            return parsed.astimezone().replace(tzinfo=None)
        return parsed
    except Exception:
        return datetime.utcnow()


def _detect_latest_intent(segments: list[str]) -> str | None:
    for segment in reversed(segments):
        intent = _detect_intent(segment)
        if intent:
            return intent
    combined = "\n\n".join(segments[-4:])
    return _detect_intent(combined)


async def _load_existing_thread_segments(
    session: AsyncSession,
    *,
    deal_id: UUID,
    thread_id: str,
) -> list[str]:
    if not thread_id:
        return []
    rows = (
        await session.execute(
            select(
                Activity.created_at,
                Activity.email_subject,
                Activity.content,
                Activity.event_metadata,
            ).where(
                Activity.deal_id == deal_id,
                Activity.type == "email",
            ).order_by(Activity.created_at.asc())
        )
    ).all()

    segments: list[str] = []
    for row in rows:
        metadata = row.event_metadata if isinstance(row.event_metadata, dict) else {}
        if metadata.get("gmail_thread_id") != thread_id:
            continue
        latest_message_text = str(metadata.get("thread_latest_message_text") or "").strip()
        google_doc_transcript = str(metadata.get("google_doc_transcript") or "").strip()
        snippet = "\n".join(
            part for part in [row.email_subject or "", latest_message_text or row.content or "", google_doc_transcript] if part
        ).strip()
        if snippet:
            segments.append(snippet)
    return segments


async def _count_open_system_tasks(session: AsyncSession, deal_id: UUID) -> int:
    result = await session.execute(
        select(Task.id).where(
            Task.entity_type == "deal",
            Task.entity_id == deal_id,
            Task.task_type == "system",
            Task.status == "open",
        )
    )
    return len(result.all())


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
    if not domain or domain in FREE_EMAIL_PROVIDERS:
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


async def _ensure_meeting_for_deal(
    session: AsyncSession,
    deal: Deal,
    msg: EmailMessage,
    contact_ids: list[UUID],
) -> bool:
    """
    Create a meeting record when an email signals a call was booked.
    Deduped by gmail thread_id so re-syncing won't create duplicates.
    Returns True if a new meeting was created.
    """
    # Deduplicate: one meeting per Gmail thread per deal
    thread_source_id = f"gmail_thread:{msg.thread_id}" if msg.thread_id else f"gmail_msg:{msg.message_id}"
    existing = await session.execute(
        select(Meeting).where(
            Meeting.deal_id == deal.id,
            Meeting.external_source == "personal_email_sync",
            Meeting.external_source_id == thread_source_id,
        )
    )
    if existing.scalar_one_or_none():
        return False

    # Build attendees list from contacts in this thread
    attendees = []
    if contact_ids:
        contacts_result = await session.execute(
            select(
                Contact.id, Contact.first_name, Contact.last_name,
                Contact.email, Contact.title,
            ).where(Contact.id.in_(contact_ids[:6]))
        )
        for row in contacts_result.all():
            attendees.append({
                "contact_id": str(row.id),
                "name": f"{row.first_name} {row.last_name}".strip(),
                "email": row.email or "",
                "title": row.title or "",
            })

    # Infer meeting type from subject
    subject_lower = (msg.subject or "").lower()
    if any(w in subject_lower for w in ["demo", "demo call", "product demo"]):
        meeting_type = "demo"
    elif any(w in subject_lower for w in ["discovery", "intro call", "first call"]):
        meeting_type = "discovery"
    elif any(w in subject_lower for w in ["poc", "pilot", "trial"]):
        meeting_type = "poc"
    elif any(w in subject_lower for w in ["qbr", "business review"]):
        meeting_type = "qbr"
    else:
        meeting_type = "discovery"

    title = msg.subject.strip() if msg.subject and msg.subject.strip() else "Meeting (from email)"
    meeting = Meeting(
        title=title[:200],
        deal_id=deal.id,
        company_id=deal.company_id,
        meeting_type=meeting_type,
        status="scheduled",
        external_source="personal_email_sync",
        external_source_id=thread_source_id,
        attendees=attendees or None,
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )
    session.add(meeting)
    await session.flush()
    logger.info(
        "personal_email_sync: auto-created meeting '%s' for deal %s (thread=%s)",
        title, deal.id, msg.thread_id,
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
    company_name_candidates: list[tuple[str, UUID, str]] = []
    for row in all_companies_result.all():
        d = _normalize_domain(row.domain)
        if d:
            company_domain_map[d] = (row.id, row.name)
        all_company_names.append(row.name)
        normalized_name = _normalize_name_key(row.name)
        if len(normalized_name) >= 4:
            company_name_candidates.append((normalized_name, row.id, row.name))
    company_name_candidates.sort(key=lambda item: len(item[0]), reverse=True)

    # Pre-load all contact emails for fast lookup
    all_contacts_result = await session.execute(
        select(Contact.id, Contact.email, Contact.first_name, Contact.last_name, Contact.company_id)
    )
    contact_email_map: dict[str, UUID] = {}
    contact_company_map: dict[UUID, UUID | None] = {}
    all_contact_names: list[str] = []
    for row in all_contacts_result.all():
        if row.email:
            contact_email_map[row.email.lower().strip()] = row.id
        contact_company_map[row.id] = row.company_id
        all_contact_names.append(f"{row.first_name} {row.last_name}")

    touched_deal_ids: set[UUID] = set()
    open_task_counts_before: dict[UUID, int] = {}
    thread_context_cache: dict[tuple[UUID, str], list[str]] = {}

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

        google_doc_contexts, updated_token = await fetch_google_doc_context(
            msg.body_text,
            token_data=connection.token_data,
            client_id=settings.gmail_client_id,
            client_secret=settings.gmail_client_secret,
        )
        if updated_token is not connection.token_data:
            connection.token_data = updated_token
        google_doc_transcript = "\n\n".join(context["text"] for context in google_doc_contexts if context.get("text")).strip()
        latest_message_text = "\n".join(
            part for part in [msg.subject or "", msg.body_text or "", google_doc_transcript] if part
        ).strip()

        # ── Pass 1: exact email address match → contact → deal ──────────────
        matched_contact_ids: list[UUID] = []
        matched_company_id: UUID | None = None
        for addr in all_addrs:
            cid = contact_email_map.get(addr)
            if cid:
                matched_contact_ids.append(cid)
                if not matched_company_id:
                    matched_company_id = contact_company_map.get(cid)

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
                    matched_company_id = company_id
                    # Find deals linked to this company
                    deal_result = await session.execute(
                        select(Deal.id, Deal.assigned_to_id, Deal.stage).where(
                            Deal.company_id == company_id
                        )
                    )
                    for row in deal_result.all():
                        if row.id not in deal_ids:
                            deal_ids.append(row.id)

        if not deal_ids and (msg.subject or msg.body_text):
            company_match = _match_company_from_text(
                f"{msg.subject}\n{msg.body_text}",
                company_name_candidates,
            )
            if company_match:
                matched_company_id, _ = company_match
                deal_result = await session.execute(
                    select(Deal.id).where(Deal.company_id == matched_company_id)
                )
                deal_ids = [row.id for row in deal_result.all()]

        # ── Pass 4: AI classification fallback ───────────────────────────────
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
                        matched_company_id = comp_row
                        deal_result = await session.execute(
                            select(Deal.id).where(Deal.company_id == comp_row)
                        )
                        deal_ids = [r.id for r in deal_result.all()]

        if not deal_ids:
            # No match found — still may need gap-fill (new contact from external domain)
            await _gap_fill_contacts(
                session, msg, all_addrs, connection, sync_user.id,
                company_domain_map, contact_email_map, stats,
                matched_company_id=matched_company_id,
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
            company_id: UUID | None = matched_company_id
            if not company_id and domain in company_domain_map:
                company_id = company_domain_map[domain][0]
            elif not company_id:
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

            if deal_id not in open_task_counts_before:
                open_task_counts_before[deal_id] = await _count_open_system_tasks(session, deal_id)

            thread_cache_key = (deal_id, msg.thread_id or msg.message_id)
            if thread_cache_key not in thread_context_cache:
                thread_context_cache[thread_cache_key] = await _load_existing_thread_segments(
                    session,
                    deal_id=deal_id,
                    thread_id=msg.thread_id or msg.message_id,
                )
            thread_segments = [*thread_context_cache[thread_cache_key], latest_message_text]
            thread_latest_intent = _detect_latest_intent(thread_segments)
            thread_context_excerpt = "\n\n".join(thread_segments[-4:])[:4000]

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
                    "intent_detected": thread_latest_intent,
                    "thread_latest_intent": thread_latest_intent,
                    "thread_latest_message_text": latest_message_text[:2500],
                    "thread_context_excerpt": thread_context_excerpt,
                    "google_doc_links": [context["url"] for context in google_doc_contexts] or None,
                    "google_doc_transcript": google_doc_transcript[:4000] or None,
                },
            )
            session.add(activity)
            stats["activities_created"] += 1
            touched_deal_ids.add(deal_id)
            thread_context_cache[thread_cache_key] = thread_segments

            if thread_latest_intent == "book_workshop_session":
                all_contact_ids = list({cid for cid in matched_contact_ids if cid})
                await _ensure_meeting_for_deal(session, deal, msg, all_contact_ids)

    await session.commit()
    for deal_id in touched_deal_ids:
        await refresh_system_tasks_for_entity(session, "deal", deal_id)
        tasks_after = await _count_open_system_tasks(session, deal_id)
        stats["tasks_created"] += max(0, tasks_after - open_task_counts_before.get(deal_id, 0))
    await session.commit()
    return stats


async def _gap_fill_contacts(
    session: AsyncSession,
    msg: EmailMessage,
    all_addrs: set[str],
    connection: UserEmailConnection,
    sync_user_id: UUID,
    company_domain_map: dict[str, tuple[UUID, str]],
    contact_email_map: dict[str, UUID],
    stats: dict,
    matched_company_id: UUID | None = None,
) -> None:
    """
    When no deal match is found, still capture new stakeholders by:
      1. attaching them to a company inferred from the conversation text
      2. attaching them to a known company by email domain
      3. auto-creating a stub company from a corporate domain
    """
    user_domain = _domain_from_email(connection.email_address)
    for addr in all_addrs:
        domain = _domain_from_email(addr)
        if not domain or domain == user_domain:
            continue

        contact_result = await session.execute(
            select(Contact.id).where(Contact.email == addr)
        )
        if contact_result.scalar_one_or_none():
            continue

        company_id = matched_company_id
        if not company_id and domain in company_domain_map:
            company_id = company_domain_map[domain][0]
        elif not company_id:
            company = await _get_or_create_company_by_domain(session, domain)
            if company:
                company_id = company.id
                company_domain_map[domain] = (company.id, company.name)
                stats["companies_created"] += 1

        if not company_id and domain in FREE_EMAIL_PROVIDERS:
            continue

        display_name = msg.from_name if addr == msg.from_addr else None
        contact = await _get_or_create_contact_by_email(
            session, addr, display_name, company_id, sync_user_id,
        )
        contact_email_map[addr] = contact.id
        stats["contacts_created"] += 1
