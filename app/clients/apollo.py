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

    async def search_people(
        self,
        domain: str,
        limit: int = 5,
        titles: list[str] | None = None,
        seniorities: list[str] | None = None,
    ) -> list[dict]:
        """
        Search for contacts at a domain using Apollo people search endpoints.

        Tries endpoints in order of preference, falling back if one returns 403:
          1. mixed_people/search (best, searches global DB)
          2. people/search (alternative global search)
          3. contacts/search (searches saved Apollo CRM contacts only)

        Credit-conservative: limits results and uses targeted filters.
        """
        if self.mock:
            return self._mock_contacts(domain, limit)

        if not self.api_key:
            return []

        import httpx
        import logging
        logger = logging.getLogger(__name__)

        headers = {"X-Api-Key": self.api_key, "Content-Type": "application/json"}

        # ── Attempt 1: mixed_people/search ──────────────────────────────────
        body: dict = {
            "q_organization_domains": domain,
            "page": 1,
            "per_page": min(limit, 10),
        }
        if titles:
            body["person_titles"] = titles
        if seniorities:
            body["person_seniorities"] = seniorities

        async with httpx.AsyncClient(timeout=15) as client:
            try:
                resp = await client.post(
                    "https://api.apollo.io/v1/mixed_people/search",
                    headers=headers, json=body,
                )
                if resp.status_code == 403:
                    logger.info("mixed_people/search not enabled, trying people/search")
                else:
                    resp.raise_for_status()
                    people = resp.json().get("people", [])
                    return self._normalize_people(people)
            except httpx.HTTPStatusError:
                logger.info("mixed_people/search failed, trying fallback")

            # ── Attempt 2: people/search ────────────────────────────────────
            try:
                resp = await client.post(
                    "https://api.apollo.io/v1/people/search",
                    headers=headers, json=body,
                )
                if resp.status_code == 403:
                    logger.info("people/search not enabled, trying contacts/search")
                else:
                    resp.raise_for_status()
                    people = resp.json().get("people", [])
                    return self._normalize_people(people)
            except httpx.HTTPStatusError:
                logger.info("people/search failed, trying contacts/search")

            # ── Attempt 3: contacts/search (saved CRM contacts) ─────────────
            try:
                contacts_body: dict = {
                    "q_organization_domains": domain,
                    "page": 1,
                    "per_page": min(limit, 10),
                }
                resp = await client.post(
                    "https://api.apollo.io/v1/contacts/search",
                    headers=headers, json=contacts_body,
                )
                if resp.status_code == 403:
                    logger.warning("No Apollo people search endpoint is enabled")
                    return []
                resp.raise_for_status()
                contacts = resp.json().get("contacts", [])
                return self._normalize_people(contacts)
            except httpx.HTTPStatusError:
                logger.warning("All Apollo people search endpoints failed")
                return []

    def _normalize_people(self, people: list) -> list[dict]:
        """Normalize Apollo people/contacts response into a standard format."""
        return [
            {
                "first_name": p.get("first_name") or "",
                "last_name": p.get("last_name") or "",
                "email": p.get("email") or None,
                "title": p.get("title") or None,
                "seniority": p.get("seniority") or None,
                "linkedin_url": p.get("linkedin_url") or None,
                "phone": p.get("phone_numbers", [{}])[0].get("sanitized_number") if p.get("phone_numbers") else None,
                "organization_name": p.get("organization", {}).get("name") if p.get("organization") else None,
            }
            for p in people
        ]

    async def enrich_person(self, email: str = "", first_name: str = "", last_name: str = "", domain: str = "") -> dict | None:
        """
        Single-contact enrichment via Apollo people/match.
        Used by re-enrich for individual contacts.
        """
        if self.mock:
            contacts = self._mock_contacts(domain or "example.com", 1)
            return contacts[0] if contacts else None

        if not self.api_key:
            return None

        import httpx

        body: dict = {}
        if email:
            body["email"] = email
        if first_name:
            body["first_name"] = first_name
        if last_name:
            body["last_name"] = last_name
        if domain:
            body["organization_domain"] = domain

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                "https://api.apollo.io/v1/people/match",
                headers={"X-Api-Key": self.api_key, "Content-Type": "application/json"},
                json=body,
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            person = resp.json().get("person")
            if not person:
                return None

        return {
            "first_name": person.get("first_name", ""),
            "last_name": person.get("last_name", ""),
            "email": person.get("email"),
            "title": person.get("title"),
            "seniority": person.get("seniority"),
            "linkedin_url": person.get("linkedin_url"),
            "phone": person.get("phone_numbers", [{}])[0].get("sanitized_number") if person.get("phone_numbers") else None,
            "headline": person.get("headline"),
            "employment_history": person.get("employment_history", [])[:3],
        }

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
