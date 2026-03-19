"""
Company repository.

Adds domain-based lookup and a cascade-delete method that respects FK order.
All raw SQL logic that previously lived in app/routes/companies.py lives here.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
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
        return result.scalar_one_or_none()

    async def delete_with_cascade(self, company_id: UUID) -> None:
        """
        Delete a company and every dependent record in FK dependency order:
          1. outreach_sequences (FK on company_id + contact_id)
          2. activities (via contact_ids + deal_ids)
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

        # 3. deals
        for deal in deals:
            await self.session.delete(deal)

        # 4. contacts (+ leftover outreach_sequences on contact_id)
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

        # 5. company
        company = await self.get(company_id)
        if company:
            await self.session.delete(company)

        await self.session.commit()
