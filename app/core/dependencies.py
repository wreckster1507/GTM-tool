"""
Centralised FastAPI dependency injectors.

All route files should import from here — not from app.database directly.
This single import point makes it trivial to swap the DB backend, add auth,
rate-limiting, or request-scoped tracing in one place later.
"""
from typing import Annotated

from fastapi import Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

# Re-export the session dependency so routes only need this module
from app.database import get_session

# ── Typed shorthand ──────────────────────────────────────────────────────────
# Use as: async def my_route(session: DBSession): ...
DBSession = Annotated[AsyncSession, Depends(get_session)]


# ── Pagination params ────────────────────────────────────────────────────────
class PaginationParams:
    def __init__(
        self,
        skip: int = Query(default=0, ge=0, description="Records to skip"),
        limit: int = Query(default=50, ge=1, le=500, description="Max records to return"),
    ):
        self.skip = skip
        self.limit = limit


Pagination = Annotated[PaginationParams, Depends(PaginationParams)]


__all__ = ["get_session", "DBSession", "PaginationParams", "Pagination"]
