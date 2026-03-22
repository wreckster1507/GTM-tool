from uuid import UUID

from fastapi import APIRouter
from celery.result import AsyncResult

from app.core.dependencies import DBSession
from app.celery_app import celery_app
from app.repositories.company import CompanyRepository
from app.tasks.enrichment import enrich_company_task

router = APIRouter(prefix="/enrichment", tags=["enrichment"])


@router.post("/company/{company_id}")
async def trigger_company_enrichment(company_id: UUID, session: DBSession) -> dict:
    """Queue a Celery enrichment task for the given company."""
    company = await CompanyRepository(session).get_or_raise(company_id)
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
    result = AsyncResult(task_id, app=celery_app)

    return {
        "task_id": task_id,
        "status": result.state,
        "result": result.result if result.ready() else None,
    }
