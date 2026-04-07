"""Celery task for periodic tl;dv meeting synchronization."""

from __future__ import annotations

import asyncio
import logging

from app.celery_app import celery_app
from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.tldv_sync.sync_tldv_meetings")
def sync_tldv_meetings() -> dict:
    """Sync recent tl;dv meetings into Beacon CRM."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_async_sync())
    finally:
        loop.close()


async def _async_sync() -> dict:
    from sqlalchemy import select
    from app.models.settings import WorkspaceSettings
    from app.services.tldv_sync import sync_tldv_history

    async with AsyncSessionLocal() as session:
        try:
            # Read sync settings from DB
            row = (await session.execute(select(WorkspaceSettings).where(WorkspaceSettings.id == 1))).scalar_one_or_none()
            cfg = (row.sync_schedule_settings if row and isinstance(row.sync_schedule_settings, dict) else {})
            if not cfg.get("tldv_sync_enabled", True):
                logger.info("tl;dv sync is disabled in settings, skipping")
                return {"status": "disabled"}
            page_size = cfg.get("tldv_page_size", 20)
            max_pages = cfg.get("tldv_max_pages", 3)

            result = await sync_tldv_history(session, page_size=page_size, max_pages=max_pages)
            logger.info("tl;dv sync completed: %s", result)
            return result if isinstance(result, dict) else {"status": "ok"}
        except Exception as exc:
            logger.warning("tl;dv sync failed: %s", exc)
            return {"error": str(exc)}
