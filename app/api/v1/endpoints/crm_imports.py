import logging
from time import perf_counter
from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel

from app.core.dependencies import CurrentUser, DBSession
from app.services.clickup_import import import_sales_crm_clickup
from app.services.permissions import require_workspace_permission


router = APIRouter(prefix="/crm-imports", tags=["crm-imports"])
logger = logging.getLogger(__name__)


class ClickUpCrmImportRequest(SQLModel):
    replace_existing: bool = True
    limit: Optional[int] = None
    cache_dir: Optional[str] = "tmp/clickup_import_cache"
    skip_comments: bool = False
    skip_subtasks: bool = False


@router.post("/clickup-sales-crm", response_model=dict)
async def import_clickup_sales_crm(
    body: ClickUpCrmImportRequest,
    session: DBSession,
    current_user: CurrentUser,
):
    await require_workspace_permission(session, current_user, "crm_import")
    started_at = perf_counter()
    logger.info(
        "clickup crm import started by %s (replace_existing=%s, limit=%s, skip_comments=%s, skip_subtasks=%s)",
        current_user.email,
        body.replace_existing,
        body.limit or 0,
        body.skip_comments,
        body.skip_subtasks,
    )

    try:
        result = await import_sales_crm_clickup(
            session,
            replace_existing=body.replace_existing,
            limit=body.limit or 0,
            cache_dir=body.cache_dir,
            skip_comments=body.skip_comments,
            skip_subtasks=body.skip_subtasks,
        )
        logger.info(
            "clickup crm import finished in %.1fs (deals_seen=%s, deals_created=%s, deals_updated=%s, companies_created=%s, activities_created=%s)",
            perf_counter() - started_at,
            result.get("import", {}).get("top_level_tasks_seen"),
            result.get("import", {}).get("deals_created"),
            result.get("import", {}).get("deals_updated"),
            result.get("import", {}).get("companies_created"),
            result.get("import", {}).get("activities_created"),
        )
        return result
    except RuntimeError as exc:
        logger.warning("clickup crm import rejected: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        logger.exception("clickup crm import failed after %.1fs", perf_counter() - started_at)
        raise
