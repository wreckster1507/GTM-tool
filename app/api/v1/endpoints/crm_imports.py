from typing import Optional

from fastapi import APIRouter, HTTPException
from sqlmodel import SQLModel

from app.core.dependencies import CurrentUser, DBSession
from app.services.clickup_import import import_sales_crm_clickup
from app.services.permissions import require_workspace_permission


router = APIRouter(prefix="/crm-imports", tags=["crm-imports"])


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

    try:
        return await import_sales_crm_clickup(
            session,
            replace_existing=body.replace_existing,
            limit=body.limit or 0,
            cache_dir=body.cache_dir,
            skip_comments=body.skip_comments,
            skip_subtasks=body.skip_subtasks,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
