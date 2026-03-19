"""
Prospecting routes — bulk CSV import of target companies.

CSV format (header row required):
  domain        — required
  name          — optional (falls back to domain root if missing)
  industry      — optional
  employee_count — optional integer
  funding_stage — optional

Flow:
  1. Parse CSV rows
  2. Create Company records (skip duplicates by domain)
  3. Queue enrichment task for each new company
  4. Store batch status in Redis (TTL 24h)
  5. Return batch_id for polling

Status polling: GET /prospecting/status/{batch_id}
"""
import csv
import io
import json
import uuid
from datetime import datetime
from typing import Optional

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import settings
from app.database import get_session
from app.models.company import Company
from app.services.icp_scorer import score_company
from app.tasks.enrichment import enrich_company_task

router = APIRouter(prefix="/prospecting", tags=["prospecting"])

_BATCH_TTL = 86_400  # 24 hours


# ── helpers ────────────────────────────────────────────────────────────────────

def _get_redis():
    return aioredis.from_url(settings.REDIS_URL, decode_responses=True)


def _parse_csv(content: bytes) -> list[dict]:
    text = content.decode("utf-8-sig")  # strip BOM if present
    reader = csv.DictReader(io.StringIO(text))
    rows = []
    for row in reader:
        cleaned = {k.strip().lower(): v.strip() for k, v in row.items() if k}
        if cleaned.get("domain"):
            rows.append(cleaned)
    return rows


def _row_to_company_fields(row: dict) -> dict:
    domain = row["domain"].lower().strip()
    name = row.get("name") or domain.split(".")[0].replace("-", " ").title()
    fields = {"name": name, "domain": domain}
    if row.get("industry"):
        fields["industry"] = row["industry"]
    if row.get("employee_count"):
        try:
            fields["employee_count"] = int(row["employee_count"])
        except ValueError:
            pass
    if row.get("funding_stage"):
        fields["funding_stage"] = row["funding_stage"]
    return fields


# ── routes ─────────────────────────────────────────────────────────────────────

@router.post("/bulk")
async def bulk_prospect(
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_session),
):
    """
    Upload a CSV of target companies. Creates Company records and queues
    enrichment (Hunter firmographics + contacts + Google News signals) for each.
    """
    if not file.filename.endswith(".csv"):
        raise HTTPException(status_code=400, detail="File must be a .csv")

    content = await file.read()
    rows = _parse_csv(content)

    if not rows:
        raise HTTPException(status_code=400, detail="CSV has no valid rows. 'domain' column is required.")

    batch_id = str(uuid.uuid4())
    created = []
    skipped = []
    failed = []

    for row in rows:
        domain = row["domain"]
        try:
            # Skip if domain already exists
            existing = await session.execute(
                select(Company).where(Company.domain == domain)
            )
            if existing.scalar_one_or_none():
                skipped.append(domain)
                continue

            fields = _row_to_company_fields(row)
            company = Company(**fields)
            company.icp_score, company.icp_tier = score_company(company)
            session.add(company)
            await session.commit()
            await session.refresh(company)

            # Queue enrichment
            task = enrich_company_task.delay(str(company.id))

            created.append({
                "domain": domain,
                "company_id": str(company.id),
                "task_id": task.id,
                "status": "queued",
            })

        except Exception as e:
            await session.rollback()
            failed.append({"domain": domain, "error": str(e)})

    # Store batch in Redis for status polling
    batch = {
        "batch_id": batch_id,
        "created_at": datetime.utcnow().isoformat(),
        "total": len(rows),
        "created": len(created),
        "skipped": len(skipped),
        "failed": len(failed),
        "companies": created,
        "skipped_domains": skipped,
        "failed_rows": failed,
    }
    r = _get_redis()
    await r.setex(f"batch:{batch_id}", _BATCH_TTL, json.dumps(batch))
    await r.aclose()

    return batch


@router.get("/status/{batch_id}")
async def batch_status(batch_id: str):
    """Poll enrichment progress for a bulk import batch."""
    r = _get_redis()
    raw = await r.get(f"batch:{batch_id}")
    await r.aclose()

    if not raw:
        raise HTTPException(status_code=404, detail="Batch not found or expired")

    batch = json.loads(raw)

    # Check live task statuses from Celery
    from celery.result import AsyncResult
    from app.celery_app import celery_app

    completed = 0
    for company in batch.get("companies", []):
        task_id = company.get("task_id")
        if task_id:
            result = AsyncResult(task_id, app=celery_app)
            company["status"] = result.state.lower()
            if result.state == "SUCCESS":
                completed += 1

    batch["completed_enrichments"] = completed
    return batch
