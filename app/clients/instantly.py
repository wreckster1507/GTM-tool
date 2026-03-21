"""
Instantly.ai client — email outreach campaigns.

Placeholder implementation: all methods return mock data when
INSTANTLY_API_KEY is empty. Real API integration to follow.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


class InstantlyClient:
    def __init__(self) -> None:
        self.api_key = settings.INSTANTLY_API_KEY
        self.mock = not self.api_key
        self.base_url = "https://api.instantly.ai/api/v1"

    async def add_lead(
        self,
        campaign_id: str,
        email: str,
        first_name: str = "",
        last_name: str = "",
        company_name: str = "",
        custom_variables: dict | None = None,
    ) -> dict:
        """Add a lead to an Instantly campaign."""
        if self.mock:
            logger.info(f"[MOCK] Would add lead {email} to campaign {campaign_id}")
            return {
                "status": "mock",
                "email": email,
                "campaign_id": campaign_id,
                "message": "Instantly API key not configured — lead not sent",
            }

        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            payload = {
                "api_key": self.api_key,
                "campaign_id": campaign_id,
                "email": email,
                "first_name": first_name,
                "last_name": last_name,
                "company_name": company_name,
                "custom_variables": custom_variables or {},
            }
            resp = await client.post(f"{self.base_url}/lead/add", json=payload)
            resp.raise_for_status()
            return resp.json()

    async def list_campaigns(self) -> list[dict]:
        """List all campaigns."""
        if self.mock:
            return [{"id": "mock-campaign-1", "name": "Mock Campaign", "status": "active"}]

        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self.base_url}/campaign/list",
                params={"api_key": self.api_key},
            )
            resp.raise_for_status()
            return resp.json()

    async def get_campaign_status(self, campaign_id: str) -> Optional[dict]:
        """Get campaign summary/status."""
        if self.mock:
            return {
                "id": campaign_id,
                "name": "Mock Campaign",
                "status": "active",
                "leads_count": 0,
                "sent_count": 0,
                "reply_count": 0,
            }

        import httpx
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{self.base_url}/campaign/get",
                params={"api_key": self.api_key, "campaign_id": campaign_id},
            )
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
