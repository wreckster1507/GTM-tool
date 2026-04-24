"""Minutes of Meeting generator — fills Beacon's actual Drive MOM template.

Flow (mirrors the NDA tool):
  1. ``inspect_mom_template()``  — downloads the Drive template, returns every
     ``{{PLACEHOLDER}}`` token found in the document with a human hint.
  2. ``generate(data)``          — downloads the template again, asks Claude to
     structure the transcript into the right sections, then replaces every
     ``{{PLACEHOLDER}}`` with the generated content and saves a .docx.

Fallback: if ``MOM_TEMPLATE_DRIVE_ID`` is empty or the Drive fetch fails, we
render a standard MOM from scratch so the tool never hard-fails.
"""
from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from docx import Document
from docx.shared import Pt, RGBColor
from sqlmodel import select as sm_select

from app.clients.anthropic_client import get_anthropic_client
from app.config import settings
from app.database import AsyncSessionLocal as async_session
from app.models.user_email_connection import UserEmailConnection
from app.models.zippy import IndexedDriveFile
from app.services.zippy_docs.base import (
    GeneratedDocument,
    build_output_path,
    human_today,
)

logger = logging.getLogger(__name__)

# Matches {{ANY_TOKEN}} in template text.
_TOKEN_RE = re.compile(r"\{\{([A-Z0-9_]+)\}\}")


@dataclass
class MOMInput:
    client_name: str
    meeting_date: Optional[str] = None
    attendees: Optional[list[str]] = None
    transcript: Optional[str] = None
    context_notes: Optional[str] = None


# ── Drive template fetch — auto-discovers from indexed_drive_files ────────────
#
# No .env ID needed. We look up the MOM template by name in the files the user
# has already indexed.  Keywords tried in order:
#   1. "MOM template"  (exact phrase, case-insensitive)
#   2. "MOM"  (any .docx whose name contains MOM)
#   3. "minutes of meeting"
# The first match wins.

_MOM_KEYWORDS = ["mom template", "mom", "minutes of meeting"]

# In-process cache: { file_id: (modified_at_iso, raw_bytes) }
# Invalidates automatically when the indexer updates `drive_modified_at`,
# so editing the template in Drive + re-running the index picks up the new
# version on the very next MOM request — no manual cache bust needed.
_TEMPLATE_CACHE: dict[str, tuple[str, bytes]] = {}


async def _find_mom_template_row(user_id: Optional[str] = None) -> Optional[IndexedDriveFile]:
    """Return the IndexedDriveFile row for the MOM template, or None.

    Scope rules:
      * Prefer the current user's own synced file (matches `owner_user_id`).
      * Fall back to the admin/shared folder (`is_admin=True`) if the user
        hasn't synced one themselves.
      * Never return another user's private file.
    """
    from sqlalchemy import or_

    async with async_session() as session:
        for keyword in _MOM_KEYWORDS:
            stmt = sm_select(IndexedDriveFile).where(
                IndexedDriveFile.name.ilike(f"%{keyword}%"),
            )
            if user_id is not None:
                stmt = stmt.where(
                    or_(
                        IndexedDriveFile.owner_user_id == user_id,
                        IndexedDriveFile.is_admin == True,  # noqa: E712
                    )
                )
            else:
                # No user context — only admin/shared files are safe to return.
                stmt = stmt.where(IndexedDriveFile.is_admin == True)  # noqa: E712

            # Prefer the user's OWN file over the admin copy so personal
            # overrides win. Then most recently indexed.
            if user_id is not None:
                from sqlalchemy import case
                user_priority = case(
                    (IndexedDriveFile.owner_user_id == user_id, 0),
                    else_=1,
                )
                stmt = stmt.order_by(
                    user_priority,
                    IndexedDriveFile.last_indexed_at.desc(),
                )
            else:
                stmt = stmt.order_by(IndexedDriveFile.last_indexed_at.desc())

            row = (await session.execute(stmt.limit(1))).scalar_one_or_none()
            if row:
                logger.info(
                    "MOM template found: name=%s file_id=%s mime=%s owner=%s is_admin=%s",
                    row.name, row.drive_file_id, row.mime_type,
                    row.owner_user_id, row.is_admin,
                )
                return row
    logger.info("No MOM template matched for user_id=%s", user_id)
    return None


