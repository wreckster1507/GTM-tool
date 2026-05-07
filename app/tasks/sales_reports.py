import asyncio
import logging
from datetime import date

from app.celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(name="app.tasks.sales_reports.send_us_pod_call_report")
def send_us_pod_call_report(report_date: str | None = None) -> dict:
    """Send the daily US pod call report by email."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(_async_send_us_pod_call_report(report_date))
    finally:
        loop.close()


async def _async_send_us_pod_call_report(report_date: str | None = None) -> dict:
    # Import locally so the module load doesn't bind the engine to whatever
    # loop happens to be active at Celery worker import time.
    from app.database import AsyncSessionLocal, engine
    from app.services.us_pod_call_report import send_us_pod_call_report_email

    parsed_date = date.fromisoformat(report_date) if report_date else None
    try:
        async with AsyncSessionLocal() as session:
            report = await send_us_pod_call_report_email(session, parsed_date)
            return {
                "status": "completed",
                "report_date": report["report_date"],
                "recipients": report["recipients"],
                "send_results": report.get("send_results", []),
            }
    finally:
        # Dispose the asyncpg pool so the *next* Celery task starts on a clean
        # slate. Without this, connections stay bound to this (now-closing)
        # event loop and the next task that uses the engine crashes with
        # "Future attached to a different loop". Mirrors app/tasks/email_sync.py.
        await engine.dispose()
