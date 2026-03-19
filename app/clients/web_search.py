"""
Web research client — company website scraping + DuckDuckGo.

Sources (all free, no API key):
  - Company's own website: fetches homepage + /about, extracts key text,
    then uses GPT-4o to produce a clean company background summary.
  - DuckDuckGo: free text search for recent news and milestones.

Used by the pre-meeting intelligence pipeline.
"""
from __future__ import annotations

import asyncio
import logging
import re
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

_SCRAPE_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
}


class WebSearchClient:
    # ── DuckDuckGo ────────────────────────────────────────────────────────────

    async def search(self, query: str, max_results: int = 5) -> list[dict]:
        """
        DuckDuckGo web search. Runs the synchronous DDGS library in a thread
        pool to avoid blocking the async event loop.
        Returns list of {title, url, snippet}.
        """
        try:
            from duckduckgo_search import DDGS

            def _run() -> list[dict]:
                results = []
                with DDGS() as ddgs:
                    for r in ddgs.text(query, max_results=max_results):
                        results.append({
                            "title": r.get("title", ""),
                            "url": r.get("href", ""),
                            "snippet": r.get("body", ""),
                        })
                return results

            return await asyncio.to_thread(_run)
        except Exception as e:
            logger.warning(f"DuckDuckGo search failed for '{query}': {e}")
            return []

    async def recent_news(self, company_name: str, domain: str) -> list[dict]:
        """Recent funding rounds, launches, PR — tries exact name then broad."""
        query = f'"{company_name}" funding OR acquisition OR launch OR partnership 2024 OR 2025'
        results = await self.search(query, max_results=5)
        if not results:
            results = await self.search(
                f"{company_name} news funding launch 2024 2025", max_results=5
            )
        return results

    async def company_milestones(self, company_name: str) -> list[dict]:
        """Company history and milestone search."""
        query = f"{company_name} company history milestones founded"
        return await self.search(query, max_results=4)

    # ── Company website scraping + GPT-4o summary ─────────────────────────────

    async def company_website_summary(
        self, domain: str, company_name: str, ai_client
    ) -> Optional[dict]:
        """
        Scrape the company's own website (homepage + /about) and use GPT-4o
        to produce a clean 3-4 sentence company background summary.

        Returns {title, description, extract, url, founded} or None on failure.
        """
        if not domain or domain.endswith(".unknown"):
            return None

        base_url = f"https://{domain}"
        pages_to_try = [base_url, f"{base_url}/about", f"{base_url}/company"]

        raw_text = ""
        source_url = base_url

        async with httpx.AsyncClient(
            timeout=12,
            follow_redirects=True,
            headers=_SCRAPE_HEADERS,
        ) as client:
            for url in pages_to_try:
                text = await _fetch_page_text(client, url)
                if text and len(text) > 100:
                    raw_text += f"\n\n[{url}]\n{text}"
                    source_url = url
                    if len(raw_text) > 3000:
                        break

        if not raw_text.strip():
            logger.warning(f"Could not scrape any content from {domain}")
            return None

        # Trim to avoid huge GPT-4o context
        raw_text = raw_text[:4000]

        # Ask GPT-4o to extract structured company info
        system = (
            "You are a B2B sales researcher. Given raw website text, extract a concise "
            "company profile. Respond ONLY in this exact format:\n"
            "DESCRIPTION: <one sentence describing what the company does>\n"
            "EXTRACT: <2-3 sentences covering the company's core product, target customers, "
            "and key differentiator. Be specific, not generic.>\n"
            "FOUNDED: <year or blank>\n"
            "If you cannot determine a field, leave it blank after the colon."
        )
        user = (
            f"Company: {company_name}\nWebsite: {domain}\n\n"
            f"Raw page content:\n{raw_text}"
        )

        try:
            response = await ai_client.complete(system, user, max_tokens=300)
            if not response:
                return None
            return _parse_ai_company_profile(response, company_name, source_url)
        except Exception as e:
            logger.warning(f"GPT-4o company summary failed for {domain}: {e}")
            return None


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _fetch_page_text(client: httpx.AsyncClient, url: str) -> str:
    """Fetch a URL and return visible text content (no nav/footer noise)."""
    try:
        resp = await client.get(url)
        if resp.status_code not in (200, 201):
            return ""
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(resp.text, "html.parser")

        # Remove noise elements
        for tag in soup(["script", "style", "nav", "footer", "header",
                          "noscript", "iframe", "aside"]):
            tag.decompose()

        # Prefer <main> or <article> if available for denser signal
        main = soup.find("main") or soup.find("article") or soup
        text = main.get_text(separator=" ", strip=True)

        # Collapse whitespace
        text = re.sub(r"\s{2,}", " ", text)
        return text[:2000]
    except Exception as e:
        logger.debug(f"Page fetch failed for {url}: {e}")
        return ""


def _parse_ai_company_profile(response: str, company_name: str, url: str) -> dict:
    """Parse the structured GPT-4o response into a company background dict."""
    lines = {
        k.strip().upper(): v.strip()
        for line in response.strip().splitlines()
        if ":" in line
        for k, v in [line.split(":", 1)]
    }
    return {
        "title": company_name,
        "description": lines.get("DESCRIPTION", ""),
        "extract": lines.get("EXTRACT", ""),
        "url": url,
        "founded": lines.get("FOUNDED") or None,
    }


def _extract_founded(text: str) -> Optional[str]:
    """Pull founding year from raw text."""
    match = re.search(
        r"founded in (\d{4})|incorporated in (\d{4})|established in (\d{4})", text, re.I
    )
    if match:
        return match.group(1) or match.group(2) or match.group(3)
    match = re.search(r"\b(19[5-9]\d|20[0-2]\d)\b", text)
    return match.group(1) if match else None