async def _fetch_template_bytes(user_id: Optional[str] = None) -> Optional[bytes]:
    data, _err = await _fetch_template_bytes_with_error(user_id=user_id)
    return data


async def _fetch_template_bytes_with_error(
    user_id: Optional[str] = None,
) -> tuple[Optional[bytes], Optional[str]]:
    """Fetch the MOM template bytes for a specific user.

    Uses the OAuth connection that matches the file's owner (personal file →
    user's own connection; admin file → admin's connection). This avoids the
    silent 403 we were seeing when the admin connection tried to download a
    user's private file."""
    row = await _find_mom_template_row(user_id=user_id)
    if not row:
        return None, (
            "No MOM template is indexed for this user. Upload a file named "
            "'MOM Template.docx' to your synced Drive folder and click Sync."
        )

    file_id = row.drive_file_id
    actual_mime = row.mime_type
    cache_key = (
        row.drive_modified_at.isoformat() if row.drive_modified_at else "no-modified"
    )

    cached = _TEMPLATE_CACHE.get(file_id)
    if cached and cached[0] == cache_key:
        logger.info("MOM template cache HIT for %s (%d bytes)", file_id, len(cached[1]))
        return cached[1], None

    from app.clients import google_drive

    async with async_session() as session:
        # Use the OAuth connection that owns this specific file. Personal
        # files need the user's token; admin files need the admin's token.
        result = await session.execute(
            sm_select(UserEmailConnection).where(
                UserEmailConnection.user_id == row.owner_user_id,
                UserEmailConnection.is_active == True,  # noqa: E712
            )
        )
        connection = result.scalar_one_or_none()

        if not connection:
            logger.warning(
                "No active Drive connection for owner_user_id=%s — cannot fetch MOM template",
                row.owner_user_id,
            )
            return None, (
                f"Drive connection for the owner of '{row.name}' is inactive. "
                "Reconnect Google Drive in Settings and re-sync."
            )

        try:
            # Google Docs need to be EXPORTED as .docx — the default downloader
            # exports them as text/plain (good for RAG, useless for python-docx
            # which needs real zip bytes). Handle that case directly here.
            if actual_mime == "application/vnd.google-apps.document":
                import httpx
                from app.clients.google_drive import _ensure_token, DRIVE_API_BASE
                access_token, _updated_token = await _ensure_token(
                    connection.token_data,
                    settings.gmail_client_id,
                    settings.gmail_client_secret,
                )
                docx_mime = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                async with httpx.AsyncClient(timeout=60) as http:
                    resp = await http.get(
                        f"{DRIVE_API_BASE}/files/{file_id}/export",
                        headers={"Authorization": f"Bearer {access_token}"},
                        params={"mimeType": docx_mime},
                    )
                if resp.status_code != 200:
                    return None, (
                        f"Drive export to .docx failed for '{row.name}' "
                        f"(status {resp.status_code}): {resp.text[:300]}"
                    )
                data = resp.content
            else:
                data, _mime, _updated = await google_drive.download_file_bytes(
                    file_id=file_id,
                    mime_type=actual_mime,
                    token_data=connection.token_data,
                    client_id=settings.gmail_client_id,
                    client_secret=settings.gmail_client_secret,
                )
            if not data:
                return None, f"Drive returned empty bytes for {row.name} (file_id={file_id}, mime={actual_mime}). File may have been deleted or permissions revoked."
            # Sanity-check: valid .docx files start with PK zip magic bytes.
            if not data.startswith(b"PK"):
                return None, (
                    f"'{row.name}' didn't come back as a valid .docx "
                    f"(first bytes: {data[:8]!r}). Re-upload the file as a "
                    "real .docx (don't let Drive convert it to a Google Doc)."
                )
            logger.info("MOM template downloaded fresh: %d bytes", len(data))
            _TEMPLATE_CACHE[file_id] = (cache_key, data)
            return data, None
        except Exception as exc:
            logger.exception("Failed to download MOM template file_id=%s: %s", file_id, exc)
            return None, f"Drive download failed for {row.name}: {type(exc).__name__}: {exc}"


