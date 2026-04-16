"""
Contact repository.

Key addition over the base: list_with_company_name() runs a LEFT JOIN against
companies so the frontend gets company_name in a single API call instead of two.
"""
from typing import Optional
from uuid import UUID

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.company import Company
from app.models.contact import Contact, ContactRead
from app.models.outreach import OutreachSequence
from app.repositories.base import BaseRepository
from app.services.contact_tracking import apply_contact_tracking

FREE_EMAIL_PROVIDERS = frozenset({
    "gmail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "icloud.com",
    "aol.com",
    "protonmail.com",
    "me.com",
    "live.com",
})


def _parse_multi_query(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def _parse_uuid_values(value: str | None) -> list[UUID]:
    parsed: list[UUID] = []
    for item in _parse_multi_query(value):
        try:
            parsed.append(UUID(item))
        except ValueError:
            continue
    return parsed


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
        ae_id: Optional[str] = None,
        sdr_id: Optional[str] = None,
        prospect_only: bool = False,
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

        if prospect_only:
            email_domain = func.lower(func.split_part(Contact.email, "@", 2))
            normalized_company_domain = func.lower(func.replace(Company.domain, "www.", ""))
            business_domain_mismatch = and_(
                Contact.email.is_not(None),
                Contact.email != "",
                Company.domain.is_not(None),
                Company.domain != "",
                ~Company.domain.ilike("%.unknown"),
                ~email_domain.in_(tuple(FREE_EMAIL_PROVIDERS)),
                email_domain != normalized_company_domain,
            )
            junk_filters = [
                Contact.email.is_not(None),
                ~func.lower(Contact.email).like("%@beacon.li"),
                ~func.lower(Contact.email).like("zippy+%@beacon.li"),
                ~business_domain_mismatch,
            ]
            base_stmt = base_stmt.where(*junk_filters)
            count_stmt = count_stmt.where(*junk_filters)

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

        persona_values = _parse_multi_query(persona)
        if persona_values:
            include_unknown = "unknown" in persona_values
            named_personas = [value for value in persona_values if value != "unknown"]
            clauses = []
            if named_personas:
                clauses.append(Contact.persona.in_(named_personas))
            if include_unknown:
                clauses.append(or_(Contact.persona.is_(None), Contact.persona == "", Contact.persona == "unknown"))
            persona_filter = or_(*clauses) if clauses else None
        else:
            persona_filter = None

        if persona_filter is not None:
            base_stmt = base_stmt.where(persona_filter)
            count_stmt = count_stmt.where(persona_filter)

        outreach_lane_values = _parse_multi_query(outreach_lane)
        if outreach_lane_values:
            lane_filter = Contact.outreach_lane.in_(outreach_lane_values)
            base_stmt = base_stmt.where(lane_filter)
            count_stmt = count_stmt.where(lane_filter)

        sequence_values = _parse_multi_query(sequence_status)
        if sequence_values:
            sequence_filter = Contact.sequence_status.in_(sequence_values)
            base_stmt = base_stmt.where(sequence_filter)
            count_stmt = count_stmt.where(sequence_filter)

        email_filters = []
        for state in _parse_multi_query(email_state):
            if state == "has_email":
                email_filters.append(and_(Contact.email.is_not(None), Contact.email != ""))
            elif state == "missing_email":
                email_filters.append(or_(Contact.email.is_(None), Contact.email == ""))
            elif state == "verified":
                email_filters.append(Contact.email_verified.is_(True))
            elif state == "unverified":
                email_filters.append(Contact.email_verified.is_(False))
        email_filter = or_(*email_filters) if email_filters else None

        if email_filter is not None:
            base_stmt = base_stmt.where(email_filter)
            count_stmt = count_stmt.where(email_filter)

        ae_ids = _parse_uuid_values(ae_id)
        if ae_ids:
            ae_filter = Contact.assigned_to_id.in_(ae_ids)
            base_stmt = base_stmt.where(ae_filter)
            count_stmt = count_stmt.where(ae_filter)

        sdr_ids = _parse_uuid_values(sdr_id)
        if sdr_ids:
            sdr_filter = Contact.sdr_id.in_(sdr_ids)
            base_stmt = base_stmt.where(sdr_filter)
            count_stmt = count_stmt.where(sdr_filter)

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
