from collections import defaultdict
from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, Query
from sqlalchemy import and_, case, or_, select

from app.core.dependencies import CurrentUser, DBSession
from app.core.exceptions import NotFoundError, ValidationError
from app.models.company import Company
from app.models.contact import Contact
from app.models.deal import Deal
from app.models.task import (
    TASK_ASSIGNED_ROLES,
    TASK_ENTITY_TYPES,
    TASK_PRIORITIES,
    TASK_STATUSES,
    Task,
    TaskComment,
    TaskCommentCreate,
    TaskCommentRead,
    TaskCreate,
    TaskRead,
    TaskUpdate,
    TaskWorkspaceRead,
)
from app.models.user import User
from app.services.tasks import apply_task_action, refresh_system_tasks_for_entity

router = APIRouter(prefix="/tasks", tags=["tasks"])


def _validate_entity_type(entity_type: str) -> None:
    if entity_type not in TASK_ENTITY_TYPES:
        raise ValidationError(f"entity_type must be one of: {sorted(TASK_ENTITY_TYPES)}")


def _validate_priority(priority: str) -> None:
    if priority not in TASK_PRIORITIES:
        raise ValidationError(f"priority must be one of: {sorted(TASK_PRIORITIES)}")


def _validate_status(status: str) -> None:
    if status not in TASK_STATUSES:
        raise ValidationError(f"status must be one of: {sorted(TASK_STATUSES)}")


def _validate_assigned_role(role: str) -> None:
    if role not in TASK_ASSIGNED_ROLES:
        raise ValidationError(f"assigned_role must be one of: {sorted(TASK_ASSIGNED_ROLES)}")


async def _build_task_reads(session: DBSession, tasks: list[Task]) -> list[TaskRead]:
    if not tasks:
        return []

    task_ids = [task.id for task in tasks if task.id]
    user_ids = {task.created_by_id for task in tasks if task.created_by_id} | {task.assigned_to_id for task in tasks if task.assigned_to_id}

    comments_rows = (
        await session.execute(
            select(TaskComment, User.name.label("user_name"))
            .outerjoin(User, TaskComment.created_by_id == User.id)
            .where(TaskComment.task_id.in_(task_ids))
            .order_by(TaskComment.created_at.asc())
        )
    ).all()
    comments_by_task: dict[UUID, list[TaskCommentRead]] = defaultdict(list)
    for comment, user_name in comments_rows:
        read = TaskCommentRead.model_validate(comment)
        read.created_by_name = user_name
        comments_by_task[comment.task_id].append(read)
        if comment.created_by_id:
            user_ids.add(comment.created_by_id)

    users = {}
    if user_ids:
        user_rows = (
            await session.execute(select(User.id, User.name).where(User.id.in_(list(user_ids))))
        ).all()
        users = {user_id: name for user_id, name in user_rows}

    reads: list[TaskRead] = []
    for task in tasks:
        read = TaskRead.model_validate(task)
        read.created_by_name = users.get(task.created_by_id)
        read.assigned_to_name = users.get(task.assigned_to_id)
        read.comments = comments_by_task.get(task.id or UUID(int=0), [])
        reads.append(read)
    return reads


async def _build_workspace_task_reads(session: DBSession, tasks: list[Task]) -> list[TaskWorkspaceRead]:
    base_reads = await _build_task_reads(session, tasks)
    if not base_reads:
        return []

    ids_by_type: dict[str, list[UUID]] = defaultdict(list)
    for task in base_reads:
        ids_by_type[task.entity_type].append(task.entity_id)

    company_map: dict[UUID, Company] = {}
    contact_map: dict[UUID, Contact] = {}
    deal_map: dict[UUID, Deal] = {}

    if ids_by_type["company"]:
        rows = (
            await session.execute(select(Company).where(Company.id.in_(ids_by_type["company"])))
        ).scalars().all()
        company_map = {row.id: row for row in rows if row.id}
    if ids_by_type["contact"]:
        rows = (
            await session.execute(select(Contact).where(Contact.id.in_(ids_by_type["contact"])))
        ).scalars().all()
        contact_map = {row.id: row for row in rows if row.id}
    if ids_by_type["deal"]:
        rows = (
            await session.execute(select(Deal).where(Deal.id.in_(ids_by_type["deal"])))
        ).scalars().all()
        deal_map = {row.id: row for row in rows if row.id}

    reads: list[TaskWorkspaceRead] = []
    for task in base_reads:
        entity_name = "Unknown record"
        entity_subtitle = None
        entity_link = "/"

        if task.entity_type == "company":
            company = company_map.get(task.entity_id)
            if company:
                entity_name = company.name
                entity_subtitle = company.domain
            entity_link = f"/account-sourcing/{task.entity_id}"
        elif task.entity_type == "contact":
            contact = contact_map.get(task.entity_id)
            if contact:
                entity_name = f"{contact.first_name} {contact.last_name}".strip()
                entity_subtitle = contact.title or contact.email or contact.company_name
            entity_link = f"/account-sourcing/contacts/{task.entity_id}"
        elif task.entity_type == "deal":
            deal = deal_map.get(task.entity_id)
            if deal:
                entity_name = deal.name
                entity_subtitle = deal.stage.replace("_", " ")
            entity_link = f"/deals/{task.entity_id}"

        reads.append(
            TaskWorkspaceRead(
                **task.model_dump(),
                entity_name=entity_name,
                entity_subtitle=entity_subtitle,
                entity_link=entity_link,
            )
        )
    return reads


