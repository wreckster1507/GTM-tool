"""
Enrichment API — triggers background enrichment for a company.
"""
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_session
from app.models.company import Company

router = APIRouter(prefix="/enrichment", tags=["enrichment"])


@router.post("/company/{company_id}")
async def trigger_company_enrichment(
    company_id: UUID,
    session: AsyncSession = Depends(get_session),
) -> dict:
    """Queue a Celery enrichment task for the given company."""
    company = await session.get(Company, company_id)
    if not company:
        raise HTTPException(status_code=404, detail="Company not found")

    from app.tasks.enrichment import enrich_company_task

    task = enrich_company_task.delay(str(company_id))
    return {
        "status": "queued",
        "task_id": task.id,
        "company_id": str(company_id),
        "domain": company.domain,
        "message": f"Enrichment queued for {company.domain}",
    }


@router.get("/task/{task_id}")
async def get_task_status(task_id: str) -> dict:
    """Poll Celery task status."""
    from app.celery_app import celery_app

    result = celery_app.AsyncResult(task_id)
    return {
        "task_id": task_id,
        "status": result.status,
        "result": result.result if result.ready() else None,
    }
