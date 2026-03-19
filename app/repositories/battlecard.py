"""Battlecard repository — adds full-text search helper."""
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.battlecard import Battlecard
from app.repositories.base import BaseRepository


class BattlecardRepository(BaseRepository[Battlecard]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Battlecard, session)

    async def search(self, q: str, limit: int = 20) -> list[Battlecard]:
        term = f"%{q.lower()}%"
        result = await self.session.execute(
            select(Battlecard)
            .where(
                Battlecard.is_active == True,
                or_(
                    func.lower(Battlecard.trigger).like(term),
                    func.lower(Battlecard.title).like(term),
                    func.lower(Battlecard.tags).like(term),
                ),
            )
            .limit(limit)
        )
        return list(result.scalars().all())
