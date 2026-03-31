from celery import Celery
from celery.schedules import crontab

from app.config import settings

celery_app = Celery(
    "beacon_crm",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=[
        "app.tasks.enrichment",
        "app.tasks.health",
        "app.tasks.email_sync",
    ],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    # Daily deal health recalculation at 02:00 UTC
    beat_schedule={
        "recalculate-deal-health-daily": {
            "task": "app.tasks.health.recalculate_all_deal_health",
            "schedule": crontab(hour=2, minute=0),
        },
        "sync-gmail-inbox": {
            "task": "app.tasks.email_sync.sync_gmail_inbox",
            "schedule": settings.EMAIL_SYNC_INTERVAL_SECONDS,  # every 3 min
        },
    },
)
