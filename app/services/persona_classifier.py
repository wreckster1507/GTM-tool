"""
Persona classifier — maps contact title + seniority to one of:
  economic_buyer | champion | technical_evaluator | unknown
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.contact import Contact

_ECONOMIC_BUYER = [
    "ceo", "cfo", "coo", "president", "chief executive", "chief financial",
    "chief operating", "vp finance", "vp of finance", "director of finance",
    "founder", "owner", "managing director", "general manager",
]
_CHAMPION = [
    "chro", "chief people", "vp hr", "vp of hr", "vp people", "vp of people",
    "head of hr", "head of people", "director of hr", "hr director",
    "people operations", "hr manager", "director of people", "talent acquisition",
    "learning",
]
_TECHNICAL_EVALUATOR = [
    "cto", "chief technology", "vp engineering", "vp of engineering",
    "director of engineering", "head of engineering", "solution architect",
    "it director", "it manager", "technical lead", "tech lead",
    "staff engineer", "principal engineer", "devops", "platform",
]


def classify_persona(contact: "Contact") -> str:
    title = (contact.title or "").lower()

    if any(t in title for t in _ECONOMIC_BUYER):
        return "economic_buyer"

    if any(t in title for t in _CHAMPION):
        return "champion"

    if any(t in title for t in _TECHNICAL_EVALUATOR):
        return "technical_evaluator"

    # Fallback: use seniority level when title is ambiguous
    seniority = (contact.seniority or "").lower()
    if seniority in ("c_suite", "csuite", "c-suite", "founder", "owner"):
        return "economic_buyer"
    if seniority in ("vp", "director") and not title:
        return "economic_buyer"

    return "unknown"
