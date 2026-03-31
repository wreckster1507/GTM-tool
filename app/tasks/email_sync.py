"""
Celery task: poll Gmail shared inbox and create deal activities.

Flow:
  1. Read last_sync_epoch from Redis (or default to 1 hour ago)
  2. Fetch new emails from Gmail API via after:EPOCH query
  3. For each email:
     a. Extract all email addresses (from/to/cc)
     b. Match them against contacts table
     c. Find deals linked to those contacts via deal_contacts
     d. Deduplicate using email_message_id + deal_id
     e. Create Activity records with type="email"
     f. Optionally generate AI summary via Claude Haiku
  4. Update last_sync_epoch in Redis
"""
import asyncio
import logging
import time
from datetime import datetime, timedelta
from uuid import UUID

from app.celery_app import celery_app
from app.config import settings

logger = logging.getLogger(__name__)

REDIS_KEY_LAST_SYNC = "email_sync:last_epoch"


@celery_app.task(
    name="app.tasks.email_sync.sync_gmail_inbox",
    bind=True,
    max_retries=2,
    default_retry_delay=120,
)
def sync_gmail_inbox(self) -> dict:
    """Poll shared Gmail inbox and log emails as deal activities."""
    if not settings.GMAIL_SHARED_INBOX:
        return {"status": "skipped", "reason": "no inbox configured"}

    try:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            result = loop.run_until_complete(_async_sync())
        finally:
            loop.close()
        return result
    except Exception as exc:
        logger.error(f"Email sync failed: {exc}")
        raise self.retry(exc=exc)


async def _async_sync() -> dict:
    import redis
    from sqlalchemy import and_, select
    from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
    from sqlalchemy.orm import sessionmaker

    from app.clients.gmail_inbox import GmailInboxClient
    from app.models.activity import Activity
    from app.models.contact import Contact
    from app.models.deal import DealContact

    # Fresh engine per task
    engine = create_async_engine(settings.DATABASE_URL, echo=False)
    SessionLocal = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    # Redis for cursor tracking
    r = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)

    try:
        # Get last sync timestamp (default: 1 hour ago)
        last_epoch_str = r.get(REDIS_KEY_LAST_SYNC)
        if last_epoch_str:
            last_epoch = int(last_epoch_str)
        else:
            last_epoch = int(time.time()) - 3600

        current_epoch = int(time.time())

        # Fetch new emails
        gmail = GmailInboxClient()
        messages = gmail.fetch_new_messages(after_epoch=last_epoch, max_results=50)

        if not messages:
            r.set(REDIS_KEY_LAST_SYNC, str(current_epoch))
            return {"status": "completed", "emails_found": 0, "activities_created": 0}

        activities_created = 0

        async with SessionLocal() as session:
            for msg in messages:
                # Collect all email addresses from this message
                all_addrs = set()
                all_addrs.add(msg.from_addr)
                all_addrs.update(msg.to_addrs)
                all_addrs.update(msg.cc_addrs)
                # Remove the shared inbox address itself
                all_addrs.discard(settings.GMAIL_SHARED_INBOX.lower())
                all_addrs.discard("")

                if not all_addrs:
                    continue

                # Find matching contacts
                contact_result = await session.execute(
                    select(Contact.id, Contact.email).where(
                        Contact.email.in_(list(all_addrs))
                    )
                )
                matched_contacts = contact_result.all()

                if not matched_contacts:
                    continue

                contact_ids = [c.id for c in matched_contacts]

                # Find deals linked to these contacts
                deal_result = await session.execute(
                    select(DealContact.deal_id).where(
                        DealContact.contact_id.in_(contact_ids)
                    ).distinct()
                )
                deal_ids = [row.deal_id for row in deal_result.all()]

                if not deal_ids:
                    continue

                # Determine sender contact (for activity.contact_id)
                sender_contact_id = None
                for c in matched_contacts:
                    if c.email == msg.from_addr:
                        sender_contact_id = c.id
                        break

                # Generate AI summary for non-trivial emails
                ai_summary = None
                if len(msg.body_text) >= settings.EMAIL_SUMMARY_MIN_CHARS:
                    ai_summary = await _summarize_email(msg.subject, msg.body_text)

                # Create activity for each linked deal (with dedup)
                for deal_id in deal_ids:
                    # Check for existing activity with same message_id + deal_id
                    existing = await session.execute(
                        select(Activity.id).where(
                            and_(
                                Activity.email_message_id == msg.message_id,
                                Activity.deal_id == deal_id,
                            )
                        )
                    )
                    if existing.first():
                        continue  # Already logged

                    activity = Activity(
                        type="email",
                        source="gmail_sync",
                        deal_id=deal_id,
                        contact_id=sender_contact_id,
                        content=msg.body_text[:2000] if msg.body_text else None,
                        ai_summary=ai_summary,
                        email_message_id=msg.message_id,
                        email_subject=msg.subject,
                        email_from=msg.from_addr,
                        email_to=", ".join(msg.to_addrs),
                        email_cc=", ".join(msg.cc_addrs),
                    )
                    session.add(activity)
                    activities_created += 1

            await session.commit()

        # Update cursor
        r.set(REDIS_KEY_LAST_SYNC, str(current_epoch))

        logger.info(f"Email sync complete: {len(messages)} emails → {activities_created} activities")
        return {
            "status": "completed",
            "emails_found": len(messages),
            "activities_created": activities_created,
        }

    finally:
        await engine.dispose()
        r.close()


async def _summarize_email(subject: str, body: str) -> str | None:
    """Generate a concise 1-line email summary using Claude Haiku."""
    if not settings.claude_api_key:
        return None

    try:
        import anthropic

        client = anthropic.AsyncAnthropic(api_key=settings.claude_api_key)

        response = await client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=80,
            messages=[{
                "role": "user",
                "content": (
                    "Summarize this sales email in one short sentence (max 15 words). "
                    "Focus on the key action or decision.\n\n"
                    f"Subject: {subject}\n\n"
                    f"{body[:1500]}"
                ),
            }],
        )
        return response.content[0].text.strip()

    except Exception as e:
        logger.warning(f"Email summary failed: {e}")
        return None
