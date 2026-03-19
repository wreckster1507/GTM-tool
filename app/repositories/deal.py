"""Deal repository — adds cascade-delete and stage-aware helpers."""
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.deal import Deal
from app.repositories.base import BaseRepository

VALID_STAGES = frozenset(
    ["discovery", "demo", "poc", "proposal", "negotiation", "closed_won", "closed_lost"]
)


class DealRepository(BaseRepository[Deal]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Deal, session)

    async def delete_with_cascade(self, deal_id: UUID) -> None:
        """Delete deal and its activities."""
        for act in (
            await self.session.execute(
                select(Activity).where(Activity.deal_id == deal_id)
            )
        ).scalars().all():
            await self.session.delete(act)

        deal = await self.get(deal_id)
        if deal:
            await self.session.delete(deal)

        await self.session.commit()