# ── Paragraph walker ─────────────────────────────────────────────────────────


def _iter_paragraphs(doc: Document):
    """Yield every paragraph: body, tables, headers, footers."""
    for p in doc.paragraphs:
        yield p
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    yield p
    for section in doc.sections:
        for container in (section.header, section.footer):
            for p in container.paragraphs:
                yield p


# ── Inspection ───────────────────────────────────────────────────────────────

_TOKEN_HINTS: dict[str, str] = {
    "CLIENT": "Client / company name",
    "CLIENT_NAME": "Client / company name",
    "DATE": "Meeting date",
    "MEETING_DATE": "Meeting date",
    "ATTENDEES": "Attendee names (comma-separated)",
    "EXECUTIVE_SUMMARY": "2-3 sentence overview of the meeting",
    "KEY_DISCUSSION_POINTS": "Bullet list of main topics discussed",
    "DISCUSSION_POINTS": "Bullet list of main topics discussed",
    "DECISIONS": "Decisions made during the meeting",
    "ACTION_ITEMS": "Action items with owner and due date",
    "NEXT_STEPS": "Agreed next steps",
    "PREPARED_BY": "Name of person who prepared the MOM",
    "GENERATED_AT": "Timestamp of document generation",
}


async def inspect_mom_template(user_id: Optional[str] = None) -> dict:
    """Return every {{TOKEN}} in the MOM template with a hint for the agent."""
    template_bytes, err = await _fetch_template_bytes_with_error(user_id=user_id)
    if not template_bytes:
        return {
            "found": False,
            "error": err or "Unknown error fetching MOM template.",
            "tokens": [],
        }

    doc = Document(io.BytesIO(template_bytes))
    seen: dict[str, str] = {}  # token → hint, deduped
    for p in _iter_paragraphs(doc):
        text = "".join(run.text for run in p.runs)
        for m in _TOKEN_RE.finditer(text):
            token = m.group(1)
            if token not in seen:
                seen[token] = _TOKEN_HINTS.get(token, f"Value for {token}")

    # Re-resolve the row so we can surface its name/file_id to the agent
    # without another Drive round-trip.
    row = await _find_mom_template_row(user_id=user_id)
    return {
        "found": True,
        "template_name": row.name if row else None,
        "template_drive_file_id": row.drive_file_id if row else None,
        "token_count": len(seen),
        "tokens": [{"token": k, "hint": v} for k, v in seen.items()],
    }


# ── Claude structuring ────────────────────────────────────────────────────────