@router.get("/", response_model=list[TaskRead])
async def list_tasks(
    session: DBSession,
    current_user: CurrentUser,
    entity_type: str = Query(...),
    entity_id: UUID = Query(...),
    include_closed: bool = Query(default=True),
):
    _ = current_user
    _validate_entity_type(entity_type)

    await refresh_system_tasks_for_entity(session, entity_type, entity_id)
    await session.commit()

    status_rank = case(
        (Task.status == "open", 0),
        (Task.status == "completed", 1),
        else_=2,
    )
    priority_rank = case(
        (Task.priority == "high", 0),
        (Task.priority == "medium", 1),
        else_=2,
    )

    stmt = (
        select(Task)
        .where(Task.entity_type == entity_type, Task.entity_id == entity_id)
        .order_by(status_rank, priority_rank, Task.created_at.desc())
    )
    if not include_closed:
        stmt = stmt.where(Task.status == "open")

    tasks = (await session.execute(stmt)).scalars().all()
    return await _build_task_reads(session, tasks)


@router.get("/workspace", response_model=list[TaskWorkspaceRead])
async def list_workspace_tasks(
    session: DBSession,
    current_user: CurrentUser,
    include_closed: bool = Query(default=False),
    task_type: str | None = Query(default=None),
    entity_type: str | None = Query(default=None),
):
    if task_type and task_type not in {"manual", "system"}:
        raise ValidationError("task_type must be one of: ['manual', 'system']")
    if entity_type:
        _validate_entity_type(entity_type)

    ownership_filter = or_(
        Task.assigned_to_id == current_user.id,
        and_(Task.assigned_to_id.is_(None), Task.assigned_role == current_user.role),
        and_(Task.created_by_id == current_user.id, Task.task_type == "manual"),
    )
    status_rank = case(
        (Task.status == "open", 0),
        (Task.status == "completed", 1),
        else_=2,
    )
    priority_rank = case(
        (Task.priority == "high", 0),
        (Task.priority == "medium", 1),
        else_=2,
    )

    stmt = (
        select(Task)
        .where(ownership_filter)
        .order_by(status_rank, priority_rank, Task.updated_at.desc())
    )
    if not include_closed:
        stmt = stmt.where(Task.status == "open")
    if task_type:
        stmt = stmt.where(Task.task_type == task_type)
    if entity_type:
        stmt = stmt.where(Task.entity_type == entity_type)

    tasks = (await session.execute(stmt)).scalars().all()
    return await _build_workspace_task_reads(session, tasks)


@router.post("/", response_model=TaskRead, status_code=201)
async def create_task(payload: TaskCreate, session: DBSession, current_user: CurrentUser):
    _validate_entity_type(payload.entity_type)
    _validate_priority(payload.priority)
    if payload.assigned_role:
        _validate_assigned_role(payload.assigned_role)

    task = Task(
        entity_type=payload.entity_type,
        entity_id=payload.entity_id,
        task_type="manual",
        title=payload.title.strip(),
        description=payload.description.strip() if payload.description else None,
        priority=payload.priority,
        due_at=payload.due_at,
        source="manual",
        created_by_id=current_user.id,
        assigned_role=payload.assigned_role or current_user.role,
        assigned_to_id=payload.assigned_to_id,
    )
    session.add(task)
    await session.commit()
    await session.refresh(task)
    reads = await _build_task_reads(session, [task])
    return reads[0]


@router.patch("/{task_id}", response_model=TaskRead)
async def update_task(task_id: UUID, payload: TaskUpdate, session: DBSession, current_user: CurrentUser):
    _ = current_user
    task = await session.get(Task, task_id)
    if not task:
        raise NotFoundError("Task not found")

    update_data = payload.model_dump(exclude_unset=True)
    if "priority" in update_data:
        _validate_priority(update_data["priority"])
    if "status" in update_data:
        _validate_status(update_data["status"])
        if update_data["status"] in {"completed", "dismissed"} and not task.completed_at:
            task.completed_at = datetime.utcnow()
    if "assigned_role" in update_data and update_data["assigned_role"] is not None:
        _validate_assigned_role(update_data["assigned_role"])
    for key, value in update_data.items():
        setattr(task, key, value)
    task.updated_at = datetime.utcnow()
    session.add(task)
    await session.commit()
    await session.refresh(task)
    reads = await _build_task_reads(session, [task])
    return reads[0]


@router.post("/{task_id}/comments", response_model=TaskCommentRead, status_code=201)
async def add_task_comment(task_id: UUID, payload: TaskCommentCreate, session: DBSession, current_user: CurrentUser):
    task = await session.get(Task, task_id)
    if not task:
        raise NotFoundError("Task not found")

    comment = TaskComment(
        task_id=task_id,
        body=payload.body.strip(),
        created_by_id=current_user.id,
    )
    task.updated_at = datetime.utcnow()
    session.add(comment)
    session.add(task)
    await session.commit()
    await session.refresh(comment)
    read = TaskCommentRead.model_validate(comment)
    read.created_by_name = current_user.name
    return read


@router.post("/{task_id}/accept", response_model=TaskRead)
async def accept_task(task_id: UUID, session: DBSession, current_user: CurrentUser):
    task = await session.get(Task, task_id)
    if not task:
        raise NotFoundError("Task not found")
    if task.task_type != "system":
        raise ValidationError("Only system tasks can be accepted")

    await apply_task_action(session, task, current_user)
    task.status = "completed"
    task.accepted_at = datetime.utcnow()
    task.completed_at = datetime.utcnow()
    task.updated_at = datetime.utcnow()
    session.add(task)
    await session.commit()
    await session.refresh(task)
    reads = await _build_task_reads(session, [task])
    return reads[0]
