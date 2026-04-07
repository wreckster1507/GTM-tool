"""
Contact repository.

Key addition over the base: list_with_company_name() runs a LEFT JOIN against
companies so the frontend gets company_name in a single API call instead of two.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact, ContactRead
from app.models.outreach import OutreachSequence
from app.repositories.base import BaseRepository
from app.services.contact_tracking import apply_contact_tracking


class ContactRepository(BaseRepository[Contact]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Contact, session)

    async def list_with_company_name(
        self,
        company_id: Optional[UUID] = None,
        q: Optional[str] = None,
        persona: Optional[str] = None,
        outreach_lane: Optional[str] = None,
        sequence_status: Optional[str] = None,
        email_state: Optional[str] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[ContactRead], int]:
        """
        Return contacts with company_name populated via SQL JOIN.

        This replaces the two-call pattern (GET /contacts + GET /companies)
        that the frontend was forced to use when company_name wasn't in the response.
        """
        base_stmt = select(Contact, Company.name.label("company_name")).outerjoin(
            Company, Contact.company_id == Company.id
        )
        count_stmt = select(func.count(Contact.id)).select_from(Contact).outerjoin(
            Company, Contact.company_id == Company.id
        )

        if company_id:
            base_stmt = base_stmt.where(Contact.company_id == company_id)
            count_stmt = count_stmt.where(Contact.company_id == company_id)

        normalized_q = (q or "").strip()
        if normalized_q:
            pattern = f"%{normalized_q}%"
            search_filter = or_(
                Contact.first_name.ilike(pattern),
                Contact.last_name.ilike(pattern),
                Contact.email.ilike(pattern),
                Contact.title.ilike(pattern),
                Company.name.ilike(pattern),
                func.concat(Contact.first_name, " ", Contact.last_name).ilike(pattern),
            )
            base_stmt = base_stmt.where(search_filter)
            count_stmt = count_stmt.where(search_filter)

        if persona:
            if persona == "unknown":
                persona_filter = or_(Contact.persona.is_(None), Contact.persona == "", Contact.persona == "unknown")
            else:
                persona_filter = Contact.persona == persona
            base_stmt = base_stmt.where(persona_filter)
            count_stmt = count_stmt.where(persona_filter)

        if outreach_lane:
            base_stmt = base_stmt.where(Contact.outreach_lane == outreach_lane)
            count_stmt = count_stmt.where(Contact.outreach_lane == outreach_lane)

        if sequence_status:
            base_stmt = base_stmt.where(Contact.sequence_status == sequence_status)
            count_stmt = count_stmt.where(Contact.sequence_status == sequence_status)

        if email_state == "has_email":
            email_filter = Contact.email.is_not(None)
        elif email_state == "missing_email":
            email_filter = or_(Contact.email.is_(None), Contact.email == "")
        elif email_state == "verified":
            email_filter = Contact.email_verified.is_(True)
        elif email_state == "unverified":
            email_filter = Contact.email_verified.is_(False)
        else:
            email_filter = None

        if email_filter is not None:
            base_stmt = base_stmt.where(email_filter)
            count_stmt = count_stmt.where(email_filter)

        # Exclude ClickUp placeholder contacts (company-name records, not real people)
        placeholder_filter = or_(
            Contact.enrichment_data.is_(None),
            Contact.enrichment_data["source"].as_string() != "clickup_import_placeholder",
        )
        base_stmt = base_stmt.where(placeholder_filter)
        count_stmt = count_stmt.where(placeholder_filter)

        total = (await self.session.execute(count_stmt)).scalar_one()

        rows = (
            await self.session.execute(
                base_stmt
                .order_by(Contact.created_at.desc(), Contact.id.desc())
                .offset(skip)
                .limit(limit)
            )
        ).all()

        result: list[ContactRead] = []
        for contact, company_name in rows:
            read = ContactRead.model_validate(contact)
            read.company_name = company_name
            result.append(read)

        await apply_contact_tracking(self.session, result)
        return result, total

    async def delete_all(self) -> None:
        """Delete all contacts and their dependent records. Admin only."""
        from sqlalchemy import delete as sa_delete
        await self.session.execute(sa_delete(OutreachSequence))
        await self.session.execute(sa_delete(Activity).where(Activity.contact_id.isnot(None)))
        await self.session.execute(sa_delete(Contact))
        await self.session.commit()

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
