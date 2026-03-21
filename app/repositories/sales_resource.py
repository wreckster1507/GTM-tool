"""Sales Resource repository — CRUD + module-filtered context retrieval."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.models.sales_resource import SalesResource
from app.repositories.base import BaseRepository


class SalesResourceRepository(BaseRepository[SalesResource]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(SalesResource, session)

    async def search(
        self,
        *,
        category: Optional[str] = None,
        module: Optional[str] = None,
        query: Optional[str] = None,
        active_only: bool = True,
    ) -> list[SalesResource]:
        """Filter resources by category, target module, and/or text search."""
        stmt = select(SalesResource)
        if active_only:
            stmt = stmt.where(SalesResource.is_active == True)  # noqa: E712
        if category:
            stmt = stmt.where(SalesResource.category == category)
        if module:
            # JSONB contains — checks if the modules array includes this value
            stmt = stmt.where(
                SalesResource.modules.contains([module])  # type: ignore[union-attr]
            )
        if query:
            pattern = f"%{query}%"
            stmt = stmt.where(
                SalesResource.title.ilike(pattern)  # type: ignore[union-attr]
                | SalesResource.content.ilike(pattern)  # type: ignore[union-attr]
            )
        stmt = stmt.order_by(SalesResource.updated_at.desc())
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def for_module(
        self, module: str, limit: int = 5
    ) -> list[SalesResource]:
        """Get the most relevant active resources for a specific AI module."""
        return (await self.search(module=module, active_only=True))[:limit]
