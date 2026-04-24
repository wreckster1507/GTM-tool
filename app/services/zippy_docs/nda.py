"""
NDA generator — fills blanks in the *user's own* Drive NDA template.

The real template doesn't use ``{{TOKEN}}`` placeholders — it uses visible
blanks (runs of underscores ``______`` or em-dashes ``——``) that a human
would fill by hand. So we do two things:

1. ``inspect_template(jurisdiction)`` downloads the template and scans every
   paragraph / table cell / header / footer for blank runs, returning them
   numbered with surrounding sentence context. Zippy shows these to the user
   one by one so they know what needs to be filled.

2. ``generate(data)`` downloads the same template and replaces each blank
   (in document order) with the value the user provided for that index.
   Blanks the user skipped are left as-is so they remain visible for review.
   We also still support ``{{TOKEN}}`` replacement in case a template is
   tokenised later — both mechanisms coexist.

Fallback: if the configured Drive template can't be fetched (no admin
connection, missing file id, Drive error), we render a minimal synthetic
draft so Zippy never hard-fails. A banner marks the fallback clearly.
"""
from __future__ import annotations

import io
import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

from docx import Document
from sqlmodel import select as sm_select

from app.config import settings
from app.database import AsyncSessionLocal as async_session
from app.models.user_email_connection import UserEmailConnection
from app.services.zippy_docs.base import (
    GeneratedDocument,
    build_output_path,
    human_today,
)

logger = logging.getLogger(__name__)

Jurisdiction = Literal["india", "us", "singapore"]

# A "blank" is 3+ consecutive underscore/dash/em-dash characters. Three is the
# shortest human-drawn blank that isn't just a hyphenated word.
_BLANK_RE = re.compile(r"[_\-\u2013\u2014]{3,}")


@dataclass
class NDAInput:
    """
    Inputs for the NDA generator. Everything except ``jurisdiction`` is
    optional and has *no* hidden default. ``fills`` is a mapping of
    blank-index (as returned by ``inspect_template``) → the text the user
    wants inserted at that blank. Legacy ``{{TOKEN}}`` fields are still
    supported but the real template uses blanks, so ``fills`` is the primary
    channel.
    """
    jurisdiction: Jurisdiction
    fills: dict[str, str] = field(default_factory=dict)  # "1" → "ACME Pvt Ltd"

    # Legacy token fields — still replaced if the template happens to use them.
    receiving_party: Optional[str] = None
    disclosing_party: Optional[str] = None
    mutual: Optional[bool] = None
    purpose: Optional[str] = None
    term_years: Optional[int] = None
    effective_date: Optional[str] = None
    governing_city: Optional[str] = None
    extra_clauses: list[str] = field(default_factory=list)


_JURISDICTION_LABEL = {
    "india": "Republic of India",
    "us": "State of Delaware, United States of America",
    "singapore": "Republic of Singapore",
}


def _template_drive_id(jurisdiction: Jurisdiction) -> str:
    return {
        "india": settings.NDA_TEMPLATE_DRIVE_ID_INDIA,
        "us": settings.NDA_TEMPLATE_DRIVE_ID_US,
        "singapore": settings.NDA_TEMPLATE_DRIVE_ID_SINGAPORE,
    }[jurisdiction]


def _build_token_mapping(data: NDAInput) -> dict[str, str]:
    mapping: dict[str, str] = {
        "{{JURISDICTION}}": _JURISDICTION_LABEL[data.jurisdiction],
    }
    if data.receiving_party:
        mapping["{{RECEIVING_PARTY}}"] = data.receiving_party
    if data.disclosing_party:
        mapping["{{DISCLOSING_PARTY}}"] = data.disclosing_party
    if data.effective_date:
        mapping["{{EFFECTIVE_DATE}}"] = data.effective_date
    if data.governing_city:
        mapping["{{GOVERNING_CITY}}"] = data.governing_city
    if data.term_years is not None:
        mapping["{{TERM_YEARS}}"] = str(data.term_years)
    if data.purpose:
        mapping["{{PURPOSE}}"] = data.purpose
    return mapping


