"""
News client — funding and signal intelligence using Google News RSS.

No API key required. Uses Google News RSS feed with structured queries
so Google's entity recognition finds the right company (not just the word).

Signals classified:
  - funding_signals: Series rounds, raised, investment, IPO, acquisition
  - pr_signals:      product launches, partnerships, hiring, press mentions
"""
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from typing import Optional
from urllib.parse import quote

import httpx

_GOOGLE_NEWS_RSS = "https://news.google.com/rss/search"

_FUNDING_KEYWORDS = [
    "series a", "series b", "series c", "series d", "series e", "series f",
    "series g", "series h",
    # Use word-boundary padding (spaces) so "raised" ≠ "upraised", "fund" ≠ "fuels"
    " raised ", " raises ", "funding round", "investment round",
    "venture capital", "seed round", " ipo ", "acquisition", "valuation",
    "led the round", "closes funding", "secures funding", "raises $",
    "raises funding", "pre-ipo",
]


class NewsClient:
    def __init__(self) -> None:
        # No API key needed — Google News RSS is free and open
        self.mock = False

    async def get_company_signals(self, company_name: str, domain: str) -> Optional[dict]:
        """
        Fetch recent Google News articles for a company and classify signals.
        Uses domain root as disambiguation so Google finds the right entity.
        """
        domain_root = domain.split(".")[0]

        # Query: exact company name + industry hint forces entity match
        # e.g. "Rippling" rippling software  →  Google understands it's the HR company
        query = f'"{company_name}" {domain_root} software'
        encoded = quote(query)

        url = f"{_GOOGLE_NEWS_RSS}?q={encoded}&hl=en&gl=US&ceid=US:en"

        async with httpx.AsyncClient(
            timeout=10,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; BeaconCRM/1.0)"},
        ) as client:
            resp = await client.get(url)
            resp.raise_for_status()

        items = _parse_rss(resp.text)
        if not items:
            return None

        funding_hits = []
        pr_hits = []

        for item in items:
            text = f" {item['title']} {item.get('description', '')} ".lower()

            # Skip if neither the company name nor domain root appears
            if company_name.lower() not in text and domain_root.lower() not in text:
                continue

            if any(kw in text for kw in _FUNDING_KEYWORDS):
                funding_hits.append(item)
            else:
                pr_hits.append(item)

        relevant = funding_hits + pr_hits
        if not relevant:
            return None

        return {
            "company": company_name,
            "total_articles": len(relevant),
            "funding_signals": funding_hits,
            "pr_signals": pr_hits,
            "has_funding_news": len(funding_hits) > 0,
        }


def _parse_rss(xml_text: str) -> list[dict]:
    """Parse Google News RSS XML into a list of article dicts."""
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return []

    channel = root.find("channel")
    if channel is None:
        return []

    articles = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        pub_date = item.findtext("pubDate") or ""
        source_el = item.find("source")
        source_name = source_el.text if source_el is not None else ""
        description = (item.findtext("description") or "").strip()

        # Parse RFC-2822 date → ISO format
        try:
            published_at = parsedate_to_datetime(pub_date).isoformat()
        except Exception:
            published_at = pub_date

        articles.append({
            "title": title,
            "url": link,
            "source": source_name,
            "published_at": published_at,
            "description": description,
        })

    return articles
