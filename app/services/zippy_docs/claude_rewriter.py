"""LLM-driven content rewriter used by every Zippy generator.

Given a structure (list of text blocks) extracted from a template and a dict
of user inputs, asks Claude to rewrite every non-structural block using ONLY
the user inputs. Returns the list of rewritten blocks ready to be patched
back into the original document by ``doc_rewriter.rewrite_docx_content``
(or the pptx equivalent).

This is doc-type agnostic — callers pass ``doc_type`` so we can add a tailored
instruction line, but the core contract is always the same: rewrite content,
leave skeleton alone, never invent facts.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

logger = logging.getLogger(__name__)


_DOC_TYPE_INSTRUCTIONS: dict[str, str] = {
    "mom": (
        "Rewrite client name, date, attendees, overview, pain points, "
        "key challenges, current tooling, areas of strong interest, "
        "action items table, next steps, and collateral list "
        "using ONLY the transcript and inputs provided.\n\n"
        "FORMAT RULES — check user_inputs['format_type']:\n"
        "  'long'  → be detailed. Include Overview, Key Challenges, "
        "Scale & Metrics (if any metrics in transcript), Current Tooling, "
        "Areas of Strong Interest as sub-sections. Write full sentences.\n"
        "  'short' → key highlights only. 3-5 bullet points per section max. "
        "Skip sub-sections with no content. Be concise.\n\n"
        "COLLATERAL — user_inputs['collateral'] contains a list of strings "
        "in the format 'Label : Name | url'. Render each as a bullet point "
        "with the label+name as the visible text. If the template has a "
        "Collateral Shared section, fill it with these items. If collateral "
        "list is empty, leave the section blank.\n\n"
        "EXTRACTION RULES — from the transcript extract:\n"
        "  • Pain points and context — exact phrases where possible\n"
        "  • Every metric (team sizes, volumes, timelines)\n"
        "  • All tooling/systems mentioned\n"
        "  • Every agreed next step with owner and timeline\n"
        "  • Any commercial discussion or budget signals\n\n"
        "Do NOT invent quotes, attendee titles, or specifics not in the "
        "transcript. If a section was not discussed in the meeting AND the "
        "block already has real template text, return the ORIGINAL text "
        "for that block unchanged — do NOT return empty string. Empty "
        "string overwrites real content with nothing. Only return empty "
        "string if the original text was already empty."
    ),
    "nda": (
        "Rewrite party names, effective date, jurisdiction, purpose, term, "
        "and governing city using ONLY the fills provided. If a value is "
        "missing for a block, leave it as an empty string — do NOT invent "
        "parties, dates, or clauses. Leave blank lines (___ or ——) as-is "
        "when no value has been supplied for them."
    ),
    "proposal": (
        "Rewrite client name, pain points, proposed scope, timeline, and "
        "commercial terms using ONLY user inputs."
    ),
    "sow": (
        "Rewrite client name, scope, deliverables, timeline, payment terms, "
        "and assumptions using ONLY user inputs."
    ),
    "poc_kickoff": (
        "You are filling a Beacon PoC Kickoff document for the client "
        "named in user_inputs['client_name']. Rewrite ALL content blocks "
        "using ONLY the email thread content provided in "
        "user_inputs['email_content'].\n\n"
        "WHAT TO EXTRACT from emails and fill into the template:\n"
        "  • [Client Name] → use client_name from inputs everywhere it appears\n"
        "  • [Insert Date] / [Insert Start Date] / [Insert End Date] → "
        "extract dates from emails (kickoff date, completion date)\n"
        "  • <specific workflow> → the specific implementation workflow or "
        "module discussed in the emails (e.g. 'Inception automation for "
        "Guidewire', 'Configuration automation for SAP')\n"
        "  • [Insert URL] → PoC environment URL if mentioned in emails, "
        "otherwise leave as '[Insert URL]'\n"
        "  • [Insert Email/ID] and [Insert Password] → PoC credentials "
        "if mentioned, otherwise leave as-is\n"
        "  • Use Case 1 / Use Case 2 — INFER these from the emails. The "
        "thread will rarely use the literal phrase 'Use Case 1' — instead "
        "look for: pain points the client raised, workflows they want "
        "automated, modules they named, KPIs they want to move. Each such "
        "topic is a use case. Title = a short noun phrase ('Implementation "
        "config automation'); Business Problem = what hurts today in their "
        "words; Expected Outcome = the win they described.\n"
        "  • If the emails describe ONE clear use case, fill Use Case 1 "
        "fully and mark Use Case 2 fields as 'TBD — to be confirmed with "
        "Zywave'. Do NOT leave Use Case 1 blank just because the email "
        "didn't number it.\n"
        "  • Deliverable 1 / 2 → one short line each describing what "
        "Beacon will produce for that use case (e.g. 'AI-generated UAT "
        "scripts for the cutover workflow').\n"
        "  • [Insert End Date] → if the email mentions a duration ('4-week "
        "PoC', 'wrap by end of May'), compute the end date from the "
        "kickoff. If no duration is mentioned, leave as '[Insert End Date]'.\n"
        "  • [Your Name] → use prepared_by from inputs verbatim. If "
        "prepared_by is '[Your Name]' or starts with '[', leave the "
        "placeholder as-is — never substitute 'Zippy', 'Beacon', or any "
        "other brand string.\n\n"
        "NEXT STEPS SECTION — SPECIAL CASE:\n"
        "  The template contains a 'NEXT STEPS' section. We are deliberately "
        "removing this section from the generated document. For ANY content "
        "block whose nearest section heading above it is 'NEXT STEPS' (or "
        "any case variant), return an empty string as new_text — this is "
        "the ONE exception to the 'never return empty for non-empty blocks' "
        "rule. The structural heading 'NEXT STEPS' itself should also be "
        "returned as empty string so the section disappears entirely.\n\n"
        "HARD RULES:\n"
        "  - Never invent specific timelines or credentials not in emails.\n"
        "  - DO infer use case titles, problems, and outcomes from any "
        "topic genuinely discussed — that's not invention, that's "
        "summarising the thread.\n"
        "  - Keep structural text exactly (section headers like OBJECTIVE, "
        "USE CASES, TIMELINE etc. are structural — do not change them).\n"
        "  - Bracketed placeholders ([Insert URL], [Insert Email/ID], "
        "[Insert Password], [Insert End Date]) stay as bracketed "
        "placeholders when the email genuinely contains no data — these "
        "are filled by the AE before sending.\n"
        "  - client_name must appear wherever [Client Name] was in the template."
    ),
    "poc_demo_ppt": (
        "You are filling a Beacon PoC Demo deck originally built for "
        "Zellis. The new client is named in user_inputs['client_name']. "
        "Source material is in user_inputs['source_content'], which "
        "contains the PoC Kickoff document and the email thread, "
        "concatenated under '=== POC KICKOFF DOCUMENT ===' and "
        "'=== EMAIL THREADS ===' headers.\n\n"
        "SLIDE-BY-SLIDE CONTRACT (slides are 1-indexed; the structure "
        "carries a slide_number on every block):\n"
        "  • Slides 1, 2, 6, 7 → return new_text EQUAL TO the original "
        "text for every block, EXCEPT swap any literal occurrence of "
        "'Zellis' (case-insensitive) with client_name. These slides are "
        "Beacon-about / closing slides — never invent or reword.\n"
        "  • Slide 3 → 'About <client_name>' or 'Client Context'. Pull "
        "1-2 sentence company description and 3-5 bullets covering the "
        "pain points / drivers raised in the source content. Each bullet "
        "≤ 8 words. If the source has no description, keep the original "
        "Zellis block with the name swap only.\n"
        "  • Slide 4 → 'Use Cases in Scope'. List the use cases from the "
        "PoC Kickoff document verbatim (titles + one-line problem). If "
        "the kickoff names two use cases, render two; if one, render one "
        "and leave the second placeholder block empty. ≤ 8 words per "
        "bullet.\n"
        "  • Slide 5 → 'PoC Plan / Deliverables / Timeline'. Pull "
        "deliverables, milestones, kickoff & end dates from the kickoff "
        "doc. Bullets ≤ 8 words. Dates verbatim from the kickoff.\n\n"
        "REPLACEMENT RULE: every literal 'Zellis' (any case) anywhere in "
        "the deck becomes client_name. Do this even on slides 1, 2, 6, 7.\n\n"
        "HARD RULES:\n"
        "  - Never invent metrics, dates, names, logos.\n"
        "  - Never expand a bullet beyond 8 words.\n"
        "  - If the source genuinely has nothing for a slide-3/4/5 "
        "block, fall back to the original Zellis text with the name "
        "swap — do NOT return empty string for a non-empty original.\n"
        "  - Structural blocks (slide titles, footer page numbers) — "
        "return as-is with the Zellis→client_name swap only."
    ),
}


SYSTEM_PROMPT = (
    "You are Zippy, Beacon's internal document generator. You rewrite "
    "document content based on user inputs. You NEVER invent facts. You "
    "only use what is explicitly provided in the user inputs. "
    "CRITICAL: If you do not have a replacement for a block that already "
    "contains real text, return the ORIGINAL text for that block "
    "UNCHANGED — do NOT return empty string. Empty string overwrites real "
    "content with nothing, which destroys the template. Empty string is "
    "ONLY acceptable when the original block was already empty (a blank "
    "slot you genuinely have nothing to fill it with). "
    "NEVER write bracketed placeholders like '[not specified in transcript]', "
    "'[to be provided]', '[TBD]', '[attendees not listed]', or similar."
)


def _original_as_fallback(structure: list[dict]) -> list[dict]:
    """Return a no-op rewrite: every block keeps its existing text.

    Used when Claude is unreachable or returns something we can't parse —
    guarantees the generator never hard-fails because of a model hiccup.
    """
    return [
        {"block_index": b["block_index"], "new_text": b.get("text", "")}
        for b in structure
    ]


def _parse_claude_json(raw: str) -> Optional[list[dict]]:
    """Extract a JSON array from Claude's response, tolerant of code fences."""
    if not raw:
        return None
    # Claude sometimes wraps JSON in ```json ... ``` despite being told not to.
    cleaned = raw.strip()
    if cleaned.startswith("```"):
        # Strip the first fence line and the trailing fence.
        cleaned = cleaned.split("\n", 1)[-1]
        if cleaned.endswith("```"):
            cleaned = cleaned[: -3]
        cleaned = cleaned.strip()
    # Find the first '[' and the matching last ']'.
    start = cleaned.find("[")
    end = cleaned.rfind("]")
    if start == -1 or end == -1 or end < start:
        return None
    try:
        data = json.loads(cleaned[start: end + 1])
    except json.JSONDecodeError as exc:
        logger.warning("Claude response wasn't valid JSON: %s", exc)
        return None
    if not isinstance(data, list):
        return None
    return data


