from __future__ import annotations

from datetime import datetime
from typing import Iterable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import DEAL_STAGES, Deal, DealContact
from app.models.task import Task
from app.models.user import User
from app.repositories.deal import DealRepository
from app.services.account_sourcing import append_company_activity_log

STAGE_INDEX = {stage: idx for idx, stage in enumerate(DEAL_STAGES)}


def _normalize(text: str | None) -> str:
    return (text or "").strip().lower()


def _contains_any(text: str, terms: Iterable[str]) -> bool:
    return any(term in text for term in terms)


async def _find_open_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
) -> Task | None:
    result = await session.execute(
        select(Task).where(
            Task.entity_type == entity_type,
            Task.entity_id == entity_id,
            Task.system_key == system_key,
            Task.task_type == "system",
            Task.status == "open",
        )
    )
    return result.scalar_one_or_none()


async def _upsert_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
    title: str,
    description: str,
    priority: str,
    source: str,
    recommended_action: str | None,
    action_payload: dict | None = None,
    assigned_role: str | None = None,
) -> Task:
    existing = await _find_open_system_task(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        system_key=system_key,
    )
    if existing:
        existing.title = title
        existing.description = description
        existing.priority = priority
        existing.source = source
        existing.recommended_action = recommended_action
        existing.action_payload = action_payload
        existing.assigned_role = assigned_role
        existing.updated_at = datetime.utcnow()
        session.add(existing)
        return existing

    task = Task(
        entity_type=entity_type,
        entity_id=entity_id,
        task_type="system",
        title=title,
        description=description,
        priority=priority,
        source=source,
        recommended_action=recommended_action,
        action_payload=action_payload,
        system_key=system_key,
        assigned_role=assigned_role,
    )
    session.add(task)
    return task


async def _resolve_system_task(
    session: AsyncSession,
    *,
    entity_type: str,
    entity_id: UUID,
    system_key: str,
    status: str = "completed",
) -> None:
    task = await _find_open_system_task(
        session,
        entity_type=entity_type,
        entity_id=entity_id,
        system_key=system_key,
    )
    if not task:
        return
    task.status = status
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    session.add(task)


def _stage_reached(current_stage: str | None, target_stage: str) -> bool:
    if not current_stage:
        return False
    return STAGE_INDEX.get(current_stage, -1) >= STAGE_INDEX.get(target_stage, 999)


