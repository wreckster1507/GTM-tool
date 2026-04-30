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
            "Open Beacon's official MOM template from Drive and report how "
            "many rewritable content sections it contains. ALWAYS call this "
            "FIRST before `generate_mom` to confirm the template is reachable. "
            "Do NOT search other docs for MOM content."
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
            "Rewrite Beacon's official MOM template in place using the user's "
            "transcript and produce a .docx file. The tool extracts every "
            "paragraph from the template and has Claude rewrite the non-"
            "structural content — there are no placeholders to fill. ONLY call "
            "this after `inspect_mom_template`. Never add sections not in the "
            "template."
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
                "format_type": {
                    "type": "string",
                    "enum": ["long", "short"],
                    "description": (
                        "'long' = detailed MOM with all sub-sections (default). "
                        "'short' = key highlights only, concise."
                    ),
                },
                "collateral": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": (
                        "Collateral items to include, each as "
                        "'Label : Name | url'. You determine these from the "
                        "collateral selection rules in your system prompt."
                    ),
                },
            },
            "required": ["client_name"],
        },
    },
    {
        "name": "inspect_nda_template",
        "description": (
            "Open Beacon's official NDA template for the given jurisdiction "
            "and report how many rewritable content sections it contains. "
            "ALWAYS call this FIRST before `generate_nda` to confirm the "
            "template is reachable. Do not search other docs or invent "
            "clauses — use ONLY this template."
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
            "Draft a Non-Disclosure Agreement by rewriting Beacon's official NDA "
            "template (stored in the workspace Drive folder) with the "
            "counterparty name and jurisdiction-specific details. The template "
            "is rewritten in place — structural headings are preserved, "
            "content blocks are rewritten from the user's inputs. "
            "Only `jurisdiction` is REQUIRED (it picks which template to load). "
            "Every other field is OPTIONAL — pass ONLY the values the user "
            "explicitly supplied. Do NOT invent or default any value. Missing "
            "fields are left blank by the rewriter so reviewers can see what "
            "still needs filling."
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
                        "Free-form dict of extra details to pass to the "
                        "rewriter (e.g. registered office, PAN, authorised "
                        "signatory). The rewriter will use these verbatim "
                        "where appropriate. Optional."
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
        "name": "inspect_roi_template",
        "description": (
            "Check that the Beacon ROI Excel template is available in Drive "
            "and return the list of survey questions it expects. Call FIRST "
            "before generate_roi."
        ),
        "input_schema": {"type": "object", "properties": {}, "required": []},
    },
    {
        "name": "generate_roi",
        "description": (
            "Fill the Beacon ROI Analysis template with client survey "
            "response data and produce a live Google Sheet. The tool fills "
            "the Survey Input and Inputs sheets — all ROI calculations are "
            "formula-driven and auto-update when the Sheet is opened. Call "
            "after collecting Q2-Q14 answers from the AE."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "client_name": {"type": "string"},
                "prepared_by": {"type": "string", "description": "AE name"},
                "report_date": {
                    "type": "string",
                    "description": "e.g. 'April 2026'",
                },
                "q1_reason": {"type": "string"},
                "q2_impls_per_year": {
                    "type": "string",
                    "description": (
                        "Raw answer e.g. '700 total, 400 full module'"
                    ),
                },
                "q3_team_size": {"type": "string", "description": "e.g. '24'"},
                "q4_ftes_per_impl": {"type": "string", "description": "e.g. '3'"},
                "q5_duration_range": {"type": "string"},
                "q6_inception_weeks": {
                    "type": "string",
                    "description": "e.g. '1-4 weeks'",
                },
                "q7_solutioning_weeks": {"type": "string"},
                "q8_config_weeks": {"type": "string"},
                "q9_data_migration_weeks": {"type": "string"},
                "q10_testing_weeks": {"type": "string"},
                "q11_cutover_weeks": {"type": "string"},
                "q12_fte_cost_usd": {
                    "type": "string",
                    "description": "e.g. '$40,000'",
                },
                "q13_ramp_up": {"type": "string"},
                "q14_new_headcount": {
                    "type": "string",
                    "description": "e.g. 'Net 0' or '+3'",
                },
            },
            "required": ["client_name"],
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
            return await _execute_inspect_nda(args, user_id=user_id)
        if name == "generate_nda":
            return await _execute_nda(args, user_id=user_id)
        if name == "inspect_roi_template":
            return await _execute_inspect_roi(user_id=user_id)
        if name == "generate_roi":
            return await _execute_roi(args, user_id=user_id)
        if name == "generate_document":
            return await _execute_generic(args, user_id=user_id)
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
    artifact = {
        "type": doc.kind,
        "filename": doc.filename,
        "url": doc.url,
        "summary": doc.summary,
        "created_at": doc.created_at.isoformat(),
    }
    if doc.drive_url:
        artifact["drive_url"] = doc.drive_url
        artifact["drive_file_id"] = doc.drive_file_id
    return artifact


def _doc_link_text(doc: GeneratedDocument) -> str:
    """Return the best available link for the user — Google Docs if uploaded, else local download.

    When a Google Doc exists we present it as the canonical artifact. Editing
    happens in the browser, changes autosave in Drive, so the user never has
    to download-edit-reupload. The raw .docx download is only surfaced as a
    fallback when Drive upload failed.
    """
    if doc.drive_url:
        return f"Edit in Google Docs: {doc.drive_url}"
    return f"Download .docx: {doc.url}"


async def _execute_inspect_mom(*, user_id: Optional[UUID]) -> ToolOutcome:
    result = await inspect_mom_template(user_id=user_id)
    if not result.get("found"):
        return ToolOutcome(
            result_text=(
                f"MOM template not available: {result.get('error', 'unknown error')}. "
                "You can still call `generate_mom` — it will produce a fallback draft."
            ),
        )
    return ToolOutcome(
        result_text=(
            f"Template found: {result['template_name']}. "
            f"Has {result['section_count']} content sections. "
            "Ready to generate MOM once transcript is provided."
        ),
    )


async def _execute_mom(args: dict, *, user_id: Optional[UUID]) -> ToolOutcome:
    data = MOMInput(
        client_name=args.get("client_name", "Client"),
        meeting_date=args.get("meeting_date"),
        attendees=args.get("attendees"),
        transcript=args.get("transcript"),
        context_notes=args.get("context_notes"),
        format_type=args.get("format_type", "long"),
        collateral=args.get("collateral") or [],
    )
    try:
        doc = await generate_mom(data, user_id=user_id)
    except MOMTemplateUnavailable as exc:
        # Kept for back-compat — the new generator falls back internally and
        # shouldn't raise this, but some callers may still import the class.
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
            f"MOM generated as an editable Google Doc. {_doc_link_text(doc)}. "
            f"Summary: {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_inspect_nda(args: dict, *, user_id: Optional[UUID] = None) -> ToolOutcome:
    result = await inspect_nda_template(
        args["jurisdiction"],
        user_id=str(user_id) if user_id else None,
    )
    if not result.get("found"):
        return ToolOutcome(
            result_text=(
                f"{result.get('error') or 'NDA template not available.'} "
                "You can still call `generate_nda` — it will produce a "
                "fallback draft from the user-provided details."
            ),
        )
    return ToolOutcome(
        result_text=(
            f"NDA template found for {result['jurisdiction']}. "
            f"Has {result['section_count']} content sections. "
            "Ask the user for party details."
        ),
    )


async def _execute_nda(args: dict, *, user_id: Optional[UUID] = None) -> ToolOutcome:
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
    doc = await generate_nda(data, user_id=str(user_id) if user_id else None)
    return ToolOutcome(
        result_text=(
            f"NDA generated as an editable Google Doc. {_doc_link_text(doc)}. "
            f"Summary: {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_inspect_roi(*, user_id: Optional[UUID] = None) -> ToolOutcome:
    from app.services.zippy_docs.roi import inspect_roi_template
    result = await inspect_roi_template(
        user_id=str(user_id) if user_id else None
    )
    if not result.get("found"):
        return ToolOutcome(
            result_text=(
                f"ROI template not found: {result.get('error')}. "
                "Proceeding with generate_roi will produce a basic "
                "fallback sheet."
            )
        )
    fields = "\n".join(f"  - {f}" for f in result.get("input_fields", []))
    return ToolOutcome(
        result_text=(
            f"ROI template found: {result['template_name']}.\n"
            f"Input fields needed from the AE's form response:\n{fields}\n"
            f"{result.get('note', '')}"
        )
    )


async def _execute_roi(args: dict, *, user_id: Optional[UUID] = None) -> ToolOutcome:
    from app.services.zippy_docs.roi import ROIInput, generate as generate_roi
    data = ROIInput(
        client_name=args.get("client_name", "Client"),
        prepared_by=args.get("prepared_by", "Beacon"),
        report_date=args.get("report_date"),
        q1_reason=args.get("q1_reason"),
        q2_impls_per_year=args.get("q2_impls_per_year"),
        q3_team_size=args.get("q3_team_size"),
        q4_ftes_per_impl=args.get("q4_ftes_per_impl"),
        q5_duration_range=args.get("q5_duration_range"),
        q6_inception_weeks=args.get("q6_inception_weeks"),
        q7_solutioning_weeks=args.get("q7_solutioning_weeks"),
        q8_config_weeks=args.get("q8_config_weeks"),
        q9_data_migration_weeks=args.get("q9_data_migration_weeks"),
        q10_testing_weeks=args.get("q10_testing_weeks"),
        q11_cutover_weeks=args.get("q11_cutover_weeks"),
        q12_fte_cost_usd=args.get("q12_fte_cost_usd"),
        q13_ramp_up=args.get("q13_ramp_up"),
        q14_new_headcount=args.get("q14_new_headcount"),
    )
    doc = await generate_roi(data, user_id=str(user_id) if user_id else None)
    return ToolOutcome(
        result_text=(
            f"ROI Analysis generated for {data.client_name}. "
            f"{_doc_link_text(doc)}. {doc.summary}"
        ),
        artifacts=[_doc_to_artifact(doc)],
    )


async def _execute_generic(args: dict, *, user_id: Optional[UUID] = None) -> ToolOutcome:
    data = GenericDocInput(
        title=args.get("title", "Draft"),
        markdown=args.get("markdown", ""),
        client_name=args.get("client_name"),
    )
    doc = await generate_generic(data, user_id=str(user_id) if user_id else None)
    return ToolOutcome(
        result_text=(
            f"Document generated as an editable Google Doc. {_doc_link_text(doc)}."
        ),
        artifacts=[_doc_to_artifact(doc)],
    )
