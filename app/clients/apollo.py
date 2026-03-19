"""
Apollo.io client — company enrichment and contact search.

Real mode: uses Hunter's Company Enrichment API (same key) when
APOLLO_API_KEY is empty but HUNTER_API_KEY is set.
Mock mode: returns Faker data when both keys are empty.
"""
import random
from typing import Optional

from app.config import settings

try:
    from faker import Faker
    _fake = Faker()
    _HAS_FAKER = True
except ImportError:
    _HAS_FAKER = False

_INDUSTRIES = ["HR Tech", "FinTech", "HealthTech", "SaaS", "EdTech", "PropTech", "LegalTech"]
_VERTICALS = ["HCM", "Payroll", "Recruitment", "Banking", "Insurance", "EHR", "LMS"]
_FUNDING = ["Seed", "Series A", "Series B", "Series C", "Series D"]
_DAP_TOOLS = ["WalkMe", "Pendo", "Appcues", "UserGuiding", "Intercom", "Gainsight PX"]
_TITLES = [
    "VP of HR", "CTO", "CFO", "Head of Engineering", "Director of People Ops",
    "CHRO", "VP Finance", "CEO", "CIO", "Director of IT",
]


def _parse_hunter_size(size_str: Optional[str]) -> Optional[int]:
    """
    Convert Hunter's employee-range string to an integer (upper bound).

    Examples: "51-200" → 200, "1001-5000" → 5000, "10001+" → 10001
    Returning the upper bound gives companies the benefit of the doubt in ICP scoring.
    """
    if not size_str:
        return None
    if "+" in size_str:
        try:
            return int(size_str.replace("+", "").strip())
        except ValueError:
            return None
    parts = size_str.split("-")
    if len(parts) == 2:
        try:
            return int(parts[1])
        except ValueError:
            pass
    try:
        return int(size_str)
    except ValueError:
        return None


class ApolloClient:
    def __init__(self) -> None:
        self.api_key = settings.APOLLO_API_KEY
        self.hunter_key = settings.HUNTER_API_KEY
        # Use Hunter as real source if Apollo key is absent but Hunter key exists
        self.mock = not self.api_key and not self.hunter_key

    async def enrich_company(self, domain: str) -> Optional[dict]:
        """Return firmographic data for a domain."""
        if self.mock:
            return self._mock_company(domain)

        if self.hunter_key and not self.api_key:
            return await self._enrich_via_hunter(domain)

        # Real Apollo call (when APOLLO_API_KEY is set)
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.apollo.io/v1/organizations/enrich",
                headers={"X-Api-Key": self.api_key, "Content-Type": "application/json"},
                json={"domain": domain},
            )
            resp.raise_for_status()
            org = resp.json().get("organization", {})
            return {
                "name": org.get("name"),
                "industry": org.get("industry"),
                "employee_count": org.get("estimated_num_employees"),
                "funding_stage": org.get("latest_funding_stage"),
                "has_dap": False,
                "dap_tool": None,
            }

    async def find_contacts(self, domain: str, limit: int = 5) -> list:
        """Return a list of contacts at the domain."""
        if self.mock:
            return self._mock_contacts(domain, limit)
        return []

    # ── Hunter fallback ────────────────────────────────────────────────────────

    async def _enrich_via_hunter(self, domain: str) -> Optional[dict]:
        """Call Hunter's /companies/find endpoint for firmographics."""
        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://api.hunter.io/v2/companies/find",
                params={"domain": domain, "api_key": self.hunter_key},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json().get("data", {})

        if not data:
            return None

        return {
            "name": data.get("name"),
            "industry": data.get("industry"),
            "vertical": None,
            "employee_count": _parse_hunter_size(data.get("size")),
            "arr_estimate": None,
            "funding_stage": data.get("funding_stage"),
            "has_dap": False,
            "dap_tool": None,
        }

    # ── mock helpers ──────────────────────────────────────────────────────────

    def _mock_company(self, domain: str) -> dict:
        if not _HAS_FAKER:
            return {}
        has_dap = random.random() > 0.45
        emp = random.choice([45, 120, 280, 650, 1400, 3500])
        return {
            "name": domain.split(".")[0].replace("-", " ").title(),
            "industry": random.choice(_INDUSTRIES),
            "vertical": random.choice(_VERTICALS),
            "employee_count": emp,
            "arr_estimate": random.choice([400_000, 1_500_000, 6_000_000, 20_000_000, 80_000_000]),
            "funding_stage": random.choice(_FUNDING),
            "has_dap": has_dap,
            "dap_tool": random.choice(_DAP_TOOLS) if has_dap else None,
        }

    def _mock_contacts(self, domain: str, limit: int) -> list:
        if not _HAS_FAKER:
            return []
        return [
            {
                "first_name": _fake.first_name(),
                "last_name": _fake.last_name(),
                "email": f"{_fake.user_name()}@{domain}",
                "title": random.choice(_TITLES),
                "seniority": "vp",
                "linkedin_url": f"https://linkedin.com/in/{_fake.user_name()}",
            }
            for _ in range(min(limit, 3))
        ]
