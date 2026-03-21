"""
Knowledge Base context injection for AI prompts.

Provides a single function that any AI service can call to get formatted
resource snippets relevant to the current module and (optionally) industry.

Usage in any service:
    from app.services.knowledge_context import get_knowledge_context
    kb_context = await get_knowledge_context(session, "pre_meeting", limit=5)
    # → returns a formatted string block ready to inject into a GPT/Claude prompt
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

# Category labels for prompt formatting
_CATEGORY_LABELS = {
    "roi_template": "ROI Framework",
    "case_study": "Customer Case Study",
    "competitive_intel": "Competitive Intelligence",
    "product_info": "Product Information",
    "pricing": "Pricing Guide",
    "objection_handling": "Objection Handling",
    "email_template": "Email Template",
    "playbook": "Sales Playbook",
    "other": "Reference Material",
}


async def get_knowledge_context(
    session: AsyncSession,
    module: str,
    *,
    limit: int = 5,
    max_chars_per_resource: int = 800,
    max_total_chars: int = 3000,
) -> str:
    """
    Fetch active resources tagged for `module` and format them as a prompt block.

    Returns empty string if no resources are found (callers can safely append).
    Truncates individual resources and total output to stay within token budget.
    """
    try:
        from app.repositories.sales_resource import SalesResourceRepository

        repo = SalesResourceRepository(session)
        resources = await repo.for_module(module, limit=limit)

        if not resources:
            return ""

        lines = ["\n\n--- SALES KNOWLEDGE BASE (internal resources) ---"]
        total = 0

        for r in resources:
            label = _CATEGORY_LABELS.get(r.category, r.category)
            snippet = r.content[:max_chars_per_resource]
            if len(r.content) > max_chars_per_resource:
                snippet += "..."

            block = f"\n[{label}] {r.title}\n{snippet}\n"
            if total + len(block) > max_total_chars:
                break
            lines.append(block)
            total += len(block)

        lines.append("--- END KNOWLEDGE BASE ---\n")
        return "\n".join(lines)

    except Exception as e:
        logger.warning(f"Knowledge context fetch failed for module={module}: {e}")
        return ""