async def rewrite_with_claude(
    structure: list[dict],
    user_inputs: dict[str, Any],
    doc_type: str,
    client: Any,
    model: str,
) -> list[dict]:
    """Ask Claude to rewrite every non-structural block using user_inputs.

    Returns a list of ``{"block_index": int, "new_text": str}`` dicts.
    On any failure (no client, parse error, exception), returns a
    no-op rewrite that leaves the document unchanged.
    """
    if client is None:
        logger.warning("No Anthropic client available — returning no-op rewrite")
        return _original_as_fallback(structure)

    instructions = _DOC_TYPE_INSTRUCTIONS.get(
        doc_type,
        "Rewrite content blocks using ONLY user inputs. Do not invent facts.",
    )

    # Compact the structure — Claude doesn't need every field, just what it
    # takes to reproduce the order. Keeps the prompt small so big templates
    # don't blow the context window.
    compact = [
        {
            "block_index": b["block_index"],
            "is_structural": b["is_structural"],
            "text": b.get("text", ""),
        }
        for b in structure
    ]

    user_msg = (
        f"Document type: {doc_type}\n\n"
        "Here is the existing document structure. Each block has an index "
        "and text. Blocks marked is_structural: true are section headers — "
        "DO NOT rewrite them, return them exactly as-is. Blocks marked "
        "is_structural: false contain content that must be rewritten using "
        "ONLY the user inputs provided below.\n\n"
        "IMPORTANT: A non-structural block whose text is currently empty is "
        "a fillable content SLOT, not a spacer. Look at the nearest "
        "structural block ABOVE it in the list — that heading tells you "
        "what belongs in the slot (e.g. an empty block right after an "
        '"Overview" heading should be filled with the overview from the '
        'inputs; an empty block right after "Attendees" gets the attendee '
        "list). Only return an empty string for a content block if the "
        "user inputs genuinely contain nothing for that section.\n\n"
        f"Document structure:\n{json.dumps(compact, ensure_ascii=False)}\n\n"
        f"User inputs:\n{json.dumps(user_inputs, ensure_ascii=False)}\n\n"
        f"Instructions for {doc_type}: {instructions}\n\n"
        "Return a JSON array. Each item must have:\n"
        '  "block_index": <same int as input>,\n'
        '  "new_text": <rewritten string, or original text if is_structural is true>\n\n'
        "Return ONLY the JSON array. No explanation. No markdown code fences."
    )

    try:
        response = await client.messages.create(
            model=model,
            max_tokens=8000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = "".join(
            block.text
            for block in response.content
            if getattr(block, "type", "") == "text"
        )
    except Exception as exc:
        logger.exception("Claude rewrite failed: %s", exc)
        return _original_as_fallback(structure)

    parsed = _parse_claude_json(raw)
    if parsed is None:
        logger.warning("Couldn't parse Claude rewrite response; using no-op fallback")
        return _original_as_fallback(structure)

    # Defensive: ensure each item has block_index + new_text and types are right.
    cleaned: list[dict] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        if "block_index" not in item or "new_text" not in item:
            continue
        try:
            idx = int(item["block_index"])
        except (TypeError, ValueError):
            continue
        cleaned.append({"block_index": idx, "new_text": str(item.get("new_text") or "")})

    if not cleaned:
        logger.warning("Claude returned empty/invalid rewrite list; using no-op fallback")
        return _original_as_fallback(structure)

    return cleaned
