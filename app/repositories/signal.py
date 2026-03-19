"""Signal repository — adds deduplication helper used by the refresh endpoint."""
from typing import Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.signal import Signal
from app.repositories.base import BaseRepository


class SignalRepository(BaseRepository[Signal]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Signal, session)

    async def exists_by_title(self, company_id: UUID, title: str) -> bool:
        result = await self.session.execute(
            select(Signal).where(
                Signal.company_id == company_id,
                Signal.title == title,
            )
        )
        return result.scalar_one_or_none() is not None
