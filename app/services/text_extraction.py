"""Pluggable text extraction for Drive + uploaded files.

We intentionally keep this module sync and CPU-bound — callers should run it
in a thread via ``asyncio.to_thread`` when invoked from async code.
"""
from __future__ import annotations

import csv
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)

# MIME types we know how to turn into text. Anything else is skipped with a
# warning so we don't crash the indexer on exotic files.
SUPPORTED_MIME_PREFIXES = (
    "text/",
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.ms-powerpoint",
    "application/msword",
    "application/vnd.ms-excel",
    "application/json",
    "application/xml",
)


def is_supported(mime_type: str) -> bool:
    mime = (mime_type or "").lower()
    return any(mime.startswith(prefix) for prefix in SUPPORTED_MIME_PREFIXES)


def extract_text(data: bytes, mime_type: str, filename: str = "") -> str:
    """Best-effort plaintext extraction. Returns '' on failure."""
    if not data:
        return ""
    mime = (mime_type or "").lower()

    try:
        if mime.startswith("text/") or mime in {"application/json", "application/xml"}:
            return _decode_text(data)
        if mime == "application/pdf":
            return _extract_pdf(data)
        if "wordprocessingml" in mime or mime == "application/msword" or filename.lower().endswith(".docx"):
            return _extract_docx(data)
        if "spreadsheetml" in mime or mime == "application/vnd.ms-excel" or filename.lower().endswith(".xlsx"):
            return _extract_xlsx(data)
        if (
            "presentationml" in mime
            or mime == "application/vnd.ms-powerpoint"
            or filename.lower().endswith(".pptx")
        ):
            return _extract_pptx(data)
        if filename.lower().endswith(".csv"):
            return _extract_csv(data)
    except Exception as exc:  # pragma: no cover
        logger.warning("extract_text failed for %s (%s): %s", filename, mime, exc)
        return ""

    logger.info("Skipping unsupported mime=%s filename=%s", mime, filename)
    return ""


def _decode_text(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "latin-1"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _extract_pdf(data: bytes) -> str:
    import pdfplumber  # local import keeps cold-start fast

    text_parts: list[str] = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            page_text: Optional[str] = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n\n".join(text_parts)


def _extract_docx(data: bytes) -> str:
    from docx import Document  # python-docx

    doc = Document(io.BytesIO(data))
    lines: list[str] = []
    for para in doc.paragraphs:
        if para.text:
            lines.append(para.text)
    # Tables sometimes hold the most interesting content (reqs docs, matrices).
    for table in doc.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text]
            if cells:
                lines.append(" | ".join(cells))
    return "\n".join(lines)


def _extract_xlsx(data: bytes) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(io.BytesIO(data), data_only=True, read_only=True)
    lines: list[str] = []
    for sheet in wb.worksheets:
        lines.append(f"## Sheet: {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            values = [str(v) for v in row if v not in (None, "")]
            if values:
                lines.append(" | ".join(values))
    return "\n".join(lines)


def _extract_csv(data: bytes) -> str:
    text = _decode_text(data)
    reader = csv.reader(io.StringIO(text))
    return "\n".join(" | ".join(row) for row in reader)


def _extract_pptx(data: bytes) -> str:
    """Pull text out of every slide — title, body, notes, tables."""
    from pptx import Presentation  # python-pptx

    prs = Presentation(io.BytesIO(data))
    lines: list[str] = []
    for i, slide in enumerate(prs.slides, start=1):
        lines.append(f"## Slide {i}")
        for shape in slide.shapes:
            # Plain text boxes / titles / placeholders
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    text = " ".join(run.text for run in para.runs if run.text)
                    if text.strip():
                        lines.append(text.strip())
            # Tables occasionally carry the actual content (matrices, specs).
            if shape.has_table:
                for row in shape.table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        lines.append(" | ".join(cells))
        # Speaker notes — often the most useful narrative bit.
        if slide.has_notes_slide and slide.notes_slide.notes_text_frame:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                lines.append(f"[Notes] {notes}")
    return "\n".join(lines)
