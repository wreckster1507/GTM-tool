from typing import AsyncGenerator

from sqlalchemy import event
from sqlalchemy.dialects.postgresql import JSON, JSONB
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker
from sqlmodel import SQLModel

from app.config import settings
from app.services.text_sanitize import sanitize_json_value, sanitize_text

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.ENVIRONMENT == "development",
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)

AsyncSessionLocal = sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


def _sanitize_on_flush(sess, flush_context, instances):
    """Strip characters asyncpg can't store (NUL bytes, lone surrogates) before flush.

    Runs on every add/dirty model instance regardless of the caller, so scraper
    output, AI output, and user input all land clean. Walks JSON/JSONB columns
    recursively and top-level string columns shallowly.
    """
    for obj in list(sess.new) + list(sess.dirty):
        mapper = getattr(obj, "__mapper__", None)
        if mapper is None:
            continue
        for column in mapper.columns:
            value = getattr(obj, column.key, None)
            if value is None:
                continue
            col_type = column.type
            if isinstance(col_type, (JSON, JSONB)):
                cleaned = sanitize_json_value(value)
                if cleaned is not value:
                    setattr(obj, column.key, cleaned)
            elif isinstance(value, str):
                cleaned = sanitize_text(value)
                if cleaned != value:
                    setattr(obj, column.key, cleaned)


# Register the listener on the sync Session class that async sessions delegate to.
event.listen(AsyncSessionLocal.sync_session_class, "before_flush", _sanitize_on_flush)
