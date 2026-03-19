"""
Azure OpenAI client wrapper.

Used across the CRM wherever AI reasoning is needed:
  - Persona classification (beyond keyword matching)
  - Deal health narrative ("why is this deal red?")
  - Pre-meeting account intelligence summary
  - Email draft generation (MoM, follow-ups)
  - Objection handling suggestions

Mock mode: returns None when AZURE_OPENAI_API_KEY is empty.
"""
import logging
from typing import Optional

from app.config import settings

logger = logging.getLogger(__name__)


class AzureOpenAIClient:
    def __init__(self) -> None:
        self.api_key = settings.AZURE_OPENAI_API_KEY
        self.mock = not self.api_key

    def _get_client(self):
        from openai import AzureOpenAI
        return AzureOpenAI(
            api_key=self.api_key,
            azure_endpoint=settings.AZURE_OPENAI_ENDPOINT,
            api_version=settings.AZURE_OPENAI_API_VERSION,
        )

    async def complete(self, system: str, user: str, max_tokens: int = 500) -> Optional[str]:
        """Single-turn completion. Returns None in mock mode."""
        if self.mock:
            return None

        try:
            client = self._get_client()
            response = client.chat.completions.create(
                model=settings.AZURE_OPENAI_DEPLOYMENT,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                max_tokens=max_tokens,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception as e:
            logger.error(f"Azure OpenAI call failed: {e}")
            return None

    async def classify_persona(self, title: str, company_context: str = "") -> Optional[str]:
        """AI-powered persona classification when title keywords are ambiguous."""
        if self.mock:
            return None

        system = (
            "You are a B2B sales expert. Classify the job title into exactly one of: "
            "economic_buyer, champion, technical_evaluator, unknown. "
            "Respond with only the classification word, nothing else."
        )
        user = f"Job title: {title}\nCompany context: {company_context}"
        return await self.complete(system, user, max_tokens=10)

    async def summarise_account(self, company_name: str, news_signals: list, tech_stack: dict) -> Optional[str]:
        """Generate a pre-meeting account intelligence summary."""
        if self.mock:
            return None

        news_text = "\n".join(f"- {a['title']}" for a in news_signals[:5]) or "No recent news."
        tech_text = ", ".join(f"{k}: {v}" for k, v in (tech_stack or {}).items()) or "Unknown"

        system = "You are a sales intelligence analyst. Write a concise 3-bullet account brief for a sales rep going into a first meeting."
        user = (
            f"Company: {company_name}\n"
            f"Recent news:\n{news_text}\n"
            f"Tech stack: {tech_text}\n"
            "Write 3 bullet points covering: key business context, buying signals, and suggested conversation angle."
        )
        return await self.complete(system, user, max_tokens=300)

    async def resolve_domain(
        self,
        company_name: str,
        industry: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[str]:
        """
        Use GPT-4o to infer the most likely website domain for a company.
        Returns a bare domain like 'acmecorp.com', or None if not confident.
        """
        if self.mock:
            return None

        context_parts = [f"Company name: {company_name}"]
        if industry:
            context_parts.append(f"Industry: {industry}")
        if description:
            context_parts.append(f"Description: {description[:300]}")

        system = (
            "You are a B2B sales researcher. Given a company name and optional metadata, "
            "return the most likely primary website domain (e.g. 'acmecorp.com'). "
            "Rules: respond with ONLY the bare domain — no https://, no www, no path, no punctuation. "
            "If you are not confident (>80%) in the answer, respond with exactly: null"
        )
        user = "\n".join(context_parts)
        result = await self.complete(system, user, max_tokens=30)

        if not result or result.strip().lower() in ("null", "none", "unknown", ""):
            return None

        # Strip any accidental protocol or www prefix the model may have added
        domain = result.strip().lower()
        for prefix in ("https://", "http://", "www."):
            if domain.startswith(prefix):
                domain = domain[len(prefix):]
        domain = domain.split("/")[0].strip()

        # Basic sanity check — must look like a domain
        if "." not in domain or len(domain) > 100:
            return None

        return domain

    async def draft_followup_email(self, contact_name: str, company_name: str, meeting_summary: str) -> Optional[str]:
        """Draft a post-meeting follow-up email."""
        if self.mock:
            return None

        system = "You are a senior enterprise sales rep. Write professional, concise follow-up emails."
        user = (
            f"Write a follow-up email to {contact_name} at {company_name}.\n"
            f"Meeting summary: {meeting_summary}\n"
            "Include: thank you, key takeaways (2-3 bullets), agreed next steps, and a soft CTA."
        )
        return await self.complete(system, user, max_tokens=400)
