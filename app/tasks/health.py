"""
Celery Beat task: recalculate deal health daily for all active deals.

Runs every 24 hours via the beat_schedule in celery_app.py.
"""
import asyncio
import logging
from datetime import datetime

from app.celery_app import celery_app

logger = logging.getLogger(__name__)

# Closed/terminal stages that should NOT be health-checked.
_CLOSED_STAGES = frozenset([
    "closed_won", "closed_lost", "not_a_fit", "churned",
])


@celery_app.task(name="app.tasks.health.recalculate_all_deal_health")
def recalculate_all_deal_health() -> dict:
    """Recalculate health score for every active deal."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        count = loop.run_until_complete(_async_recalculate())
    finally:
        loop.close()
    return {"status": "completed", "deals_updated": count}


async def _async_recalculate() -> int:
    from sqlmodel import select

    from app.database import AsyncSessionLocal
    from app.models.activity import Activity
    from app.models.deal import Deal
    from app.services.deal_health import compute_health

    updated = 0
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Deal).where(Deal.stage.notin_(_CLOSED_STAGES))
        )
        deals = result.scalars().all()

        for deal in deals:
            # Recompute days_in_stage from stage_entered_at
            if deal.stage_entered_at:
                deal.days_in_stage = (datetime.utcnow() - deal.stage_entered_at).days
            elif deal.created_at:
                deal.days_in_stage = (datetime.utcnow() - deal.created_at).days

            acts_result = await session.execute(
                select(Activity).where(Activity.deal_id == deal.id)
            )
            activities = acts_result.scalars().all()

            score, health = compute_health(deal, activities)
            deal.health_score = score
            deal.health = health
            session.add(deal)
            updated += 1

        await session.commit()

    logger.info(f"Health recalculated for {updated} deals")
    return updated
