from uuid import UUID

from fastapi import APIRouter

from app.core.dependencies import DBSession
from app.repositories.company import CompanyRepository
from app.database import AsyncSessionLocal
from app.services.background_jobs import get_job, queue_job

router = APIRouter(prefix="/enrichment", tags=["enrichment"])


@router.post("/company/{company_id}")
async def trigger_company_enrichment(company_id: UUID, session: DBSession) -> dict:
    """Queue an in-process enrichment task for the given company."""
    company = await CompanyRepository(session).get_or_raise(company_id)
    from app.services.enrichment_orchestrator import enrich_company_by_id

    async def run() -> dict:
        async with AsyncSessionLocal() as background_session:
            enriched = await enrich_company_by_id(company_id, background_session)
            return {
                "company_id": str(company_id),
                "domain": company.domain,
                "enriched": bool(enriched),
            }

    task_id = queue_job(
        kind="company_enrichment",
        runner=run,
        metadata={"company_id": str(company_id), "domain": company.domain},
    )

    return {
        "status": "queued",
        "task_id": task_id,
        "company_id": str(company_id),
        "domain": company.domain,
        "message": f"Enrichment queued for {company.domain}",
    }


@router.get("/task/{task_id}")
async def get_task_status(task_id: str) -> dict:
    """Poll in-process task status."""
    result = get_job(task_id)
    if not result:
        return {
            "task_id": task_id,
            "status": "UNKNOWN",
            "result": None,
        }

    return {
        "task_id": task_id,
        "status": result["status"],
        "result": result["result"],
    }
