"""Outreach sequence repository."""
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.outreach import OutreachSequence
from app.repositories.base import BaseRepository


class OutreachRepository(BaseRepository[OutreachSequence]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(OutreachSequence, session)

    async def get_by_contact(self, contact_id: UUID) -> Optional[OutreachSequence]:
        result = await self.session.execute(
            select(OutreachSequence).where(OutreachSequence.contact_id == contact_id)
        )
        return result.scalar_one_or_none()

    async def exists_for_contact(self, contact_id: UUID) -> bool:
        return await self.get_by_contact(contact_id) is not None
