"""Activity repository — simple CRUD, no special cascade logic needed."""
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.repositories.base import BaseRepository


class ActivityRepository(BaseRepository[Activity]):
    def __init__(self, session: AsyncSession) -> None:
        super().__init__(Activity, session)