async def _refresh_company_tasks(session: AsyncSession, entity_id: UUID) -> None:
    company = await session.get(Company, entity_id)
    if not company:
        return

    cache = company.enrichment_cache if isinstance(company.enrichment_cache, dict) else {}
    has_icp = isinstance(cache.get("icp_analysis"), dict)
    contacts = (
        await session.execute(select(Contact.id).where(Contact.company_id == company.id))
    ).scalars().all()

    if not company.enriched_at or company.domain.endswith(".unknown"):
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_re_enrich",
            title="Refresh company enrichment",
            description="This account still has missing or incomplete firmographic data. Re-run enrichment to update the account profile.",
            priority="high" if company.domain.endswith(".unknown") else "medium",
            source="system",
            recommended_action="re_enrich_company",
            action_payload={"company_id": str(company.id)},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_re_enrich")

    if not has_icp or not company.icp_score:
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_refresh_icp",
            title="Refresh ICP research",
            description="Beacon does not yet have a usable ICP decision layer for this account. Refresh research to update fit, timing, and messaging.",
            priority="medium",
            source="system",
            recommended_action="refresh_icp_research",
            action_payload={"company_id": str(company.id)},
            assigned_role="ae",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_refresh_icp")

    if not contacts:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_find_stakeholders", status="dismissed")
        await _upsert_system_task(
            session,
            entity_type="company",
            entity_id=company.id,
            system_key="company_upload_prospects",
            title="Upload prospects for this account",
            description="Company research is temporarily not sourcing contacts automatically. Upload a prospect CSV from Prospecting to attach the right stakeholders to this account.",
            priority="medium",
            source="system",
            recommended_action=None,
            action_payload={"company_id": str(company.id), "company_name": company.name, "next_step": "upload_prospect_csv"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_find_stakeholders", status="dismissed")
        await _resolve_system_task(session, entity_type="company", entity_id=company.id, system_key="company_upload_prospects")


async def _refresh_contact_tasks(session: AsyncSession, entity_id: UUID) -> None:
    contact = await session.get(Contact, entity_id)
    if not contact:
        return

    linked_deal = (
        await session.execute(select(DealContact.deal_id).where(DealContact.contact_id == contact.id))
    ).first()
    has_deal = bool(linked_deal)

    sequence_text = " ".join(
        part for part in [
            _normalize(contact.sequence_status),
            _normalize(contact.instantly_status),
            _normalize(contact.enrichment_data.get("tracking_stage") if isinstance(contact.enrichment_data, dict) else None),
        ]
        if part
    )

    if ("meeting_booked" in sequence_text or "meeting booked" in sequence_text) and not has_deal:
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_convert_to_deal",
            title="Convert meeting-booked prospect into a deal",
            description="This prospect has reached a meeting-booked state. Convert it into a deal so the team can track the opportunity in the deal board.",
            priority="high",
            source="instantly",
            recommended_action="convert_contact_to_deal",
            action_payload={"contact_id": str(contact.id), "stage": "demo_done"},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_convert_to_deal")

    if not contact.phone and bool(contact.email):
        await _upsert_system_task(
            session,
            entity_type="contact",
            entity_id=contact.id,
            system_key="contact_refresh_data",
            title="Refresh prospect contact data",
            description="This prospect is active but still missing a phone number. Re-enrich the record to try to pull fresh contact details.",
            priority="medium",
            source="system",
            recommended_action="re_enrich_contact",
            action_payload={"contact_id": str(contact.id)},
            assigned_role="sdr",
        )
    else:
        await _resolve_system_task(session, entity_type="contact", entity_id=contact.id, system_key="contact_refresh_data")


def _deal_signal_task(text: str, current_stage: str) -> tuple[str, str, str] | None:
    if not _stage_reached(current_stage, "poc_agreed") and (
        ("poc" in text or "proof of concept" in text or "pilot" in text)
        and _contains_any(text, ["agree", "agreed", "approved", "move forward", "green light", "aligned"])
    ):
        return (
            "poc_agreed",
            "Move deal to POC Agreed",
            "Buyer language indicates alignment on a POC or pilot. Move the deal forward to keep the board accurate.",
        )
    if not _stage_reached(current_stage, "msa_review") and _contains_any(
        text,
        ["msa", "master services agreement", "legal review", "redline", "procurement", "security review"],
    ):
        return (
            "msa_review",
            "Move deal to MSA Review",
            "Recent communication suggests legal, procurement, or paper-process work has started. Update the stage to MSA Review.",
        )
    if not _stage_reached(current_stage, "commercial_negotiation") and _contains_any(
        text,
        ["pricing", "proposal", "commercial terms", "quote", "budget review", "negotiat"],
    ):
        return (
            "commercial_negotiation",
            "Move deal to Commercial Negotiation",
            "The latest buyer signal looks commercial. Move the deal into negotiation so the pipeline reflects what the team is discussing.",
        )
    if not _stage_reached(current_stage, "workshop") and _contains_any(
        text,
        ["workshop", "discovery workshop", "working session"],
    ) and _contains_any(text, ["schedule", "agreed", "book", "set up"]):
        return (
            "workshop",
            "Move deal to Workshop",
            "The buyer is aligning on a workshop or working session. Move the deal so the next motion is visible.",
        )
    return None


async def _refresh_deal_tasks(session: AsyncSession, entity_id: UUID) -> None:
    deal = await session.get(Deal, entity_id)
    if not deal:
        return

    activity_rows = (
        await session.execute(
            select(Activity)
            .where(Activity.deal_id == deal.id, Activity.type == "email")
            .order_by(Activity.created_at.desc())
            .limit(20)
        )
    ).scalars().all()

    created_keys: set[str] = set()
    for activity in activity_rows:
        text = " ".join(
            filter(
                None,
                [
                    _normalize(activity.ai_summary),
                    _normalize(activity.content),
                    _normalize(activity.email_subject),
                ],
            )
        )
        if not text:
            continue
        suggestion = _deal_signal_task(text, deal.stage)
        if not suggestion:
            continue
        target_stage, title, description = suggestion
        system_key = f"deal_move_{target_stage}"
        if system_key in created_keys:
            continue
        created_keys.add(system_key)
        await _upsert_system_task(
            session,
            entity_type="deal",
            entity_id=deal.id,
            system_key=system_key,
            title=title,
            description=description,
            priority="high" if target_stage in {"poc_agreed", "msa_review"} else "medium",
            source="gmail_sync",
            recommended_action="move_deal_stage",
            action_payload={
                "deal_id": str(deal.id),
                "stage": target_stage,
                "activity_id": str(activity.id),
            },
            assigned_role="ae",
        )

    for candidate in ["poc_agreed", "commercial_negotiation", "msa_review", "workshop"]:
        system_key = f"deal_move_{candidate}"
        if _stage_reached(deal.stage, candidate) or system_key not in created_keys:
            await _resolve_system_task(session, entity_type="deal", entity_id=deal.id, system_key=system_key)


async def refresh_system_tasks_for_entity(session: AsyncSession, entity_type: str, entity_id: UUID) -> None:
    if entity_type == "company":
        await _refresh_company_tasks(session, entity_id)
    elif entity_type == "contact":
        await _refresh_contact_tasks(session, entity_id)
    elif entity_type == "deal":
        await _refresh_deal_tasks(session, entity_id)


async def apply_task_action(session: AsyncSession, task: Task, user: User) -> dict[str, str]:
    payload = task.action_payload if isinstance(task.action_payload, dict) else {}
    action = task.recommended_action

    if action == "move_deal_stage":
        deal_id = UUID(str(payload["deal_id"]))
        stage = str(payload["stage"])
        repo = DealRepository(session)
        deal = await repo.get_or_raise(deal_id)
        previous_stage = deal.stage
        await repo.update(
            deal,
            {
                "stage": stage,
                "stage_entered_at": datetime.utcnow(),
                "days_in_stage": 0,
                "updated_at": datetime.utcnow(),
            },
        )
        session.add(
            Activity(
                deal_id=deal_id,
                type="stage_change",
                source="system_task",
                content=f"Stage moved from {previous_stage} to {stage} from an accepted system task",
                created_by_id=user.id,
            )
        )
        return {"message": f"Deal moved to {stage}"}

    if action == "convert_contact_to_deal":
        contact_id = UUID(str(payload["contact_id"]))
        contact = await session.get(Contact, contact_id)
        if not contact:
            raise ValueError("Prospect no longer exists")
        company = await session.get(Company, contact.company_id) if contact.company_id else None
        company_name = company.name if company else "Account"
        deal = await DealRepository(session).create(
            {
                "name": f"{company_name} - {contact.first_name} {contact.last_name}".strip(),
                "pipeline_type": "deal",
                "stage": str(payload.get("stage") or "demo_done"),
                "company_id": contact.company_id,
                "assigned_to_id": contact.assigned_to_id,
                "tags": ["converted_from_task"],
                "next_step": "Review meeting context and advance the opportunity",
                "stage_entered_at": datetime.utcnow(),
            }
        )
        await DealRepository(session).add_contact(deal.id, contact.id, contact.persona_type or "champion")
        return {"message": "Prospect converted into a deal"}

    if action == "re_enrich_company":
        from app.tasks.enrichment import re_enrich_company_task

        company_id = str(payload["company_id"])
        re_enrich_company_task.delay(company_id)
        company = await session.get(Company, UUID(company_id))
        if company:
            append_company_activity_log(
                company,
                action="system_task_accepted",
                actor_name=user.name,
                actor_email=user.email,
                message="Accepted system task: refresh company enrichment",
                metadata={"task_id": str(task.id), "action": action},
            )
            company.updated_at = datetime.utcnow()
            session.add(company)
        return {"message": "Company enrichment queued"}

    if action == "refresh_icp_research":
        from app.tasks.enrichment import icp_research_single_task

        company_id = str(payload["company_id"])
        icp_research_single_task.delay(company_id)
        company = await session.get(Company, UUID(company_id))
        if company:
            append_company_activity_log(
                company,
                action="system_task_accepted",
                actor_name=user.name,
                actor_email=user.email,
                message="Accepted system task: refresh ICP research",
                metadata={"task_id": str(task.id), "action": action},
            )
            company.updated_at = datetime.utcnow()
            session.add(company)
        return {"message": "ICP research queued"}

    if action == "re_enrich_contact":
        from app.tasks.enrichment import re_enrich_contact_task

        contact_id = str(payload["contact_id"])
        re_enrich_contact_task.delay(contact_id)
        return {"message": "Prospect re-enrichment queued"}

    return {"message": "No automatic action configured"}