async def _structure_with_claude(data: MOMInput, tokens: list[str]) -> dict:
    """Ask Claude to produce a value for every token found in the template."""
    client = get_anthropic_client()
    if client is None or not settings.claude_api_key:
        return _fallback_structure(data)

    token_list = "\n".join(f"  - {t}: {_TOKEN_HINTS.get(t, t)}" for t in tokens) if tokens else (
        "  - CLIENT, DATE, ATTENDEES, EXECUTIVE_SUMMARY, "
        "KEY_DISCUSSION_POINTS, DECISIONS, ACTION_ITEMS, NEXT_STEPS"
    )

    prompt = f"""You are Zippy, Beacon's internal assistant. Fill in the MOM template exactly.
Return ONLY valid JSON. Do NOT add extra keys. Do NOT invent facts not present in the transcript.
Use only what the user provided. Leave a value as "" if the transcript doesn't contain that information.

Template tokens to fill:
{token_list}

Client: {data.client_name}
Meeting date: {data.meeting_date or human_today()}
Attendees: {', '.join(data.attendees or []) or 'Not specified'}

Transcript / Notes:
<<<
{(data.transcript or data.context_notes or '(none)')[:18000]}
>>>

Return a JSON object where each key is a token name (without curly braces) and the value is the
text to insert. For bullet lists (discussion points, action items, next steps), return a
newline-separated string with each item prefixed by "• ".
"""
    try:
        response = await client.messages.create(
            model=settings.CLAUDE_MODEL_STANDARD,
            max_tokens=3000,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(
            block.text for block in response.content if getattr(block, "type", "") == "text"
        )
        start = raw.find("{")
        end = raw.rfind("}")
        if start == -1 or end == -1:
            raise ValueError("No JSON in Claude response")
        return json.loads(raw[start: end + 1])
    except Exception as exc:
        logger.warning("MOM Claude structuring failed, using fallback: %s", exc)
        return _fallback_structure(data)


def _fallback_structure(data: MOMInput) -> dict:
    notes = (data.context_notes or data.transcript or "").strip()
    summary = notes.split("\n\n")[0][:500] if notes else "Summary not provided."
    return {
        "CLIENT": data.client_name,
        "CLIENT_NAME": data.client_name,
        "DATE": data.meeting_date or human_today(),
        "MEETING_DATE": data.meeting_date or human_today(),
        "ATTENDEES": ", ".join(data.attendees or []) or "Not specified",
        "EXECUTIVE_SUMMARY": summary,
        "KEY_DISCUSSION_POINTS": "• Details from the transcript not available.",
        "DISCUSSION_POINTS": "• Details from the transcript not available.",
        "DECISIONS": "• No explicit decisions captured.",
        "ACTION_ITEMS": "• No action items captured.",
        "NEXT_STEPS": "• To be confirmed in follow-up.",
        "GENERATED_AT": datetime.utcnow().strftime("%d %b %Y %H:%M UTC"),
        "PREPARED_BY": "Zippy",
    }


# ── Template filling ──────────────────────────────────────────────────────────


def _fill_paragraph(paragraph, replacements: dict[str, str]) -> None:
    """Replace all {{TOKEN}} occurrences in a paragraph's runs."""
    if not paragraph.runs:
        return
    full = "".join(run.text for run in paragraph.runs)
    if "{{" not in full:
        return
    new_text = _TOKEN_RE.sub(lambda m: replacements.get(m.group(1), m.group(0)), full)
    if new_text == full:
        return
    paragraph.runs[0].text = new_text
    for run in paragraph.runs[1:]:
        run.text = ""


def _apply_template_fills(doc: Document, replacements: dict[str, str]) -> None:
    for p in _iter_paragraphs(doc):
        _fill_paragraph(p, replacements)


# ── Fallback renderer (no template available) ─────────────────────────────────


def _render_fallback_docx(data: MOMInput, structured: dict, path) -> None:
    """Build a standard MOM .docx when the Drive template can't be fetched."""
    doc = Document()
    title = doc.add_heading(f"Minutes of Meeting — {data.client_name}", level=0)
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)

    meta = doc.add_paragraph()
    meta.add_run("Date: ").bold = True
    meta.add_run(data.meeting_date or human_today())
    meta.add_run("\n")
    meta.add_run("Attendees: ").bold = True
    meta.add_run(", ".join(data.attendees or []) or "Not specified")

    def heading(text: str) -> None:
        h = doc.add_heading(text, level=1)
        for run in h.runs:
            run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)

    def bullets(raw: str) -> None:
        for line in (raw or "").split("\n"):
            line = line.lstrip("•- ").strip()
            if line:
                doc.add_paragraph(line, style="List Bullet")

    heading("Executive Summary")
    doc.add_paragraph(structured.get("EXECUTIVE_SUMMARY", ""))

    heading("Key Discussion Points")
    bullets(structured.get("KEY_DISCUSSION_POINTS", structured.get("DISCUSSION_POINTS", "")))

    heading("Decisions")
    decisions = structured.get("DECISIONS", "")
    if decisions.strip():
        bullets(decisions)
    else:
        doc.add_paragraph("No explicit decisions captured in this meeting.").italic = True

    heading("Action Items")
    actions = structured.get("ACTION_ITEMS", "")
    if actions.strip():
        bullets(actions)
    else:
        doc.add_paragraph("No action items captured.").italic = True

    heading("Next Steps")
    bullets(structured.get("NEXT_STEPS", "To be confirmed in follow-up."))

    footer = doc.add_paragraph()
    fr = footer.add_run(
        f"\nGenerated by Zippy on {datetime.utcnow().strftime('%d %b %Y %H:%M UTC')}"
    )
    fr.italic = True
    fr.font.size = Pt(9)
    fr.font.color.rgb = RGBColor(0x8A, 0x8A, 0x8A)

    doc.save(str(path))


