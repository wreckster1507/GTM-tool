"""
Celery task: enrich a company asynchronously.

Each task invocation creates its own SQLAlchemy engine + disposes it
before the event loop closes — this avoids asyncpg's "event loop is closed"
error on Windows when the global engine's connection pool outlives the loop.
"""
import asyncio
import logging
from datetime import datetime
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


# ── Account Sourcing Tasks ─────────────────────────────────────────────────────

def _make_session():
    """Create a fresh engine + session for a Celery task (avoids stale pools)."""
    from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
    from sqlalchemy.orm import sessionmaker
    from app.config import settings

    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    return engine, SessionLocal


@celery_app.task(
    name="app.tasks.enrichment.enrich_batch_task",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def enrich_batch_task(self, batch_id: str) -> dict:
    """Process all companies in a sourcing batch through tiered enrichment."""
    try:
        # Celery tasks are synchronous entrypoints, so we create a fresh event loop
        # to run the async enrichment pipeline inside the worker process.
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_enrich_batch(UUID(batch_id)))
        finally:
            loop.close()
        return {"status": "completed", "batch_id": batch_id}
    except Exception as exc:
        logger.error(f"Batch enrichment task failed for {batch_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_enrich_batch(batch_id: UUID) -> None:
    from sqlmodel import select

    from app.models.company import Company
    from app.models.sourcing_batch import SourcingBatch
    from app.services.account_sourcing import enrich_company_tiered

    engine, SessionLocal = _make_session()
    try:
        async with SessionLocal() as session:
            batch = await session.get(SourcingBatch, batch_id)
            if not batch:
                return

            batch.status = "processing"
            batch.updated_at = datetime.utcnow()
            session.add(batch)
            await session.commit()

            result = await session.execute(
                select(Company.id).where(Company.sourcing_batch_id == batch_id)
            )
            company_ids = list(result.scalars().all())

        # Keep concurrency bounded so the worker does not overwhelm external APIs.
        semaphore = asyncio.Semaphore(3)
        progress_lock = asyncio.Lock()
        processed = 0
        failed = 0

        async def enrich_one(company_id: UUID) -> None:
            nonlocal processed, failed
            error_payload = None

            async with semaphore:
                try:
                    async with SessionLocal() as company_session:
                        await enrich_company_tiered(company_id, company_session, force_paid_refresh=False)
                except Exception as exc:
                    logger.error(f"Batch enrichment failed for {company_id}: {exc}")
                    error_payload = {"company_id": str(company_id), "error": str(exc)}

                async with progress_lock:
                    # Serialize progress updates so counters and error_log writes
                    # stay consistent for the polling UI.
                    processed += 1
                    if error_payload:
                        failed += 1
                    async with SessionLocal() as progress_session:
                        progress_batch = await progress_session.get(SourcingBatch, batch_id)
                        if not progress_batch:
                            return
                        progress_batch.processed_rows = processed
                        progress_batch.failed_rows = failed
                        if error_payload:
                            existing_errors = list(progress_batch.error_log or [])
                            existing_errors.append(error_payload)
                            progress_batch.error_log = existing_errors
                        progress_batch.updated_at = datetime.utcnow()
                        progress_session.add(progress_batch)
                        await progress_session.commit()

        await asyncio.gather(*(enrich_one(company_id) for company_id in company_ids))

        async with SessionLocal() as session:
            batch = await session.get(SourcingBatch, batch_id)
            if batch:
                batch.failed_rows = failed
                batch.status = "failed" if failed == len(company_ids) and company_ids else "completed"
                batch.updated_at = datetime.utcnow()
                session.add(batch)
                await session.commit()
                logger.info(f"Batch {batch_id} complete: {batch.processed_rows}/{batch.total_rows}")
    finally:
        await engine.dispose()


@celery_app.task(
    name="app.tasks.enrichment.re_enrich_company_task",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def re_enrich_company_task(self, company_id: str) -> dict:
    """Re-enrich a single company through the tiered pipeline."""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_re_enrich_company(UUID(company_id)))
        finally:
            loop.close()
        return {"status": "completed", "company_id": company_id}
    except Exception as exc:
        logger.error(f"Re-enrich task failed for {company_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_re_enrich_company(company_id: UUID) -> None:
    from app.services.account_sourcing import re_enrich_company
    engine, SessionLocal = _make_session()
    try:
        async with SessionLocal() as session:
            await re_enrich_company(company_id, session)
    finally:
        await engine.dispose()


@celery_app.task(
    name="app.tasks.enrichment.re_enrich_contact_task",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def re_enrich_contact_task(self, contact_id: str) -> dict:
    """Re-enrich a single contact."""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_re_enrich_contact(UUID(contact_id)))
        finally:
            loop.close()
        return {"status": "completed", "contact_id": contact_id}
    except Exception as exc:
        logger.error(f"Contact re-enrich failed for {contact_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_re_enrich_contact(contact_id: UUID) -> None:
    from app.services.account_sourcing import re_enrich_contact_service
    engine, SessionLocal = _make_session()
    try:
        async with SessionLocal() as session:
            await re_enrich_contact_service(contact_id, session)
    finally:
        await engine.dispose()


# ── ICP Intelligence Pipeline Tasks ──────────────────────────────────────────

@celery_app.task(
    name="app.tasks.enrichment.icp_research_batch_task",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def icp_research_batch_task(self, batch_id: str) -> dict:
    """
    Run the full ICP intelligence pipeline for all companies in a batch.
    This replaces the standard enrichment for 'minimal' uploads (company names only).
    Each company goes through: web research → Apollo → Claude ICP analysis.
    """
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_icp_research_batch(UUID(batch_id)))
        finally:
            loop.close()
        return {"status": "completed", "batch_id": batch_id}
    except Exception as exc:
        logger.error(f"ICP research batch task failed for {batch_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_icp_research_batch(batch_id: UUID) -> None:
    from sqlmodel import select
    from app.models.company import Company
    from app.models.sourcing_batch import SourcingBatch
    from app.services.icp_intelligence import research_company_and_update

    engine, SessionLocal = _make_session()
    try:
        async with SessionLocal() as session:
            batch = await session.get(SourcingBatch, batch_id)
            if not batch:
                return

            batch.status = "processing"
            batch.updated_at = datetime.utcnow()
            session.add(batch)
            await session.commit()

            result = await session.execute(
                select(Company.id).where(Company.sourcing_batch_id == batch_id)
            )
            company_ids = list(result.scalars().all())

        # Process companies with concurrency limit (2 at a time — each does
        # many web requests + a Claude API call, so keep it conservative)
        semaphore = asyncio.Semaphore(2)
        progress_lock = asyncio.Lock()
        processed = 0
        failed = 0

        async def research_one(company_id: UUID) -> None:
            nonlocal processed, failed
            error_payload = None

            async with semaphore:
                try:
                    async with SessionLocal() as company_session:
                        await research_company_and_update(company_id, company_session)
                except Exception as exc:
                    import traceback
                    logger.error(f"ICP research failed for {company_id}: {exc}\n{traceback.format_exc()}")
                    error_payload = {"company_id": str(company_id), "error": str(exc)}

                async with progress_lock:
                    # Persist progress after each company so batch status endpoints
                    # can reflect work in near real time.
                    processed += 1
                    if error_payload:
                        failed += 1
                    async with SessionLocal() as progress_session:
                        progress_batch = await progress_session.get(SourcingBatch, batch_id)
                        if not progress_batch:
                            return
                        progress_batch.processed_rows = processed
                        progress_batch.failed_rows = failed
                        if error_payload:
                            existing_errors = list(progress_batch.error_log or [])
                            existing_errors.append(error_payload)
                            progress_batch.error_log = existing_errors
                        progress_batch.updated_at = datetime.utcnow()
                        progress_session.add(progress_batch)
                        await progress_session.commit()

        await asyncio.gather(*(research_one(cid) for cid in company_ids))

        async with SessionLocal() as session:
            batch = await session.get(SourcingBatch, batch_id)
            if batch:
                batch.failed_rows = failed
                batch.status = "failed" if failed == len(company_ids) and company_ids else "completed"
                batch.updated_at = datetime.utcnow()
                session.add(batch)
                await session.commit()
                logger.info(
                    f"ICP research batch {batch_id} complete: "
                    f"{batch.processed_rows}/{batch.total_rows} "
                    f"({failed} failed)"
                )
    finally:
        await engine.dispose()


@celery_app.task(
    name="app.tasks.enrichment.icp_research_single_task",
    bind=True,
    max_retries=2,
    default_retry_delay=60,
)
def icp_research_single_task(self, company_id: str) -> dict:
    """Run ICP intelligence pipeline for a single company."""
    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            loop.run_until_complete(_async_icp_research_single(UUID(company_id)))
        finally:
            loop.close()
        return {"status": "completed", "company_id": company_id}
    except Exception as exc:
        logger.error(f"ICP research task failed for {company_id}: {exc}")
        raise self.retry(exc=exc)


async def _async_icp_research_single(company_id: UUID) -> None:
    from app.services.icp_intelligence import research_company_and_update
    engine, SessionLocal = _make_session()
    try:
        async with SessionLocal() as session:
            await research_company_and_update(company_id, session)
    finally:
        await engine.dispose()