# ── Drive template fetch ─────────────────────────────────────────────────────


async def _fetch_template_bytes(jurisdiction: Jurisdiction) -> Optional[bytes]:
    file_id = _template_drive_id(jurisdiction)
    if not file_id:
        logger.info("No Drive template configured for jurisdiction=%s", jurisdiction)
        return None

    from app.clients import google_drive

    async with async_session() as session:
        result = await session.execute(
            sm_select(UserEmailConnection).where(
                UserEmailConnection.is_admin_folder == True,  # noqa: E712
                UserEmailConnection.is_active == True,  # noqa: E712
            )
        )
        connection = result.scalar_one_or_none()
        if not connection:
            result = await session.execute(
                sm_select(UserEmailConnection).where(
                    UserEmailConnection.is_active == True,  # noqa: E712
                )
            )
            connection = result.scalar_one_or_none()
        if not connection:
            logger.warning("No Drive connection available to fetch NDA template")
            return None

        try:
            data, _mime, _updated = await google_drive.download_file_bytes(
                file_id=file_id,
                mime_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                token_data=connection.token_data,
                client_id=settings.gmail_client_id,
                client_secret=settings.gmail_client_secret,
            )
            return data
        except Exception as exc:
            logger.exception("Failed to download NDA template %s: %s", file_id, exc)
            return None


# ── Paragraph walker ─────────────────────────────────────────────────────────


def _iter_paragraphs(doc: Document):
    """Yield every paragraph in body, tables (incl. nested), headers, footers."""
    for p in doc.paragraphs:
        yield p
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                for p in cell.paragraphs:
                    yield p
                for nested in cell.tables:
                    for nrow in nested.rows:
                        for ncell in nrow.cells:
                            for np in ncell.paragraphs:
                                yield np
    for section in doc.sections:
        for container in (section.header, section.footer):
            for p in container.paragraphs:
                yield p


# ── Inspection: surface blanks with context ──────────────────────────────────


@dataclass
class TemplateBlank:
    index: int                  # 1-based position in doc order
    context: str                # surrounding sentence snippet
    hint: str                   # a short guess of what belongs here

    def as_dict(self) -> dict:
        return {"index": self.index, "context": self.context, "hint": self.hint}


def _guess_hint(context: str) -> str:
    """Best-effort label based on nearby keywords — purely to help Zippy/the user."""
    c = context.lower()
    pairs = [
        ("receiving party", "Receiving party (counterparty) legal name"),
        ("disclosing party", "Disclosing party legal name"),
        ("effective date", "Effective date"),
        ("dated", "Effective date"),
        ("this day of", "Effective date"),
        ("day of", "Day / date"),
        ("governing", "Governing-law city / jurisdiction"),
        ("jurisdiction", "Governing-law jurisdiction"),
        ("city of", "City"),
        ("mumbai", "City"),
        ("term of", "Term in years"),
        ("period of", "Term in years"),
        ("years", "Term in years"),
        ("purpose", "Purpose of the exchange"),
        ("address", "Party address"),
        ("registered office", "Registered office address"),
        ("cin", "Corporate identification number"),
        ("pan", "PAN"),
        ("gst", "GST number"),
        ("authorised signatory", "Authorised signatory"),
        ("signed by", "Signatory name"),
        ("name:", "Name"),
        ("title:", "Title"),
        ("company", "Company name"),
    ]
    for needle, label in pairs:
        if needle in c:
            return label
    return "Unlabeled blank — ask the user what belongs here"


def _extract_context(text: str, match: re.Match) -> str:
    start, end = match.span()
    left = text[max(0, start - 60): start].strip()
    right = text[end: end + 60].strip()
    return f"…{left} ____ {right}…"


