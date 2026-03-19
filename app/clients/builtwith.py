"""
BuiltWith client — technology stack detection.

Mock mode returns a realistic random tech stack when BUILTWITH_API_KEY is empty.
"""
import random
from typing import Optional

from app.config import settings

_TECH_POOLS: dict[str, list[str]] = {
    "crm": ["Salesforce", "HubSpot", "Pipedrive", "Zoho CRM"],
    "hris": ["Workday", "BambooHR", "SAP SuccessFactors", "Oracle HCM", "ADP"],
    "ats": ["Greenhouse", "Lever", "Workable", "SmartRecruiters"],
    "analytics": ["Mixpanel", "Amplitude", "Segment", "Google Analytics 4"],
    "support": ["Zendesk", "Intercom", "Freshdesk", "ServiceNow"],
    "communication": ["Slack", "Microsoft Teams", "Zoom"],
    "dap": ["WalkMe", "Pendo", "Appcues", "UserGuiding"],
}


class BuiltWithClient:
    def __init__(self) -> None:
        self.api_key = settings.BUILTWITH_API_KEY
        self.mock = not self.api_key

    async def get_tech_stack(self, domain: str) -> Optional[dict]:
        """Return the detected technology stack for a domain."""
        if self.mock:
            return self._mock_tech_stack(domain)
        # Real call: GET https://api.builtwith.com/v21/api.json
        # Params: {"KEY": self.api_key, "LOOKUP": domain}
        return None

    def _mock_tech_stack(self, domain: str) -> dict:
        # Randomly pick ~40–70% of categories to simulate realistic detection
        selected: dict[str, str] = {}
        for category, tools in _TECH_POOLS.items():
            if random.random() > 0.45:
                selected[category] = random.choice(tools)
        return {
            "domain": domain,
            "tech_stack": selected,
            "detected_at": "mock",
        }
