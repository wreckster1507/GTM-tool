"""
Email sync endpoints — manual trigger + status.

The actual syncing runs as a Celery beat task every 3 minutes.
These endpoints let admins trigger an immediate sync or check status.
"""
from fastapi import APIRouter

from app.config import settings

router = APIRouter(prefix="/email-sync", tags=["email-sync"])


@router.post("/trigger")
async def trigger_email_sync():
    """Manually trigger an immediate Gmail inbox sync (queues a Celery task)."""
    if not settings.GMAIL_SHARED_INBOX:
        return {"status": "disabled", "message": "GMAIL_SHARED_INBOX not configured"}

    from app.tasks.email_sync import sync_gmail_inbox
    task = sync_gmail_inbox.delay()
    return {"status": "queued", "task_id": task.id}


@router.get("/status")
async def email_sync_status():
    """Check email sync configuration and last sync time."""
    import redis
    from app.tasks.email_sync import REDIS_KEY_LAST_SYNC

    result = {
        "enabled": bool(settings.GMAIL_SHARED_INBOX),
        "inbox": settings.GMAIL_SHARED_INBOX or None,
        "interval_seconds": settings.EMAIL_SYNC_INTERVAL_SECONDS,
        "last_sync_epoch": None,
    }

    if settings.GMAIL_SHARED_INBOX:
        try:
            r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
            last = r.get(REDIS_KEY_LAST_SYNC)
            result["last_sync_epoch"] = int(last) if last else None
            r.close()
        except Exception:
            pass

    return result