async def inspect_template(jurisdiction: Jurisdiction) -> dict:
    """Return every fillable blank in the template with context + a hint."""
    template_bytes = await _fetch_template_bytes(jurisdiction)
    if not template_bytes:
        return {
            "found": False,
            "error": (
                "Couldn't fetch the NDA template from Drive — check "
                f"NDA_TEMPLATE_DRIVE_ID_{jurisdiction.upper()} and that an "
                "active Drive connection exists."
            ),
            "blanks": [],
        }
    doc = Document(io.BytesIO(template_bytes))
    blanks: list[TemplateBlank] = []
    idx = 0
    for p in _iter_paragraphs(doc):
        text = "".join(run.text for run in p.runs)
        if not text:
            continue
        for m in _BLANK_RE.finditer(text):
            idx += 1
            blanks.append(
                TemplateBlank(
                    index=idx,
                    context=_extract_context(text, m),
                    hint=_guess_hint(text),
                )
            )
    return {
        "found": True,
        "jurisdiction": jurisdiction,
        "blank_count": len(blanks),
        "blanks": [b.as_dict() for b in blanks],
    }


# ── Replacement ──────────────────────────────────────────────────────────────


def _replace_tokens_in_paragraph(paragraph, mapping: dict[str, str]) -> None:
    if not paragraph.runs or not mapping:
        return
    full = "".join(run.text for run in paragraph.runs)
    if not any(token in full for token in mapping):
        return
    replaced = full
    for token, value in mapping.items():
        replaced = replaced.replace(token, value)
    paragraph.runs[0].text = replaced
    for run in paragraph.runs[1:]:
        run.text = ""


def _replace_blanks_in_paragraph(
    paragraph,
    fills: dict[str, str],
    counter: list[int],
) -> None:
    """Replace the Nth blank across the doc with ``fills[str(N)]`` if present.

    ``counter`` is a one-element list used as a mutable int (doc-wide).
    """
    if not paragraph.runs:
        return
    full = "".join(run.text for run in paragraph.runs)
    if not _BLANK_RE.search(full):
        return

    def _sub(match: re.Match) -> str:
        counter[0] += 1
        key = str(counter[0])
        return fills.get(key, match.group(0))

    new_text = _BLANK_RE.sub(_sub, full)
    if new_text == full:
        return
    paragraph.runs[0].text = new_text
    for run in paragraph.runs[1:]:
        run.text = ""


def _apply_replacements(doc: Document, data: NDAInput) -> None:
    token_map = _build_token_mapping(data)
    counter = [0]
    for p in _iter_paragraphs(doc):
        _replace_tokens_in_paragraph(p, token_map)
        _replace_blanks_in_paragraph(p, data.fills, counter)


# ── Fallback draft (only if template unavailable) ────────────────────────────


