"""LLM-gated emitter for the 5 sales-AI task codes.

Hard constraints:
  * Output schema is locked to one of 5 codes (T-STAGE | T-AMOUNT | T-CLOSE
    | T-MEDPICC | T-CONTACT). T-CRITICAL is produced by critical_task_rules,
    not here.
  * Silence is the default. If the thread doesn't cleanly imply a change,
    the model returns {"proposals": []}.
  * Proposals are deduped via Task.system_key before persisting, so the
    same signal doesn't re-emit on every refresh.
  * When the Claude API key is missing, complete() returns None and we emit
    nothing. The CRM stays usable; only the deterministic T-CRITICAL band
    will fire in mock mode.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.claude import ClaudeClient
from app.config import settings
from app.models.activity import Activity
from app.models.contact import Contact
from app.models.deal import DEAL_STAGES, Deal, DealContact, MEDDPICC_FIELDS
from app.models.task import Task
from app.services.meddpicc_updates import (
    MEDDPICC_CHANGE_REASONS,
    detail_has_capture,
    detail_updated_at,
    get_meddpicc_detail,
    get_meddpicc_snapshot,
)
from app.services.task_codes import CODE_TO_ACTION, LLM_CODES

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7
MAX_ACTIVITIES_IN_BUNDLE = 12
MAX_ACTIVITY_TEXT = 600
MEDDPICC_DEDUPE_DAYS = 7


@dataclass(frozen=True)
class TaskProposal:
    code: str
    title: str
    description: str
    priority: str            # "high" | "medium" | "low"
    payload: dict[str, Any]
    system_key: str
    evidence_activity_id: str | None
    confidence: float


# ── Signal bundle (deterministic, cheap) ────────────────────────────────────

def _activity_snippet(activity: Activity) -> str:
    parts = [
        activity.email_subject or "",
        activity.ai_summary or "",
        activity.content or "",
    ]
    raw = " ".join(part for part in parts if part).strip()
    raw = re.sub(r"\s+", " ", raw)
    if len(raw) > MAX_ACTIVITY_TEXT:
        raw = raw[: MAX_ACTIVITY_TEXT - 1].rstrip() + "…"
    return raw


def _build_signal_bundle(
    deal: Deal,
    activities: list[Activity],
    contacts: list[Contact],
    recent_meddpicc_updates: dict[str, str],
) -> dict[str, Any]:
    qualification = deal.qualification if isinstance(deal.qualification, dict) else {}
    meddpicc_snapshot = get_meddpicc_snapshot(qualification)
    meddpicc_details = {
        field: {
            "summary": detail.get("summary"),
            "updated_at": detail.get("updated_at"),
            "contact": detail.get("contact"),
            "tags": detail.get("tags"),
            "entities": detail.get("entities"),
            "target_score": detail.get("target_score"),
        }
        for field in MEDDPICC_FIELDS
        if isinstance((detail := get_meddpicc_detail(qualification, field)), dict)
        and any(detail.get(key) for key in ("summary", "contact", "tags", "entities", "target_score", "updated_at"))
    }

    return {
        "deal": {
            "id": str(deal.id),
            "name": deal.name,
            "stage": deal.stage,
            "value": float(deal.value) if deal.value is not None else None,
            "close_date_est": deal.close_date_est.isoformat() if deal.close_date_est else None,
            "stage_entered_at": deal.stage_entered_at.isoformat() if deal.stage_entered_at else None,
            "days_in_stage": deal.days_in_stage,
            "health_score": deal.health_score,
        },
        "allowed_stages": list(DEAL_STAGES),
        "meddpicc": meddpicc_snapshot,
        "meddpicc_scale": {
            "0": "not_started",
            "1": "identified",
            "2": "validated",
            "3": "confirmed",
        },
        "meddpicc_details": meddpicc_details,
        "meddpicc_recently_updated_fields": recent_meddpicc_updates,
        "contacts": [
            {
                "id": str(c.id),
                "email": (c.email or "").lower(),
                "name": f"{c.first_name or ''} {c.last_name or ''}".strip(),
                "title": c.title,
                "persona_type": c.persona_type,
            }
            for c in contacts if c.id
        ],
        "recent_activities": [
            {
                "id": str(a.id) if a.id else None,
                "type": a.type,
                "source": a.source,
                "from": (a.email_from or "").lower() or None,
                "at": a.created_at.isoformat() if a.created_at else None,
                "text": _activity_snippet(a),
            }
            for a in activities[:MAX_ACTIVITIES_IN_BUNDLE]
            if _activity_snippet(a)
        ],
    }


# ── Prompt ──────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are Beacon's sales-hygiene AI. Your job is NOT to tell reps to 'follow up'.
Your job is to keep the CRM accurate by proposing record-level updates.

You may only emit tasks with one of these five codes — NEVER invent new codes:

- T-STAGE: the conversation proves the deal has materially moved (forward or
  backward) to a specific new stage. Payload: {"target_stage": "<one of allowed_stages>"}
- T-AMOUNT: a concrete number has been discussed/agreed (proposal sent,
  discount given, scope change). Payload: {"new_value": <number>, "currency": "USD"}
- T-CLOSE: the prospect named or implied a new timeline (e.g. "after board
  meeting on the 12th"). Payload: {"new_close_date": "YYYY-MM-DD"}
- T-MEDPICC: a new MEDDPICC datapoint surfaced. You must pick ONE field from
  [metrics, economic_buyer, decision_criteria, decision_process, paper_process,
   identify_pain, champion, competition] and propose the best new level
  (1=identified, 2=validated, 3=confirmed) plus a structured field update.
  Payload: {"field": "<field>", "target_score": <1|2|3>, "summary": "<≤240 chars>",
  "evidence": "<≤200 chars>", "change_reason": "empty_field"|"material_refinement"|"contradiction",
  "contact": {"name": "...", "email": "...", "title": "...", "persona_type": "..."} | null,
  "tags": ["..."], "entities": ["..."]}
- T-CONTACT: a new named stakeholder appeared in the thread, OR an existing
  contact changed role/title. Payload: {"change_type": "add"|"update",
  "email": "<email or null>", "name": "<full name>", "title": "<title>",
  "persona_type": "<champion|buyer|evaluator|blocker|null>"}

MEDDPICC signal map:
- metrics: capture quoted business numbers like team size, hours lost, tickets/month, churn, cost.
- economic_buyer: capture the approver or senior executive who must sign off.
- decision_criteria: capture explicit evaluation criteria, security asks, integrations, or time-to-value.
- paper_process: capture procurement, legal, MSA, security review, vendor onboarding, SOC2 questionnaire.
- identify_pain: capture the explicit pain and tag the pain theme in tags.
- champion: capture the person actively selling internally, forwarding, introducing, or scheduling for us.
- competition: capture named competitors or build-vs-buy/status-quo pressure; use tags like direct_competitor,
  build_vs_buy, or status_quo and put named vendors in entities.

Hard rules:
1. If nothing clearly fits, return {"proposals": []}. Silence is correct.
2. NEVER emit T-CRITICAL — rules handle that.
3. NEVER propose a stage that is not in allowed_stages.
4. Only propose T-MEDPICC when the field is empty, OR the new information clearly contradicts or materially refines the current field detail.
5. If meddpicc_recently_updated_fields contains this field, DO NOT re-propose it.
6. For metrics, do not propose unless the metric was missing or the new number contradicts/refines the stored metric.
7. For economic_buyer or champion, include contact whenever a specific person is named, even if no email is available.
8. NEVER propose T-CONTACT for an email that already exists in contacts unless the title/role has changed.
9. Every proposal MUST cite evidence_activity_id from recent_activities.
10. Confidence is 0.0-1.0. Be honest — proposals below 0.7 will be dropped.
11. Respond with ONLY a single JSON object, no prose."""


