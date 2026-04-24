"""Zippy's tool catalog — the schemas we hand Claude + the local executors.

Keeping the tool-use contract centralized means the agent loop in
``zippy_agent.py`` stays small: it just feeds this catalog to Claude and
dispatches ``tool_use`` blocks to the ``execute_tool`` entry point here.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.services.knowledge_search import KnowledgeSnippet, search_knowledge
from app.services.zippy_docs import GeneratedDocument
from app.services.zippy_docs.generic import GenericDocInput
from app.services.zippy_docs.generic import generate as generate_generic
from app.services.zippy_docs.mom import MOMInput, MOMTemplateUnavailable
from app.services.zippy_docs.mom import generate as generate_mom
from app.services.zippy_docs.mom import inspect_mom_template
from app.services.zippy_docs.nda import NDAInput
from app.services.zippy_docs.nda import generate as generate_nda
from app.services.zippy_docs.nda import inspect_template as inspect_nda_template

logger = logging.getLogger(__name__)


# Anthropic tool-use schemas. Keep descriptions tight — they're Claude's only
# signal for when to call each tool.
TOOL_DEFINITIONS: list[dict[str, Any]] = [
    {
        "name": "search_knowledge_base",
        "description": (
            "Search the user's Google Drive + Beacon shared drive for snippets relevant "
            "to a question. Use whenever the user asks about a concept, prior client, "
            "playbook, number, or doc that might live in their files. Returns a list of "
            "snippets with source names and Drive links — always cite them in your answer."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query (natural language).",
                },
                "top_k": {
                    "type": "integer",
                    "description": "How many snippets to return. Default 6, max 12.",
                    "default": 6,
                },
                "source_ids": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Optional: restrict the search to specific Drive file IDs. "
                        "Useful when the user references '@file' in the UI."
                    ),
                },
            },
            "required": ["query"],
        },
    },
    {
        "name": "inspect_mom_template",
        "description": (
            "Open Beacon's official MOM template from Drive and return every "
            "{{TOKEN}} placeholder with a hint of what belongs there. "
            "ALWAYS call this FIRST before `generate_mom` so you know exactly "
            "which sections the template has. Do NOT search other docs."
        ),
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
        },
    },
    {
        "name": "generate_mom",
        "description": (
            "Fill Beacon's official MOM template with content structured from the "
            "user's transcript and produce a .docx file. ONLY call this after "
            "`inspect_mom_template`. Never add sections not in the template."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "client_name": {"type": "string"},
                "meeting_date": {
                    "type": "string",
                    "description": "Date as a human string, e.g. '19 April 2026'. Optional.",
                },
                "attendees": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "List of attendee names, optional.",
                },
                "transcript": {
                    "type": "string",
                    "description": "Meeting transcript if available.",
                },
                "context_notes": {
                    "type": "string",
                    "description": (
                        "Free-text notes from the user — agenda bullets, takeaways, "
                        "anything to include if no transcript is available."
                    ),
                },
            },
            "required": ["client_name"],
        },
    },
    {
        "name": "inspect_nda_template",
        "description": (
            "Open Beacon's official NDA template from Drive and return every "
            "blank (underscore/dash runs) in document order with a short "
            "surrounding-context snippet and a hint of what likely belongs "
            "there. ALWAYS call this FIRST before `generate_nda` so you can "
            "ask the user to fill each specific blank. Do not search other "
            "docs or invent clauses — use ONLY this template."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "jurisdiction": {
                    "type": "string",
                    "enum": ["india", "us", "singapore"],
                },
            },
            "required": ["jurisdiction"],
        },
    },
    {
        "name": "generate_nda",
        "description": (
            "Draft a Non-Disclosure Agreement by filling Beacon's official NDA "
            "template (stored in the workspace Drive folder) with the counterparty "
            "name and jurisdiction-specific details. The template itself is never "
            "rewritten — only placeholder tokens are replaced, so the output is "
            "byte-identical to Legal's template except for the filled fields. "
            "Only `jurisdiction` is REQUIRED (it picks which template to load). "
            "Every other field is OPTIONAL — pass ONLY the values the user "
            "explicitly supplied. Do NOT invent or default any value. Any field "
            "you omit will remain as a visible `{{TOKEN}}` in the output doc, "
            "so reviewers can see at a glance what still needs filling."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "jurisdiction": {
                    "type": "string",
                    "enum": ["india", "us", "singapore"],
                },
                "fills": {
                    "type": "object",
                    "description": (
                        "Mapping of blank-index (as returned by "
                        "`inspect_nda_template`) → the exact text the user "
                        "gave for that blank. Keys are the stringified index "
                        "numbers (e.g. \"1\", \"2\", \"3\"). Include ONLY "
                        "indices the user explicitly answered — skipped "
                        "blanks stay as-is in the output."
                    ),
                    "additionalProperties": {"type": "string"},
                },
                "disclosing_party": {
                    "type": "string",
                    "description": (
                        "Full legal name of the disclosing party. Pass only if "
                        "the user named it — no default."
                    ),
                },
                "receiving_party": {
                    "type": "string",
                    "description": (
                        "Full legal name of the counterparty. Pass only if the "
                        "user provided it — never invent a name."
                    ),
                },
                "effective_date": {
                    "type": "string",
                    "description": (
                        "Effective date as a human-readable string, e.g. "
                        "'21 April 2026'. Pass only if the user provided it."
                    ),
                },
                "term_years": {
                    "type": "integer",
                    "description": "Term in years. Pass only if the user provided it.",
                },
                "governing_city": {
                    "type": "string",
                    "description": (
                        "Governing-law / venue city, e.g. 'Mumbai'. Pass only "
                        "if the user provided it — no default."
                    ),
                },
                "purpose": {
                    "type": "string",
                    "description": "Purpose of the exchange. Pass only if the user provided it.",
                },
                "mutual": {
                    "type": "boolean",
                    "description": "True for mutual, False for one-way. Pass only if the user specified.",
                },
                "extra_clauses": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Additional clauses to append verbatim. Optional.",
                },
            },
            "required": ["jurisdiction"],
        },
    },
    {
        "name": "generate_document",
        "description": (
            "Create a free-form Word document from markdown content. Use for one-pagers, "
            "follow-up emails as docx, briefs, or any deliverable that isn't MOM/NDA."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "markdown": {
                    "type": "string",
                    "description": "Document body in light markdown (#, ##, ###, -, numbered).",
                },
                "client_name": {
                    "type": "string",
                    "description": "Optional client/prospect name for the subtitle.",
                },
            },
            "required": ["title", "markdown"],
        },
    },
]


@dataclass
class ToolOutcome:
    """What the agent loop uses to build the tool_result message + side effects."""

    result_text: str                       # what Claude sees
    citations: list[dict] = field(default_factory=list)
    artifacts: list[dict] = field(default_factory=list)
    is_error: bool = False


async def execute_tool(
    name: str,
    args: dict,
    *,
    session: AsyncSession,
    user_id: Optional[UUID],
) -> ToolOutcome:
    """Dispatch a single Claude tool call. Never raises — errors come back
    via ``ToolOutcome.is_error`` so the agent can relay them to Claude."""
    try:
        if name == "search_knowledge_base":
            return await _execute_search(args, user_id=user_id)
        if name == "inspect_mom_template":
            return await _execute_inspect_mom(user_id=user_id)
        if name == "generate_mom":
            return await _execute_mom(args, user_id=user_id)
        if name == "inspect_nda_template":
            return await _execute_inspect_nda(args)
        if name == "generate_nda":
            return await _execute_nda(args)
        if name == "generate_document":
            return await _execute_generic(args)
    except Exception as exc:
        logger.exception("Tool %s failed", name)
        return ToolOutcome(
            result_text=f"Tool '{name}' failed with error: {exc}",
            is_error=True,
        )

    return ToolOutcome(
        result_text=f"Unknown tool: {name}",
        is_error=True,
    )


# ── Individual executors ─────────────────────────────────────────────────────


async def _execute_search(args: dict, *, user_id: Optional[UUID]) -> ToolOutcome:
    query = (args.get("query") or "").strip()
    if not query:
        return ToolOutcome(
            result_text="No query was provided to search_knowledge_base.",
            is_error=True,
        )
    top_k = min(int(args.get("top_k") or 6), 12)
    source_ids = args.get("source_ids") or None

    snippets: list[KnowledgeSnippet] = await search_knowledge(
        query,
        user_id=user_id,
        include_admin=True,
        top_k=top_k,
        source_ids=source_ids,
    )

    if not snippets:
        return ToolOutcome(
            result_text=(
                "No matching content found in the user's Drive folder or the Beacon "
                "shared folder. Ask the user if they'd like to index more files or "
                "phrase the question differently."
            ),
        )

    # Format as a compact text block — Claude handles structured markdown well.
    lines = [f"Found {len(snippets)} snippet(s):", ""]
    citations: list[dict] = []
    for idx, snippet in enumerate(snippets, start=1):
        lines.append(f"[{idx}] {snippet.source_name} (score {snippet.score:.2f})")
        body = snippet.text.strip().replace("\n", " ")
        if len(body) > 600:
            body = body[:600].rstrip() + "…"
        lines.append(body)
        if snippet.drive_url:
            lines.append(f"Link: {snippet.drive_url}")
        lines.append("")
        citations.append(snippet.as_citation())
    return ToolOutcome(result_text="\n".join(lines), citations=citations)


def _doc_to_artifact(doc: GeneratedDocument) -> dict:
    return {
        "type": doc.kind,
        "filename": doc.filename,
        "url": doc.url,
        "summary": doc.summary,
        "created_at": doc.created_at.isoformat(),
    }


async def _execute_inspect_mom(*, user_id: Optional[UUID]) -> ToolOutcome:
    import json as _json
    result = await inspect_mom_template(user_id=user_id)
    return ToolOutcome(result_text=_json.dumps(result, ensure_ascii=False))


async def _execute_mom(args: dict, *, user_id: Optional[UUID]) -> ToolOutcome:
    data = MOMInput(
        client_name=args.get("client_name", "Client"),
        meeting_date=args.get("meeting_date"),
        attendees=args.get("attendees"),
        transcript=args.get("transcript"),
        context_notes=args.get("context_notes"),
    )
    try:
        doc = await generate_mom(data, user_id=user_id)
    except MOMTemplateUnavailable as exc:
        # Surface a clean error so the agent tells the user instead of
        # silently fabricating a MOM. No fallback — refusal is by design.
        return ToolOutcome(
            result_text=(
                f"Cannot generate MOM: {exc}. "
                "Ask the user to verify MOM Template.docx is in their indexed "
                "Drive folder and that the Drive OAuth account has access."
            ),
            is_error=True,
        )
    return ToolOutcome(
        result_text=(
            f"MOM generated → {doc.filename}. Download URL: {doc.url}. "
            f"Summary: {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_inspect_nda(args: dict) -> ToolOutcome:
    result = await inspect_nda_template(args["jurisdiction"])
    if not result.get("found"):
        return ToolOutcome(
            result_text=result.get("error") or "NDA template not available.",
            is_error=True,
        )
    blanks = result["blanks"]
    if not blanks:
        return ToolOutcome(
            result_text=(
                f"Template loaded but no blanks (___ / ——) were detected. "
                f"You can call `generate_nda` directly with no fills, or the "
                f"user can tell you what to change."
            ),
        )
    lines = [
        f"Template has {len(blanks)} blank(s). Ask the user to fill each by index:",
        "",
    ]
    for b in blanks:
        lines.append(f"[{b['index']}] {b['hint']}")
        lines.append(f"    context: {b['context']}")
    lines.append("")
    lines.append(
        "When calling `generate_nda`, pass `fills` as a dict {\"1\": \"…\", \"2\": \"…\"} "
        "for ONLY the blanks the user answered. Do NOT search other documents "
        "and do NOT invent values."
    )
    return ToolOutcome(result_text="\n".join(lines))


async def _execute_nda(args: dict) -> ToolOutcome:
    data = NDAInput(
        jurisdiction=args["jurisdiction"],
        fills={str(k): str(v) for k, v in (args.get("fills") or {}).items()},
        receiving_party=args.get("receiving_party"),
        disclosing_party=args.get("disclosing_party"),
        mutual=args.get("mutual"),
        purpose=args.get("purpose"),
        term_years=int(args["term_years"]) if args.get("term_years") is not None else None,
        effective_date=args.get("effective_date"),
        governing_city=args.get("governing_city"),
        extra_clauses=list(args.get("extra_clauses") or []),
    )
    doc = await generate_nda(data)
    return ToolOutcome(
        result_text=(
            f"NDA generated → {doc.filename}. Download URL: {doc.url}. "
            f"Summary: {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_generic(args: dict) -> ToolOutcome:
    data = GenericDocInput(
        title=args.get("title", "Draft"),
        markdown=args.get("markdown", ""),
        client_name=args.get("client_name"),
    )
    doc = await generate_generic(data)
    return ToolOutcome(
        result_text=(
            f"Document generated → {doc.filename}. Download URL: {doc.url}."
        ),
        artifacts=[_doc_to_artifact(doc)],
    )