# ── Public entry points ───────────────────────────────────────────────────────


class MOMTemplateUnavailable(RuntimeError):
    """Raised when the Drive MOM template can't be fetched.

    We deliberately refuse to render a made-up MOM — the user was getting
    fabricated sections (Zippy's own headings + "Generated by Zippy" footer)
    that looked like a real MOM but weren't from their template."""


async def generate(data: MOMInput, user_id: Optional[str] = None) -> GeneratedDocument:
    template_bytes, err = await _fetch_template_bytes_with_error(user_id=user_id)
    if not template_bytes:
        # Hard-fail. No fallback renderer — the tool contract is "fill the
        # real Drive template or error out." Agent must surface this.
        raise MOMTemplateUnavailable(
            err or "MOM Template.docx could not be fetched from Drive."
        )

    path, url = build_output_path("MOM", data.client_name)

    # Decide which tokens to ask Claude to fill.
    doc = Document(io.BytesIO(template_bytes))
    tokens_in_template = list(
        dict.fromkeys(  # preserve order, dedupe
            m.group(1)
            for p in _iter_paragraphs(doc)
            for m in _TOKEN_RE.finditer("".join(r.text for r in p.runs))
        )
    )
    # Always include the essentials even if template omits them — harmless
    # if the template has no matching token (sub() is a no-op).
    for t in ("CLIENT", "DATE", "ATTENDEES", "EXECUTIVE_SUMMARY",
              "KEY_DISCUSSION_POINTS", "DECISIONS", "ACTION_ITEMS", "NEXT_STEPS"):
        if t not in tokens_in_template:
            tokens_in_template.append(t)

    structured = await _structure_with_claude(data, tokens_in_template)

    # Always inject the mechanical fields — don't ask Claude for these.
    structured.setdefault("CLIENT", data.client_name)
    structured.setdefault("CLIENT_NAME", data.client_name)
    structured.setdefault("DATE", data.meeting_date or human_today())
    structured.setdefault("MEETING_DATE", data.meeting_date or human_today())
    structured.setdefault("ATTENDEES", ", ".join(data.attendees or []) or "Not specified")
    structured.setdefault("GENERATED_AT", datetime.utcnow().strftime("%d %b %Y %H:%M UTC"))
    structured.setdefault("PREPARED_BY", "Zippy")

    # Re-load a fresh copy so we fill from the clean template.
    doc = Document(io.BytesIO(template_bytes))
    _apply_template_fills(doc, structured)
    doc.save(str(path))
    source = "template"

    action_count = structured.get("ACTION_ITEMS", "").count("•")
    return GeneratedDocument(
        filename=path.name,
        path=str(path),
        url=url,
        kind="mom",
        summary=(
            f"MOM drafted from {source} for {data.client_name} — "
            f"{action_count} action item(s) captured."
        ),
        created_at=datetime.utcnow(),
    )