USER_PROMPT_TEMPLATE = """Deal bundle:
{bundle_json}

Return JSON shaped exactly as:
{{
  "proposals": [
    {{
      "code": "T-STAGE" | "T-AMOUNT" | "T-CLOSE" | "T-MEDPICC" | "T-CONTACT",
      "title": "<short imperative — e.g. 'Move deal to POC Done'>",
      "description": "<1-2 sentences, why + evidence>",
      "priority": "high" | "medium" | "low",
      "payload": {{ ...code-specific shape... }},
      "evidence_activity_id": "<id from recent_activities>",
      "confidence": 0.0-1.0
    }}
  ]
}}"""


def _extract_json(raw: str | None) -> dict[str, Any] | None:
    if not raw:
        return None
    raw = raw.strip()
    start = raw.find("{")
    end = raw.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        parsed = json.loads(raw[start : end + 1])
    except Exception:
        return None
    return parsed if isinstance(parsed, dict) else None


# ── Validation (belt-and-braces; don't trust the model) ─────────────────────

def _normalized_contact_name(contact: Contact) -> str:
    return " ".join(part.strip().lower() for part in [contact.first_name or "", contact.last_name or ""] if part.strip())


def _normalized_name(value: str | None) -> str:
    return " ".join(part for part in re.sub(r"\s+", " ", value or "").strip().lower().split(" ") if part)


