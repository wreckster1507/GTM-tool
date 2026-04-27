"""
Company repository.

Adds domain-based lookup and a cascade-delete method that respects FK order.
All raw SQL logic that previously lived in app/routes/companies.py lives here.
"""
import re
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

# Common corporate suffixes that should not block dedupe.
# Stripped from the END of names during normalization, longest-first so
# "Pvt Ltd" wins over "Ltd" alone.
_NAME_SUFFIXES = (
    "pvt ltd", "private limited", "p ltd",
    "technologies", "technology", "solutions", "systems", "labs",
    "software", "services", "consulting", "group", "holdings",
    "global", "international", "corporation", "incorporated",
    "company", "limited", "corp", "inc", "llc", "ltd", "gmbh", "ag", "sa", "bv",
)
# Common public TLDs that show up when someone pastes a domain into the name field.
_NAME_TLDS = (".com", ".io", ".ai", ".co", ".org", ".net", ".in", ".uk", ".eu", ".de")


def _normalize_company_name(name: str) -> str:
    """Aggressive normalization for dedupe: strip TLDs, suffixes, punctuation."""
    s = (name or "").strip().lower().rstrip(" .,")
    if not s:
        return ""
    # Strip a trailing TLD-as-suffix BEFORE collapsing punctuation, so
    # "zywave.com" -> "zywave" rather than getting eaten as " com".
    for tld in _NAME_TLDS:
        if s.endswith(tld):
            s = s[: -len(tld)]
            break
    # Collapse remaining punctuation so "Pvt. Ltd" matches the "pvt ltd" suffix.
    s = re.sub(r"[.,]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return ""
    # Strip suffixes iteratively in case of compounds like "Foo Solutions Inc"
    changed = True
    while changed:
        changed = False
        s = s.rstrip(" .,")
        for suf in _NAME_SUFFIXES:
            # Match suffix optionally followed by punctuation (handles "Inc.", "Pvt.")
            if s.endswith(" " + suf) or s.endswith(" " + suf + "."):
                idx = s.rfind(" " + suf)
                s = s[:idx].rstrip(" .,")
                changed = True
                break
    return re.sub(r"[^a-z0-9]+", "", s)

from app.models.activity import Activity
from app.models.company_stage_milestone import CompanyStageMilestone
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.outreach import OutreachSequence
from app.repositories.base import BaseRepository


class CompanyRepository(BaseRepository[Company]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Company, session)

    async def get_by_domain(self, domain: str) -> Optional[Company]:
        result = await self.session.execute(
            select(Company).where(Company.domain == domain)
        )
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str) -> Optional[Company]:
        """Case-insensitive, whitespace-trimmed name lookup."""
        result = await self.session.execute(
            select(Company).where(func.lower(func.trim(Company.name)) == name.strip().lower())
        )
        return result.scalars().first()

    async def get_by_normalized_name(self, name: str) -> Optional[Company]:
        """
        Looser fallback used by importers to prevent placeholder-domain duplicates.
        Compares names with corporate suffixes / TLDs / punctuation stripped, so
        "zywave.com" matches "zywave", "OpenGov" matches "OpenGov Inc.", etc.
        Only call AFTER get_by_domain and get_by_name miss.
        """
        target = _normalize_company_name(name)
        if not target:
            return None
        # Pull a small candidate set by first 3 normalized chars to keep it cheap;
        # then normalize in Python for the equality check.
        prefix = target[:3]
        result = await self.session.execute(
            select(Company).where(func.lower(Company.name).like(f"{prefix}%"))
        )
        for candidate in result.scalars().all():
            if _normalize_company_name(candidate.name or "") == target:
                return candidate
        return None

    async def delete_with_cascade(self, company_id: UUID) -> None:
        """
        Delete a company and every dependent record in FK dependency order:
          1. outreach_sequences (FK on company_id + contact_id)
          2. activities (via contact_ids + deal_ids)
          3. company_stage_milestones
          3. deals
          4. contacts (+ any remaining outreach_sequences on contact_id)
          5. company  (signals cascade via DB ON DELETE CASCADE;
                       meetings use ON DELETE SET NULL so they survive)
        """
        # 1. outreach_sequences owned by this company
        seqs = await self.session.execute(
            select(OutreachSequence).where(OutreachSequence.company_id == company_id)
        )
        for seq in seqs.scalars().all():
            await self.session.delete(seq)

        # collect contacts + deals for cascade
        contacts = (
            await self.session.execute(
                select(Contact).where(Contact.company_id == company_id)
            )
        ).scalars().all()
        contact_ids = [c.id for c in contacts]

        deals = (
            await self.session.execute(
                select(Deal).where(Deal.company_id == company_id)
            )
        ).scalars().all()
        deal_ids = [d.id for d in deals]

        # 2. activities
        if contact_ids or deal_ids:
            acts_stmt = select(Activity)
            if contact_ids and deal_ids:
                acts_stmt = acts_stmt.where(
                    or_(
                        Activity.contact_id.in_(contact_ids),
                        Activity.deal_id.in_(deal_ids),
                    )
                )
            elif contact_ids:
                acts_stmt = acts_stmt.where(Activity.contact_id.in_(contact_ids))
            else:
                acts_stmt = acts_stmt.where(Activity.deal_id.in_(deal_ids))

            for act in (await self.session.execute(acts_stmt)).scalars().all():
                await self.session.delete(act)

        # 3. company stage milestones
        milestones = await self.session.execute(
            select(CompanyStageMilestone).where(CompanyStageMilestone.company_id == company_id)
        )
        for milestone in milestones.scalars().all():
            await self.session.delete(milestone)

        # 4. deals
        for deal in deals:
            await self.session.delete(deal)

        # 5. contacts (+ leftover outreach_sequences on contact_id)
        for contact in contacts:
            extra = (
                await self.session.execute(
                    select(OutreachSequence).where(
                        OutreachSequence.contact_id == contact.id
                    )
                )
            ).scalars().all()
            for seq in extra:
                await self.session.delete(seq)
            await self.session.delete(contact)

        # 6. company
        company = await self.get(company_id)
        if company:
            await self.session.delete(company)

        await self.session.commit()
