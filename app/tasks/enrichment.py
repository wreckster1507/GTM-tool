"""
Celery task: enrich a company asynchronously.

Each task invocation creates its own SQLAlchemy engine + disposes it
before the event loop closes — this avoids asyncpg's "event loop is closed"
error on Windows when the global engine's connection pool outlives the loop.
"""
import asyncio
import logging
from uuid import UUID

from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(
    name="app.tasks.enrichment.enrich_company_task",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def enrich_company_task(self, company_id: str) -> dict:
    """Enrich a company by ID. Retries up to 3x on failure."""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_enrich(UUID(company_id)))
        finally:
            loop.close()
        return {"status": "completed", "company_id": company_id}
    except Exception as exc:
        logger.error(f"Enrichment task failed for {company_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_enrich(company_id: UUID) -> None:
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from app.config import settings
    from app.services.enrichment_orchestrator import enrich_company_by_id

    # Fresh engine per task — avoids stale connection pool across event loops
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    try:
        async with SessionLocal() as session:
            company = await enrich_company_by_id(company_id, session)
            if company:
                logger.info(
                    f"Enrichment complete: {company.domain} "
                    f"— ICP {company.icp_score} ({company.icp_tier})"
                )
    finally:
        await engine.dispose()