def _meddpicc_recently_updated_at(task: Task) -> datetime | None:
    for candidate in (task.completed_at, task.accepted_at, task.updated_at, task.created_at):
        if candidate is not None:
            return candidate
    return None


def _validate_meddpicc_contact(payload: dict[str, Any], field: str) -> dict[str, Any] | None:
    raw_contact = payload.get("contact")
    if not isinstance(raw_contact, dict):
        return None
    name = str(raw_contact.get("name") or "").strip()[:120] or None
    email = str(raw_contact.get("email") or "").strip().lower()[:254] or None
    title = str(raw_contact.get("title") or "").strip()[:120] or None
    persona_type = str(raw_contact.get("persona_type") or "").strip().lower() or None
    if email and "@" not in email:
        email = None
    if persona_type not in {"champion", "buyer", "evaluator", "blocker", ""}:
        persona_type = None
    if not persona_type and field == "economic_buyer":
        persona_type = "buyer"
    if not persona_type and field == "champion":
        persona_type = "champion"
    if not any([name, email, title, persona_type]):
        return None
    return {
        "name": name,
        "email": email,
        "title": title,
        "persona_type": persona_type,
    }


def _validate_string_list(value: Any, *, max_items: int = 6, max_len: int = 80) -> list[str]:
    if not isinstance(value, list):
        return []
    normalized: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            continue
        cleaned = item.strip()[:max_len]
        if not cleaned:
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        normalized.append(cleaned)
        if len(normalized) >= max_items:
            break
    return normalized


