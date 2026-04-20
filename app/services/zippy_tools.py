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
from app.services.zippy_docs.mom import MOMInput
from app.services.zippy_docs.mom import generate as generate_mom
from app.services.zippy_docs.nda import NDAInput
from app.services.zippy_docs.nda import generate as generate_nda

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
        "name": "generate_mom",
        "description": (
            "Draft a Minutes of Meeting Word document for a client call. Use when the "
            "user asks for a MOM, call notes, meeting recap, or follow-up document."
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
        "name": "generate_nda",
        "description": (
            "Draft a Non-Disclosure Agreement in Word format. Supports India, US "
            "(Delaware default), and Singapore jurisdictions. Marks the doc as a "
            "template — not legal advice."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "jurisdiction": {
                    "type": "string",
                    "enum": ["india", "us", "singapore"],
                },
                "disclosing_party": {
                    "type": "string",
                    "description": "Full legal name of the disclosing party (usually Beacon).",
                },
                "receiving_party": {
                    "type": "string",
                    "description": "Full legal name of the receiving party (counterparty).",
                },
                "mutual": {
                    "type": "boolean",
                    "description": "True for a mutual NDA (default), False for one-way.",
                    "default": True,
                },
                "purpose": {
                    "type": "string",
                    "description": "Purpose of the information exchange. Optional.",
                },
                "term_years": {
                    "type": "integer",
                    "description": "Term of the NDA in years. Default 2.",
                    "default": 2,
                },
                "governing_city": {
                    "type": "string",
                    "description": (
                        "Governing-law / venue city. Defaults are Mumbai (IN), "
                        "Wilmington DE (US), Singapore (SG)."
                    ),
                },
                "extra_clauses": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Additional clauses to append verbatim. Optional.",
                },
            },
            "required": ["jurisdiction", "disclosing_party", "receiving_party"],
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
        if name == "generate_mom":
            return await _execute_mom(args)
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


async def _execute_mom(args: dict) -> ToolOutcome:
    data = MOMInput(
        client_name=args.get("client_name", "Client"),
        meeting_date=args.get("meeting_date"),
        attendees=args.get("attendees"),
        transcript=args.get("transcript"),
        context_notes=args.get("context_notes"),
    )
    doc = await generate_mom(data)
    return ToolOutcome(
        result_text=(
            f"MOM generated → {doc.filename}. Download URL: {doc.url}. "
            f"Summary: {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_nda(args: dict) -> ToolOutcome:
    data = NDAInput(
        jurisdiction=args["jurisdiction"],
        disclosing_party=args["disclosing_party"],
        receiving_party=args["receiving_party"],
        mutual=bool(args.get("mutual", True)),
        purpose=args.get("purpose") or NDAInput.__dataclass_fields__["purpose"].default,
        term_years=int(args.get("term_years") or 2),
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
