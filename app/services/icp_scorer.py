"""
ICP (Ideal Customer Profile) scoring engine.

Scores companies 0–100 across 5 dimensions and maps to tiers:
  hot (75+) | warm (50–74) | monitor (25–49) | cold (0–24)
"""
from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.company import Company


def score_company(company: "Company") -> tuple[int, str]:
    """Return (score 0-100, tier string) for the given company."""
    score = 0

    # 1. Employee count — sweet spot for Beacon is 200–1000 (30 pts max)
    emp = company.employee_count or 0
    if 201 <= emp <= 1000:
        score += 30
    elif 51 <= emp <= 200:
        score += 22
    elif 1001 <= emp <= 5000:
        score += 18
    elif 11 <= emp <= 50:
        score += 10
    elif emp > 5000:
        score += 12

    # 2. Funding stage (25 pts max)
    funding = (company.funding_stage or "").lower()
    if any(s in funding for s in ["series b", "series c", "series d", "series e", "growth"]):
        score += 25
    elif "series a" in funding:
        score += 18
    elif any(s in funding for s in ["seed", "angel", "pre-seed"]):
        score += 10
    elif funding:
        score += 4

    # 3. Has DAP already — signals they invest in implementation tooling (20 pts)
    if company.has_dap:
        score += 20

    # 4. Industry fit (15 pts max)
    industry = (company.industry or "").lower()
    vertical = (company.vertical or "").lower()
    icp_industries = [
        "hr", "human resource", "hcm", "fintech", "finance",
        "healthtech", "health", "edtech", "saas", "enterprise software",
        "payroll", "recruitment",
    ]
    if any(i in industry or i in vertical for i in icp_industries):
        score += 15
    elif industry or vertical:
        score += 5

    # 5. Tech stack signals — proves they can budget for tooling (10 pts)
    tech = company.tech_stack
    if isinstance(tech, dict) and tech:
        score += 10
    elif isinstance(tech, list) and tech:
        score += 10

    score = min(score, 100)

    if score >= 75:
        tier = "hot"
    elif score >= 50:
        tier = "warm"
    elif score >= 25:
        tier = "monitor"
    else:
        tier = "cold"

    return score, tier
