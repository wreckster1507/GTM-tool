"""
Contact repository.

Key addition over the base: list_with_company_name() runs a LEFT JOIN against
companies so the frontend gets company_name in a single API call instead of two.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact, ContactRead
from app.models.outreach import OutreachSequence
from app.repositories.base import BaseRepository


class ContactRepository(BaseRepository[Contact]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Contact, session)

    async def list_with_company_name(
        self,
        company_id: Optional[UUID] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[ContactRead], int]:
        """
        Return contacts with company_name populated via SQL JOIN.

        This replaces the two-call pattern (GET /contacts + GET /companies)
        that the frontend was forced to use when company_name wasn't in the response.
        """
        base_stmt = (
            select(Contact, Company.name.label("company_name"))
            .outerjoin(Company, Contact.company_id == Company.id)
        )
        count_stmt = select(func.count()).select_from(Contact)

        if company_id:
            base_stmt = base_stmt.where(Contact.company_id == company_id)
            count_stmt = count_stmt.where(Contact.company_id == company_id)

        total = (await self.session.execute(count_stmt)).scalar_one()

        rows = (
            await self.session.execute(
                base_stmt
                .order_by(Contact.created_at.desc())
                .offset(skip)
                .limit(limit)
            )
        ).all()

        result: list[ContactRead] = []
        for contact, company_name in rows:
            read = ContactRead.model_validate(contact)
            read.company_name = company_name
            result.append(read)

        return result, total

    async def delete_with_cascade(self, contact_id: UUID) -> None:
        """Delete contact + dependent outreach_sequences and activities."""
        for seq in (
            await self.session.execute(
                select(OutreachSequence).where(OutreachSequence.contact_id == contact_id)
            )
        ).scalars().all():
            await self.session.delete(seq)

        for act in (
            await self.session.execute(
                select(Activity).where(Activity.contact_id == contact_id)
            )
        ).scalars().all():
            await self.session.delete(act)

        contact = await self.get(contact_id)
        if contact:
            await self.session.delete(contact)

        await self.session.commit()
