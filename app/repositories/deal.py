"""Deal repository — board queries, contact management, cascade-delete."""
from __future__ import annotations

from datetime import datetime
import re
from typing import Optional
from uuid import UUID

from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.contact import Contact
from app.models.company import Company
from app.models.deal import (
    ALL_STAGES, Deal, DealContact, DealContactRead, DealRead,
    compute_meddpicc_score,
)
from app.models.user import User
from app.repositories.base import BaseRepository


class DealRepository(BaseRepository[Deal]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Deal, session)

    @staticmethod
    def _slugify_alias(name: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", (name or "").strip().lower()).strip("-")
        return slug or "deal"

    async def generate_unique_email_cc_alias(self, name: str, *, exclude_id: UUID | None = None) -> str:
        base = self._slugify_alias(name)
        candidate = base
        suffix = 2

        while True:
            stmt = select(Deal.id).where(Deal.email_cc_alias == candidate)
            if exclude_id:
                stmt = stmt.where(Deal.id != exclude_id)
            existing = (await self.session.execute(stmt)).first()
            if not existing:
                return candidate
            candidate = f"{base}-{suffix}"
            suffix += 1

    async def create(self, data: dict) -> Deal:
        if not data.get("email_cc_alias"):
            data["email_cc_alias"] = await self.generate_unique_email_cc_alias(str(data.get("name") or "deal"))
        return await super().create(data)

    async def update(self, obj: Deal, data: dict) -> Deal:
        if "email_cc_alias" in data and data["email_cc_alias"]:
            normalized = self._slugify_alias(str(data["email_cc_alias"]))
            if normalized != obj.email_cc_alias:
                data["email_cc_alias"] = await self.generate_unique_email_cc_alias(normalized, exclude_id=obj.id)
            else:
                data["email_cc_alias"] = normalized
        return await super().update(obj, data)

    # ── Board query ──────────────────────────────────────────────────────────

    async def board(self, pipeline_type: str = "deal") -> dict[str, list[DealRead]]:
        """Return deals grouped by stage, with company_name, assigned_rep_name, contact_count."""
        contact_count_sub = (
            select(
                DealContact.deal_id,
                func.count().label("cnt"),
            )
            .group_by(DealContact.deal_id)
            .subquery()
        )

        stmt = (
            select(
                Deal,
                Company.name.label("company_name"),
                User.name.label("assigned_rep_name"),
                func.coalesce(contact_count_sub.c.cnt, 0).label("contact_count"),
            )
            .outerjoin(Company, Deal.company_id == Company.id)
            .outerjoin(User, Deal.assigned_to_id == User.id)
            .outerjoin(contact_count_sub, Deal.id == contact_count_sub.c.deal_id)
            .where(Deal.pipeline_type == pipeline_type)
            .order_by(Deal.close_date_est.asc().nulls_last(), Deal.created_at.desc())
        )

        result = await self.session.execute(stmt)
        rows = result.all()

        board: dict[str, list[DealRead]] = {}
        now = datetime.utcnow()
        for deal, company_name, rep_name, cc in rows:
            read = DealRead.model_validate(deal)
            read.company_name = company_name
            read.assigned_rep_name = rep_name
            read.contact_count = cc or 0
            read.meddpicc_score = compute_meddpicc_score(deal.qualification)
            # Compute days_in_stage live so reps always see real-time staleness
            if deal.stage_entered_at:
                read.days_in_stage = (now - deal.stage_entered_at).days
            elif deal.created_at:
                read.days_in_stage = (now - deal.created_at).days
            board.setdefault(deal.stage, []).append(read)

        return board

    # ── Single deal with joins ───────────────────────────────────────────────

    async def get_with_joins(self, deal_id: UUID) -> Optional[DealRead]:
        contact_count_sub = (
            select(
                DealContact.deal_id,
                func.count().label("cnt"),
            )
            .where(DealContact.deal_id == deal_id)
            .group_by(DealContact.deal_id)
            .subquery()
        )

        stmt = (
            select(
                Deal,
                Company.name.label("company_name"),
                User.name.label("assigned_rep_name"),
                func.coalesce(contact_count_sub.c.cnt, 0).label("contact_count"),
            )
            .outerjoin(Company, Deal.company_id == Company.id)
            .outerjoin(User, Deal.assigned_to_id == User.id)
            .outerjoin(contact_count_sub, Deal.id == contact_count_sub.c.deal_id)
            .where(Deal.id == deal_id)
        )

        row = (await self.session.execute(stmt)).first()
        if not row:
            return None

        deal, company_name, rep_name, cc = row
        read = DealRead.model_validate(deal)
        read.company_name = company_name
        read.assigned_rep_name = rep_name
        read.contact_count = cc or 0
        read.meddpicc_score = compute_meddpicc_score(deal.qualification)
        # Compute days_in_stage live
        if deal.stage_entered_at:
            read.days_in_stage = (datetime.utcnow() - deal.stage_entered_at).days
        elif deal.created_at:
            read.days_in_stage = (datetime.utcnow() - deal.created_at).days
        return read

    # ── Contact management ───────────────────────────────────────────────────

    async def list_contacts(self, deal_id: UUID) -> list[DealContactRead]:
        stmt = (
            select(DealContact, Contact)
            .join(Contact, DealContact.contact_id == Contact.id)
            .where(DealContact.deal_id == deal_id)
            .order_by(DealContact.added_at.desc())
        )
        rows = (await self.session.execute(stmt)).all()
        result = []
        for dc, contact in rows:
            result.append(DealContactRead(
                deal_id=dc.deal_id,
                contact_id=dc.contact_id,
                role=dc.role,
                added_at=dc.added_at,
                first_name=contact.first_name,
                last_name=contact.last_name,
                email=contact.email,
                title=contact.title,
                persona=contact.persona,
            ))
        return result

    async def add_contact(self, deal_id: UUID, contact_id: UUID, role: Optional[str] = None) -> DealContact:
        dc = DealContact(deal_id=deal_id, contact_id=contact_id, role=role, added_at=datetime.utcnow())
        self.session.add(dc)
        await self.session.commit()
        await self.session.refresh(dc)
        return dc

    async def remove_contact(self, deal_id: UUID, contact_id: UUID) -> bool:
        stmt = select(DealContact).where(
            DealContact.deal_id == deal_id,
            DealContact.contact_id == contact_id,
        )
        dc = (await self.session.execute(stmt)).scalar_one_or_none()
        if not dc:
            return False
        await self.session.delete(dc)
        await self.session.commit()
        return True

    # ── Cascade delete ───────────────────────────────────────────────────────

    async def delete_with_cascade(self, deal_id: UUID) -> None:
        """Delete deal, its activities, and contact links."""
        for act in (
            await self.session.execute(
                select(Activity).where(Activity.deal_id == deal_id)
            )
        ).scalars().all():
            await self.session.delete(act)

        for dc in (
            await self.session.execute(
                select(DealContact).where(DealContact.deal_id == deal_id)
            )
        ).scalars().all():
            await self.session.delete(dc)

        deal = await self.get(deal_id)
        if deal:
            await self.session.delete(deal)

        await self.session.commit()