def _derive_contact_proposal_from_meddpicc(
    proposal: TaskProposal,
    contacts_by_email: dict[str, Contact],
    contacts_by_name: dict[str, Contact],
) -> TaskProposal | None:
    contact = proposal.payload.get("contact")
    if proposal.code != "T-MEDPICC" or not isinstance(contact, dict):
        return None

    field = str(proposal.payload.get("field") or "")
    if field not in {"economic_buyer", "champion"}:
        return None

    name = str(contact.get("name") or "").strip()
    email = str(contact.get("email") or "").strip().lower()
    title = str(contact.get("title") or "").strip() or None
    persona_type = str(contact.get("persona_type") or "").strip().lower() or None

    if email:
        existing = contacts_by_email.get(email)
        if existing is None:
            return TaskProposal(
                code="T-CONTACT",
                title=f"Add {name or email} as {field.replace('_', ' ')}",
                description=f"The latest buyer signal identified {name or email} as the deal's {field.replace('_', ' ')}.",
                priority=proposal.priority,
                payload={
                    "change_type": "add",
                    "email": email,
                    "name": name or None,
                    "title": title,
                    "persona_type": persona_type,
                },
                system_key=f"t_contact:{email}",
                evidence_activity_id=proposal.evidence_activity_id,
                confidence=proposal.confidence,
            )
        needs_update = bool(
            (persona_type and persona_type != (existing.persona_type or "").strip().lower())
            or (title and title != (existing.title or "").strip())
        )
        if not needs_update:
            return None
        return TaskProposal(
            code="T-CONTACT",
            title=f"Update {name or email} on the stakeholder map",
            description=f"The latest buyer signal sharpened {name or email}'s role on this deal.",
            priority=proposal.priority,
            payload={
                "change_type": "update",
                "email": email,
                "name": name or None,
                "title": title,
                "persona_type": persona_type,
            },
            system_key=f"t_contact:{email}",
            evidence_activity_id=proposal.evidence_activity_id,
            confidence=proposal.confidence,
        )

    if not name:
        return None
    existing = contacts_by_name.get(_normalized_name(name))
    if existing is not None:
        return None

    normalized_name = _normalized_name(name).replace(" ", "_")
    return TaskProposal(
        code="T-CONTACT",
        title=f"Add {name} as {field.replace('_', ' ')}",
        description=f"The latest buyer signal identified {name} as the deal's {field.replace('_', ' ')}.",
        priority=proposal.priority,
        payload={
            "change_type": "add",
            "email": None,
            "name": name,
            "title": title,
            "persona_type": persona_type,
        },
        system_key=f"t_contact_name:{normalized_name}",
        evidence_activity_id=proposal.evidence_activity_id,
        confidence=proposal.confidence,
    )


