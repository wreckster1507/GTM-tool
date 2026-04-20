"""Minutes of Meeting generator.

Given a transcript (or meeting context) and a client name, produces a polished
``.docx`` following Beacon's standard MOM structure:

    1. Meeting metadata (client, date, attendees)
    2. Executive summary
    3. Key discussion points
    4. Decisions
    5. Action items (owner, due date)
    6. Next steps

When an Anthropic API key is available, we ask Claude to structure the raw
transcript. Otherwise we fall back to a template populated from the hints the
agent passes in so the generator never hard-fails.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Optional

from docx import Document
from docx.shared import Pt, RGBColor

from app.clients.anthropic_client import get_anthropic_client
from app.config import settings
from app.services.zippy_docs.base import (
    GeneratedDocument,
    build_output_path,
    human_today,
)

logger = logging.getLogger(__name__)


@dataclass
class MOMInput:
    client_name: str
    meeting_date: Optional[str] = None
    attendees: Optional[list[str]] = None
    transcript: Optional[str] = None
    context_notes: Optional[str] = None  # free-text from the user


async def _structure_with_claude(data: MOMInput) -> dict:
    """Ask Claude to turn the raw input into a structured MOM JSON."""
    client = get_anthropic_client()
    if client is None or not settings.claude_api_key:
        return _fallback_structure(data)

    prompt = f"""You are Zippy, Beacon's internal assistant. Produce a Minutes of Meeting in strict JSON
for the following call. Respond with ONLY valid JSON and no prose.

Client: {data.client_name}
Meeting date: {data.meeting_date or human_today()}
Attendees: {', '.join(data.attendees or []) or 'Not specified'}

Context notes from the user:
{data.context_notes or '(none)'}

Transcript (may be partial):
<<<TRANSCRIPT
{(data.transcript or '')[:18000]}
TRANSCRIPT

Schema:
{{
  "executive_summary": "2-3 sentence overview",
  "key_discussion_points": ["..."],
  "decisions": ["..."],
  "action_items": [
    {{"owner": "...", "task": "...", "due_date": "YYYY-MM-DD or TBD"}}
  ],
  "next_steps": ["..."]
}}
"""
    try:
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL_STANDARD,
            max_tokens=2000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        )
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON found in Claude response")
        return json.loads(raw[start : end + 1])
    except Exception as exc:
        logger.warning("MOM Claude structuring failed, falling back: %s", exc)
        return _fallback_structure(data)


def _fallback_structure(data: MOMInput) -> dict:
    """Minimal MOM so the generator always produces a file."""
    notes = (data.context_notes or data.transcript or "").strip()
    summary = notes.split("\n\n")[0] if notes else "Meeting summary not provided."
    return {
        "executive_summary": summary[:500],
        "key_discussion_points": [
            "Populated from user-provided context.",
        ],
        "decisions": [],
        "action_items": [],
        "next_steps": [],
    }


def _add_heading(doc: Document, text: str, level: int = 1) -> None:
    heading = doc.add_heading(text, level=level)
    for run in heading.runs:
        run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)


def _render_docx(data: MOMInput, structured: dict, path) -> None:
    doc = Document()
    # Title block
    title = doc.add_heading(f"Minutes of Meeting — {data.client_name}", level=0)
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)

    meta = doc.add_paragraph()
    meta.add_run("Date: ").bold = True
    meta.add_run(data.meeting_date or human_today()).add_break()
    meta.add_run("Attendees: ").bold = True
    meta.add_run(", ".join(data.attendees or []) or "Not specified")

    _add_heading(doc, "Executive Summary", level=1)
    doc.add_paragraph(structured.get("executive_summary", ""))

    _add_heading(doc, "Key Discussion Points", level=1)
    for point in structured.get("key_discussion_points", []):
        doc.add_paragraph(point, style="List Bullet")

    _add_heading(doc, "Decisions", level=1)
    decisions = structured.get("decisions", [])
    if decisions:
        for decision in decisions:
            doc.add_paragraph(decision, style="List Bullet")
    else:
        doc.add_paragraph("No explicit decisions captured in this meeting.").italic = True

    _add_heading(doc, "Action Items", level=1)
    actions = structured.get("action_items", [])
    if actions:
        table = doc.add_table(rows=1, cols=3)
        table.style = "Light Grid Accent 1"
        header = table.rows[0].cells
        header[0].text = "Owner"
        header[1].text = "Task"
        header[2].text = "Due date"
        for item in actions:
            row = table.add_row().cells
            row[0].text = item.get("owner", "") or "Unassigned"
            row[1].text = item.get("task", "")
            row[2].text = item.get("due_date", "TBD")
    else:
        doc.add_paragraph("No action items captured.").italic = True

    _add_heading(doc, "Next Steps", level=1)
    for step in structured.get("next_steps", []) or ["To be confirmed in follow-up."]:
        doc.add_paragraph(step, style="List Bullet")

    footer = doc.add_paragraph()
    footer_run = footer.add_run(
        f"\nGenerated by Zippy on {datetime.utcnow().strftime('%d %b %Y %H:%M UTC')}"
    )
    footer_run.italic = True
    footer_run.font.size = Pt(9)
    footer_run.font.color.rgb = RGBColor(0x8A, 0x8A, 0x8A)

    doc.save(str(path))


async def generate(data: MOMInput) -> GeneratedDocument:
    structured = await _structure_with_claude(data)
    path, url = build_output_path("MOM", data.client_name)
    _render_docx(data, structured, path)
    return GeneratedDocument(
        filename=path.name,
        path=str(path),
        url=url,
        kind="mom",
        summary=f"MOM drafted for {data.client_name} — "
        f"{len(structured.get('action_items') or [])} action items captured.",
        created_at=datetime.utcnow(),
    )