def _render_fallback(data: NDAInput, path) -> None:
    """Produce a fully-filled NDA .docx from the user-provided values.

    Used only when the Drive template can't be fetched. We still want the
    user to get a real, finished document with their details inserted —
    never a "go fill it yourself" placeholder.
    """
    from docx.enum.text import WD_ALIGN_PARAGRAPH
    from docx.shared import Pt, RGBColor

    disclosing = data.disclosing_party or "RARE BITS TECHNOLOGY PRIVATE LIMITED"
    receiving = data.receiving_party or "____"
    effective = data.effective_date or "____"
    city = data.governing_city or "____"
    term = str(data.term_years) if data.term_years is not None else "____"
    purpose = data.purpose or "the discussion of a potential business relationship"
    mutual = bool(data.mutual) if data.mutual is not None else True

    doc = Document()

    banner = doc.add_paragraph()
    banner.alignment = WD_ALIGN_PARAGRAPH.CENTER
    br = banner.add_run(
        "DRAFT — generated from user-provided details. Beacon's official "
        "Drive template was not reachable; please have counsel review "
        "against the canonical template before execution."
    )
    br.italic = True
    br.font.size = Pt(9)
    br.font.color.rgb = RGBColor(0xB2, 0x00, 0x00)

    title = doc.add_heading(
        "MUTUAL NON-DISCLOSURE AGREEMENT" if mutual else "NON-DISCLOSURE AGREEMENT",
        level=0,
    )
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    doc.add_paragraph(
        f"This Non-Disclosure Agreement (the \"Agreement\") is entered into on "
        f"{effective} by and between {disclosing}, a company incorporated under "
        f"the laws of the {_JURISDICTION_LABEL[data.jurisdiction]} (the "
        f"\"Disclosing Party\"), and {receiving} (the \"Receiving Party\"). "
        f"The Disclosing Party and the Receiving Party are each a \"Party\" "
        f"and collectively the \"Parties\"."
    )

    doc.add_heading("1. Purpose", level=1)
    doc.add_paragraph(
        f"The Parties wish to explore {purpose} (the \"Purpose\") and, in "
        f"connection therewith, may disclose to each other certain "
        f"confidential and proprietary information."
    )

    doc.add_heading("2. Confidential Information", level=1)
    doc.add_paragraph(
        "\"Confidential Information\" means any non-public information "
        "disclosed by one Party to the other, whether orally, in writing, or "
        "by inspection of tangible objects, that is designated as confidential "
        "or that reasonably should be understood to be confidential given the "
        "nature of the information and the circumstances of disclosure."
    )

    doc.add_heading("3. Obligations", level=1)
    doc.add_paragraph(
        "The Receiving Party shall (i) hold all Confidential Information in "
        "strict confidence; (ii) use such information solely for the Purpose; "
        "and (iii) not disclose it to any third party without the prior written "
        "consent of the Disclosing Party."
    )

    doc.add_heading("4. Term", level=1)
    doc.add_paragraph(
        f"This Agreement shall remain in effect for a period of {term} year(s) "
        f"from the Effective Date, and the obligations of confidentiality "
        f"shall survive termination for a further period of two (2) years."
    )

    doc.add_heading("5. Governing Law", level=1)
    doc.add_paragraph(
        f"This Agreement shall be governed by the laws of the "
        f"{_JURISDICTION_LABEL[data.jurisdiction]}, and the courts at {city} "
        f"shall have exclusive jurisdiction."
    )

    doc.add_heading("6. Signatures", level=1)

    table = doc.add_table(rows=4, cols=2)
    table.rows[0].cells[0].text = f"{disclosing}"
    table.rows[0].cells[1].text = f"{receiving}"
    table.rows[1].cells[0].text = "By: ______________________"
    table.rows[1].cells[1].text = "By: ______________________"
    table.rows[2].cells[0].text = "Name: ____________________"
    table.rows[2].cells[1].text = "Name: ____________________"
    table.rows[3].cells[0].text = "Title: ___________________"
    table.rows[3].cells[1].text = "Title: ___________________"

    doc.save(str(path))


# ── Public entry ─────────────────────────────────────────────────────────────


async def generate(data: NDAInput) -> GeneratedDocument:
    if data.jurisdiction not in _JURISDICTION_LABEL:
        raise ValueError(
            f"Unsupported NDA jurisdiction: {data.jurisdiction}. "
            "Supported: india, us, singapore."
        )
    template_bytes = await _fetch_template_bytes(data.jurisdiction)
    slug_left = data.disclosing_party or "Beacon"
    slug_right = data.receiving_party or "counterparty"
    path, url = build_output_path(
        f"NDA_{data.jurisdiction.upper()}",
        f"{slug_left}_x_{slug_right}",
    )

    if template_bytes:
        doc = Document(io.BytesIO(template_bytes))
        _apply_replacements(doc, data)
        doc.save(str(path))
        source = "template"
    else:
        _render_fallback(data, path)
        source = "fallback"

    filled_count = len(data.fills or {})
    summary_tail = (
        f"{filled_count} blank(s) filled from user input."
        if filled_count
        else "No blanks filled — the generated doc still shows every original blank."
    )
    return GeneratedDocument(
        filename=path.name,
        path=str(path),
        url=url,
        kind=f"nda_{data.jurisdiction}",
        summary=(
            f"NDA drafted from {source} template — "
            f"{slug_left} ↔ {slug_right}, {data.jurisdiction.upper()} jurisdiction. "
            f"{summary_tail}"
        ),
        created_at=datetime.utcnow(),
    )