def _validate_proposal(
    raw: dict[str, Any],
    deal: Deal,
    contacts_by_email: dict[str, Contact],
    contacts_by_name: dict[str, Contact],
    meddpicc_snapshot: dict[str, int],
    meddpicc_details: dict[str, dict[str, Any]],
    recent_meddpicc_updates: dict[str, datetime],
) -> TaskProposal | None:
    code = str(raw.get("code") or "").strip().upper()
    if code not in LLM_CODES:
        return None

    confidence = float(raw.get("confidence") or 0)
    if confidence < CONFIDENCE_THRESHOLD:
        return None

    title = str(raw.get("title") or "").strip()[:180]
    description = str(raw.get("description") or "").strip()[:800]
    priority = str(raw.get("priority") or "medium").lower()
    if priority not in {"high", "medium", "low"}:
        priority = "medium"
    payload = raw.get("payload") if isinstance(raw.get("payload"), dict) else {}
    evidence_id = raw.get("evidence_activity_id")
    evidence_id = str(evidence_id) if evidence_id else None

    if not title or not description or not evidence_id:
        return None

    # Code-specific payload validation — reject silently on malformed shapes.
    if code == "T-STAGE":
        target = str(payload.get("target_stage") or "").strip()
        if target not in DEAL_STAGES or target == deal.stage:
            return None
        payload = {"target_stage": target}
        system_key = "t_stage"

    elif code == "T-AMOUNT":
        try:
            new_value = float(payload.get("new_value"))
        except (TypeError, ValueError):
            return None
        if new_value <= 0 or new_value > 1_000_000_000:
            return None
        # Skip if the proposed value equals the current one.
        current = float(deal.value) if deal.value is not None else None
        if current is not None and abs(new_value - current) < 1:
            return None
        payload = {"new_value": new_value, "currency": str(payload.get("currency") or "USD")}
        system_key = "t_amount"

    elif code == "T-CLOSE":
        raw_date = str(payload.get("new_close_date") or "").strip()
        try:
            parsed_date = datetime.strptime(raw_date, "%Y-%m-%d").date()
        except ValueError:
            return None
        if deal.close_date_est and parsed_date == deal.close_date_est:
            return None
        payload = {"new_close_date": parsed_date.isoformat()}
        system_key = "t_close"

    elif code == "T-MEDPICC":
        field = str(payload.get("field") or "").strip().lower()
        if field not in MEDDPICC_FIELDS:
            return None
        try:
            target_score = int(payload.get("target_score"))
        except (TypeError, ValueError):
            return None
        if target_score not in {1, 2, 3}:
            return None
        if field in recent_meddpicc_updates:
            return None
        current_score = meddpicc_snapshot.get(field, 0)
        current_detail = meddpicc_details.get(field) if isinstance(meddpicc_details.get(field), dict) else {}
        current_has_capture = detail_has_capture(current_detail)
        current_summary = str(current_detail.get("summary") or "").strip().lower()
        change_reason = str(payload.get("change_reason") or "").strip().lower()
        if change_reason not in MEDDPICC_CHANGE_REASONS:
            return None
        summary = str(payload.get("summary") or "").strip()[:240]
        evidence = str(payload.get("evidence") or "").strip()[:200]
        if not summary or not evidence:
            return None
        contact = _validate_meddpicc_contact(payload, field)
        tags = _validate_string_list(payload.get("tags"), max_items=8, max_len=48)
        entities = _validate_string_list(payload.get("entities"), max_items=5, max_len=80)
        current_contact = current_detail.get("contact") if isinstance(current_detail.get("contact"), dict) else {}
        current_tags = {
            str(tag).strip().lower()
            for tag in (current_detail.get("tags") or [])
            if isinstance(tag, str) and str(tag).strip()
        }
        current_entities = {
            str(entity).strip().lower()
            for entity in (current_detail.get("entities") or [])
            if isinstance(entity, str) and str(entity).strip()
        }
        if (
            current_summary
            and current_summary == summary.lower()
            and str(current_contact.get("name") or "").strip().lower() == str((contact or {}).get("name") or "").strip().lower()
            and str(current_contact.get("email") or "").strip().lower() == str((contact or {}).get("email") or "").strip().lower()
            and current_tags == {tag.lower() for tag in tags}
            and current_entities == {entity.lower() for entity in entities}
        ):
            return None
        if change_reason == "empty_field":
            if current_score > 0 or current_has_capture:
                return None
        else:
            if current_score == 0 and not current_has_capture:
                return None
        if change_reason == "material_refinement" and target_score < current_score:
            return None
        if change_reason != "contradiction" and target_score < current_score:
            return None
        if change_reason == "material_refinement" and target_score == current_score and not current_summary:
            # Allow first structured write for a field that already has a level.
            pass
        elif change_reason != "contradiction" and target_score == current_score and current_summary:
            # Same maturity is fine only when the value gets materially better.
            pass
        payload = {
            "field": field,
            "target_score": target_score,
            "summary": summary,
            "evidence": evidence,
            "change_reason": change_reason,
            "contact": contact,
            "tags": tags,
            "entities": entities,
        }
        system_key = f"t_medpicc:{field}"

    elif code == "T-CONTACT":
        email = str(payload.get("email") or "").strip().lower()
        name = str(payload.get("name") or "").strip()[:120] or None
        if not email or "@" not in email:
            email = None
        change_type = str(payload.get("change_type") or "").strip().lower()
        if change_type not in {"add", "update"}:
            return None
        if change_type == "add" and not email and not name:
            return None
        if change_type == "add" and email and email in contacts_by_email:
            return None
        if change_type == "add" and not email and name and _normalized_name(name) in contacts_by_name:
            return None
        if change_type == "update" and (not email or email not in contacts_by_email):
            return None
        payload = {
            "change_type": change_type,
            "email": email,
            "name": name,
            "title": str(payload.get("title") or "").strip()[:120] or None,
            "persona_type": (str(payload.get("persona_type") or "").strip().lower() or None),
        }
        if email:
            system_key = f"t_contact:{email}"
        else:
            system_key = f"t_contact_name:{_normalized_name(name)}"

    else:
        return None

    return TaskProposal(
        code=code,
        title=title,
        description=description,
        priority=priority,
        payload=payload,
        system_key=system_key,
        evidence_activity_id=evidence_id,
        confidence=confidence,
    )


# ── Entry point ─────────────────────────────────────────────────────────────

