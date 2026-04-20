"""NDA generator — India, US (Delaware default), Singapore variants.

Clauses are hand-written so Zippy can draft a legally-shaped first draft even
without the Anthropic key. Claude is used only to adapt tone / fill in optional
clauses the user asked for in free-text. All drafts carry a visible banner
reminding the reader that this is a template, not legal advice.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Literal, Optional

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Pt, RGBColor

from app.services.zippy_docs.base import (
    GeneratedDocument,
    build_output_path,
    human_today,
)

logger = logging.getLogger(__name__)

Jurisdiction = Literal["india", "us", "singapore"]


@dataclass
class NDAInput:
    jurisdiction: Jurisdiction
    disclosing_party: str
    receiving_party: str
    # True = both sides protect each other's info. False = one-way to receiver.
    mutual: bool = True
    purpose: str = "evaluating a potential business relationship and associated commercial terms"
    term_years: int = 2
    effective_date: Optional[str] = None
    governing_city: Optional[str] = None
    extra_clauses: list[str] = field(default_factory=list)


_JURISDICTION_LABEL = {
    "india": "Republic of India",
    "us": "State of Delaware, United States of America",
    "singapore": "Republic of Singapore",
}

_DEFAULT_CITY = {
    "india": "Mumbai",
    "us": "Wilmington, Delaware",
    "singapore": "Singapore",
}

_DISPUTE_CLAUSE = {
    "india": (
        "Any dispute arising out of or in connection with this Agreement shall be "
        "referred to and finally resolved by arbitration under the Arbitration and "
        "Conciliation Act, 1996. The seat of arbitration shall be {city}, and the "
        "language shall be English. The courts at {city} shall have exclusive "
        "jurisdiction for any interim or ancillary relief."
    ),
    "us": (
        "Any dispute arising out of or relating to this Agreement shall be resolved "
        "exclusively in the state or federal courts located in {city}. The parties "
        "irrevocably consent to the personal jurisdiction and venue of such courts "
        "and waive any right to a jury trial."
    ),
    "singapore": (
        "Any dispute arising out of or in connection with this Agreement, including "
        "any question regarding its existence, validity or termination, shall be "
        "referred to and finally resolved by arbitration administered by the "
        "Singapore International Arbitration Centre (SIAC) in accordance with its "
        "Arbitration Rules for the time being in force. The seat of the arbitration "
        "shall be {city} and the language shall be English."
    ),
}

_DATA_PROTECTION_CLAUSE = {
    "india": (
        "Each party shall comply with the Digital Personal Data Protection Act, "
        "2023 and any applicable rules in its processing of personal data exchanged "
        "under this Agreement."
    ),
    "us": (
        "Each party shall comply with applicable data-protection laws, including, "
        "where relevant, the California Consumer Privacy Act, in connection with any "
        "personal information exchanged under this Agreement."
    ),
    "singapore": (
        "Each party shall comply with the Personal Data Protection Act 2012 (No. 26 "
        "of 2012) of Singapore in its collection, use, disclosure and handling of "
        "personal data exchanged under this Agreement."
    ),
}


def _today_formatted() -> str:
    return human_today()


def _build_clauses(data: NDAInput) -> list[tuple[str, str]]:
    """Return ``[(heading, body), ...]`` — ordered body of the NDA."""
    effective = data.effective_date or _today_formatted()
    city = data.governing_city or _DEFAULT_CITY[data.jurisdiction]
    jurisdiction_label = _JURISDICTION_LABEL[data.jurisdiction]
    mutual_label = "mutually" if data.mutual else "unilaterally (Disclosing Party → Receiving Party only)"

    clauses: list[tuple[str, str]] = [
        (
            "1. Parties & Effective Date",
            f"This Non-Disclosure Agreement (the \"Agreement\") is made effective on "
            f"{effective} between {data.disclosing_party} (\"Disclosing Party\") and "
            f"{data.receiving_party} (\"Receiving Party\"). Together, they are the "
            f'"Parties". The confidentiality obligations set out below apply {mutual_label}.',
        ),
        (
            "2. Purpose",
            f"The Parties intend to share Confidential Information solely for the purpose "
            f"of {data.purpose} (the \"Purpose\") and for no other reason without prior "
            f"written consent.",
        ),
        (
            "3. Confidential Information",
            "\"Confidential Information\" means all non-public information disclosed by "
            "one Party to the other, whether orally, in writing, or by observation, that "
            "is either marked as confidential or that a reasonable person would "
            "understand to be confidential. This includes, without limitation, product "
            "roadmaps, pricing, source code, customer lists, commercial terms, and "
            "know-how.",
        ),
        (
            "4. Obligations",
            "The Receiving Party shall (a) hold the Confidential Information in strict "
            "confidence, (b) use it only for the Purpose, (c) limit access to employees "
            "and advisors who have a genuine need to know and who are bound by "
            "confidentiality obligations no less protective than those herein, and "
            "(d) protect it using at least the same degree of care it uses for its own "
            "confidential information (and in no event less than a reasonable standard).",
        ),
        (
            "5. Exclusions",
            "The obligations in Clause 4 do not apply to information that (a) is or "
            "becomes publicly known through no fault of the Receiving Party, "
            "(b) was lawfully known to the Receiving Party before disclosure, "
            "(c) is independently developed without reference to the Confidential "
            "Information, or (d) is rightfully obtained from a third party without "
            "restriction.",
        ),
        (
            "6. Required Disclosure",
            "If the Receiving Party is compelled by law, regulation, or court order to "
            "disclose any Confidential Information, it shall (where legally permitted) "
            "give the Disclosing Party prompt prior notice so the Disclosing Party may "
            "seek a protective order or other appropriate remedy, and shall disclose only "
            "the minimum information required.",
        ),
        (
            "7. Term & Return of Materials",
            f"This Agreement remains in force for {data.term_years} years from the "
            f"Effective Date. The confidentiality obligations survive expiry for a further "
            "three (3) years. On written request or upon termination, the Receiving "
            "Party shall promptly return or destroy all Confidential Information in its "
            "possession, subject to routine backup retention.",
        ),
        (
            "8. No Licence",
            "No licence or right (express or implied) is granted under any patent, "
            "copyright, trade mark, or other intellectual property right by this "
            "Agreement. All Confidential Information remains the property of the "
            "Disclosing Party.",
        ),
        (
            "9. Remedies",
            "The Parties acknowledge that money damages may be insufficient to remedy a "
            "breach and that the Disclosing Party is entitled to seek injunctive relief "
            "in addition to any other remedies available at law or in equity.",
        ),
        (
            "10. Data Protection",
            _DATA_PROTECTION_CLAUSE[data.jurisdiction],
        ),
        (
            f"11. Governing Law",
            f"This Agreement is governed by and construed in accordance with the laws of "
            f"the {jurisdiction_label}, without regard to its conflict-of-laws principles.",
        ),
        (
            "12. Dispute Resolution",
            _DISPUTE_CLAUSE[data.jurisdiction].format(city=city),
        ),
        (
            "13. General",
            "This Agreement contains the entire agreement between the Parties on its "
            "subject matter and supersedes all prior communications. No amendment is "
            "effective unless in writing and signed by both Parties. If any provision is "
            "held unenforceable, the remainder shall continue in full force. This "
            "Agreement may be executed in counterparts, including by electronic signature.",
        ),
    ]

    for idx, extra in enumerate(data.extra_clauses, start=len(clauses) + 1):
        clauses.append((f"{idx}. Additional Provision", extra))

    return clauses


def _render_docx(data: NDAInput, clauses: list[tuple[str, str]], path) -> None:
    doc = Document()

    # Disclaimer banner
    banner = doc.add_paragraph()
    banner.alignment = WD_ALIGN_PARAGRAPH.CENTER
    banner_run = banner.add_run(
        "TEMPLATE DRAFT — not legal advice. Please have qualified counsel review "
        "before signature."
    )
    banner_run.bold = True
    banner_run.font.size = Pt(9)
    banner_run.font.color.rgb = RGBColor(0xB2, 0x4A, 0x00)

    # Title
    title = doc.add_heading("MUTUAL NON-DISCLOSURE AGREEMENT" if data.mutual else "NON-DISCLOSURE AGREEMENT", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in title.runs:
        run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)

    subtitle = doc.add_paragraph(
        f"{data.disclosing_party} ↔ {data.receiving_party}  |  "
        f"Governed by {_JURISDICTION_LABEL[data.jurisdiction]}"
    )
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    for run in subtitle.runs:
        run.italic = True
        run.font.size = Pt(10)

    doc.add_paragraph()

    for heading, body in clauses:
        h = doc.add_heading(heading, level=2)
        for run in h.runs:
            run.font.color.rgb = RGBColor(0x17, 0x4A, 0x8B)
        doc.add_paragraph(body)

    doc.add_paragraph()
    signature_table = doc.add_table(rows=1, cols=2)
    signature_table.style = "Light Grid Accent 1"
    sig_cells = signature_table.rows[0].cells
    sig_cells[0].text = (
        f"For and on behalf of\n{data.disclosing_party}\n\n"
        "______________________\nName:\nTitle:\nDate:"
    )
    sig_cells[1].text = (
        f"For and on behalf of\n{data.receiving_party}\n\n"
        "______________________\nName:\nTitle:\nDate:"
    )

    footer = doc.add_paragraph()
    footer_run = footer.add_run(
        f"\nGenerated by Zippy on {datetime.utcnow().strftime('%d %b %Y %H:%M UTC')}"
    )
    footer_run.italic = True
    footer_run.font.size = Pt(9)
    footer_run.font.color.rgb = RGBColor(0x8A, 0x8A, 0x8A)

    doc.save(str(path))


async def generate(data: NDAInput) -> GeneratedDocument:
    if data.jurisdiction not in _JURISDICTION_LABEL:
        raise ValueError(
            f"Unsupported NDA jurisdiction: {data.jurisdiction}. "
            "Supported: india, us, singapore."
        )
    clauses = _build_clauses(data)
    kind = f"NDA_{data.jurisdiction.upper()}"
    path, url = build_output_path(kind, f"{data.disclosing_party}_x_{data.receiving_party}")
    _render_docx(data, clauses, path)
    return GeneratedDocument(
        filename=path.name,
        path=str(path),
        url=url,
        kind=f"nda_{data.jurisdiction}",
        summary=(
            f"{'Mutual' if data.mutual else 'One-way'} NDA drafted — "
            f"{data.disclosing_party} and {data.receiving_party}, "
            f"{data.jurisdiction.upper()} jurisdiction."
        ),
        created_at=datetime.utcnow(),
    )
