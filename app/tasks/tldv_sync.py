"""Celery task for periodic tl;dv meeting synchronization.

Runs every minute via Celery beat, but self-throttles using the
``tldv_sync_interval_minutes`` setting stored in WorkspaceSettings.
Default interval is 5 minutes.  Each successful run writes
``tldv_last_synced_at`` back so the next run only pulls meetings
newer than that timestamp (incremental mode).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta

from app.celery_app import celery_app
from app.database import AsyncSessionLocal

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.tldv_sync.sync_tldv_meetings")
def sync_tldv_meetings() -> dict:
    """Sync recent tl;dv meetings into Beacon CRM (incremental, self-throttled)."""
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
            row = (await session.execute(select(WorkspaceSettings).where(WorkspaceSettings.id == 1))).scalar_one_or_none()
            cfg: dict = row.sync_schedule_settings if row and isinstance(row.sync_schedule_settings, dict) else {}

            if not cfg.get("tldv_sync_enabled", True):
                logger.info("tl;dv sync is disabled in settings, skipping")
                return {"status": "disabled"}

            # ── Self-throttle: skip if not enough time has passed ─────────────
            interval_minutes: int = int(cfg.get("tldv_sync_interval_minutes") or 5)
            last_synced_raw = cfg.get("tldv_last_synced_at")
            last_synced_at: datetime | None = None
            if last_synced_raw:
                try:
                    last_synced_at = datetime.fromisoformat(str(last_synced_raw))
                except ValueError:
                    last_synced_at = None

            if last_synced_at and datetime.utcnow() - last_synced_at < timedelta(minutes=interval_minutes):
                logger.debug(
                    "tl;dv sync skipped — last ran %s, interval %d min",
                    last_synced_at.isoformat(), interval_minutes,
                )
                return {"status": "throttled", "next_run_in_minutes": interval_minutes}

            page_size: int = int(cfg.get("tldv_page_size") or 10)
            max_pages: int = int(cfg.get("tldv_max_pages") or 2)

            result = await sync_tldv_history(
                session,
                page_size=page_size,
                max_pages=max_pages,
                since=last_synced_at,  # None on first run → full lookback
            )

            # ── Write last_synced_at back to DB ───────────────────────────────
            if row:
                updated_cfg = dict(cfg)
                updated_cfg["tldv_last_synced_at"] = datetime.utcnow().isoformat()
                row.sync_schedule_settings = updated_cfg
                session.add(row)
                await session.commit()

            logger.info("tl;dv sync completed: %s", result)
            return result if isinstance(result, dict) else {"status": "ok"}
        except Exception as exc:
            logger.warning("tl;dv sync failed: %s", exc)
            return {"error": str(exc)}
