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
from datetime import datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.claude import ClaudeClient
from app.config import settings
from app.models.activity import Activity
from app.models.contact import Contact
from app.models.deal import DEAL_STAGES, Deal, DealContact, MEDDPICC_FIELDS
from app.services.task_codes import CODE_TO_ACTION, LLM_CODES

logger = logging.getLogger(__name__)

CONFIDENCE_THRESHOLD = 0.7
MAX_ACTIVITIES_IN_BUNDLE = 12
MAX_ACTIVITY_TEXT = 600


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
) -> dict[str, Any]:
    qualification = deal.qualification if isinstance(deal.qualification, dict) else {}
    meddpicc = qualification.get("meddpicc") if isinstance(qualification.get("meddpicc"), dict) else {}
    meddpicc_snapshot = {field: int(meddpicc.get(field, 0) or 0) for field in MEDDPICC_FIELDS}

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
   identify_pain, champion, competition] and propose a new integer level
  (1=identified, 2=validated, 3=confirmed) plus the evidence text.
  Payload: {"field": "<field>", "target_score": <1|2|3>, "evidence": "<≤200 chars>"}
- T-CONTACT: a new named stakeholder appeared in the thread, OR an existing
  contact changed role/title. Payload: {"change_type": "add"|"update",
  "email": "<email>", "name": "<full name>", "title": "<title>",
  "persona_type": "<champion|buyer|evaluator|blocker|null>"}

Hard rules:
1. If nothing clearly fits, return {"proposals": []}. Silence is correct.
2. NEVER emit T-CRITICAL — rules handle that.
3. NEVER propose a stage that is not in allowed_stages.
4. NEVER propose T-MEDPICC with target_score ≤ the current score for that field.
5. NEVER propose T-CONTACT for an email that already exists in contacts
   unless the title/role has changed.
6. Every proposal MUST cite evidence_activity_id from recent_activities.
7. Confidence is 0.0-1.0. Be honest — proposals below 0.7 will be dropped.
8. Respond with ONLY a single JSON object, no prose."""


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

def _validate_proposal(
    raw: dict[str, Any],
    deal: Deal,
    contacts_by_email: dict[str, Contact],
    meddpicc_snapshot: dict[str, int],
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
        if target_score <= meddpicc_snapshot.get(field, 0):
            return None
        evidence = str(payload.get("evidence") or "").strip()[:200]
        if not evidence:
            return None
        payload = {"field": field, "target_score": target_score, "evidence": evidence}
        system_key = f"t_medpicc:{field}"

    elif code == "T-CONTACT":
        email = str(payload.get("email") or "").strip().lower()
        if not email or "@" not in email:
            return None
        change_type = str(payload.get("change_type") or "").strip().lower()
        if change_type not in {"add", "update"}:
            return None
        if change_type == "add" and email in contacts_by_email:
            return None
        if change_type == "update" and email not in contacts_by_email:
            return None
        payload = {
            "change_type": change_type,
            "email": email,
            "name": str(payload.get("name") or "").strip()[:120] or None,
            "title": str(payload.get("title") or "").strip()[:120] or None,
            "persona_type": (str(payload.get("persona_type") or "").strip().lower() or None),
        }
        system_key = f"t_contact:{email}"

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

    if not activities:
        return []

    bundle = _build_signal_bundle(deal, activities, contacts)
    contacts_by_email = {
        (c.email or "").lower(): c for c in contacts if c.email
    }
    meddpicc_snapshot = bundle["meddpicc"]

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
        validated = _validate_proposal(entry, deal, contacts_by_email, meddpicc_snapshot)
        if validated is None:
            continue
        if validated.system_key in seen_keys:
            continue
        seen_keys.add(validated.system_key)
        proposals.append(validated)

    return proposals


def action_for_code(code: str) -> str:
    return CODE_TO_ACTION[code]