async def emit_ai_tasks(
    session: AsyncSession,
    deal: Deal,
) -> list[TaskProposal]:
    if not settings.ENABLE_AI_TASK_EMITTER:
        return []

    # Gather signal inputs (cheap DB reads; same shape used by critical rules).
    activities = (
        await session.execute(
            select(Activity)
            .where(Activity.deal_id == deal.id)
            .order_by(Activity.created_at.desc())
            .limit(25)
        )
    ).scalars().all()
    contacts = (
        await session.execute(
            select(Contact)
            .join(DealContact, DealContact.contact_id == Contact.id)
            .where(DealContact.deal_id == deal.id)
        )
    ).scalars().all()
    recent_meddpicc_tasks = (
        await session.execute(
            select(Task)
            .where(
                Task.entity_type == "deal",
                Task.entity_id == deal.id,
                Task.system_key.like("t_medpicc:%"),
                Task.status.in_(["open", "completed"]),
                Task.updated_at >= datetime.utcnow() - timedelta(days=MEDDPICC_DEDUPE_DAYS),
            )
        )
    ).scalars().all()

    if not activities:
        return []

    now = datetime.utcnow()
    recent_meddpicc_updates: dict[str, datetime] = {}
    for field in MEDDPICC_FIELDS:
        detail = get_meddpicc_detail(deal.qualification, field)
        detail_updated = detail_updated_at(detail)
        if detail_updated is not None and detail_updated >= now - timedelta(days=MEDDPICC_DEDUPE_DAYS):
            recent_meddpicc_updates[field] = detail_updated
    for task in recent_meddpicc_tasks:
        field = (task.system_key or "").split(":", 1)[1] if ":" in (task.system_key or "") else ""
        if field not in MEDDPICC_FIELDS:
            continue
        task_updated_at = _meddpicc_recently_updated_at(task)
        if task_updated_at is None:
            continue
        if task_updated_at < now - timedelta(days=MEDDPICC_DEDUPE_DAYS):
            continue
        existing = recent_meddpicc_updates.get(field)
        if existing is None or task_updated_at > existing:
            recent_meddpicc_updates[field] = task_updated_at

    bundle = _build_signal_bundle(
        deal,
        activities,
        contacts,
        {field: updated.isoformat() for field, updated in recent_meddpicc_updates.items()},
    )
    contacts_by_email = {
        (c.email or "").lower(): c for c in contacts if c.email
    }
    contacts_by_name = {
        _normalized_contact_name(c): c
        for c in contacts
        if _normalized_contact_name(c)
    }
    meddpicc_snapshot = bundle["meddpicc"]
    meddpicc_details = {
        field: get_meddpicc_detail(deal.qualification, field)
        for field in MEDDPICC_FIELDS
    }

    client = ClaudeClient()
    if client.mock:
        return []

    try:
        bundle_json = json.dumps(bundle, default=str)
    except Exception as exc:
        logger.warning("ai_task_emitter: failed to serialize bundle: %s", exc)
        return []

    response = await client.complete(
        system=SYSTEM_PROMPT,
        user=USER_PROMPT_TEMPLATE.format(bundle_json=bundle_json),
        max_tokens=800,
    )

    parsed = _extract_json(response)
    if not parsed:
        return []

    raw_proposals = parsed.get("proposals")
    if not isinstance(raw_proposals, list):
        return []

    proposals: list[TaskProposal] = []
    seen_keys: set[str] = set()
    for entry in raw_proposals:
        if not isinstance(entry, dict):
            continue
        validated = _validate_proposal(
            entry,
            deal,
            contacts_by_email,
            contacts_by_name,
            meddpicc_snapshot,
            meddpicc_details,
            recent_meddpicc_updates,
        )
        if validated is None:
            continue
        if validated.system_key in seen_keys:
            continue
        seen_keys.add(validated.system_key)
        proposals.append(validated)
        derived_contact = _derive_contact_proposal_from_meddpicc(validated, contacts_by_email, contacts_by_name)
        if derived_contact is not None and derived_contact.system_key not in seen_keys:
            seen_keys.add(derived_contact.system_key)
            proposals.append(derived_contact)

    return proposals


def action_for_code(code: str) -> str:
    return CODE_TO_ACTION[code]
