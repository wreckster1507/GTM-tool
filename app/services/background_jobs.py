from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable
from uuid import uuid4


JobRecord = dict[str, Any]

_jobs: dict[str, JobRecord] = {}
_prospecting_batches: dict[str, dict[str, Any]] = {}


def _utcnow_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _run_job(job_id: str, runner: Callable[[], Awaitable[Any]]) -> None:
    record = _jobs[job_id]
    record["status"] = "STARTED"
    record["started_at"] = _utcnow_iso()
    try:
        result = await runner()
    except Exception as exc:
        record["status"] = "FAILURE"
        record["error"] = str(exc)
        record["finished_at"] = _utcnow_iso()
        return

    record["status"] = "SUCCESS"
    record["result"] = result
    record["finished_at"] = _utcnow_iso()


def queue_job(
    *,
    kind: str,
    runner: Callable[[], Awaitable[Any]],
    metadata: dict[str, Any] | None = None,
) -> str:
    job_id = str(uuid4())
    _jobs[job_id] = {
        "job_id": job_id,
        "kind": kind,
        "status": "PENDING",
        "created_at": _utcnow_iso(),
        "started_at": None,
        "finished_at": None,
        "result": None,
        "error": None,
        "metadata": metadata or {},
    }
    asyncio.create_task(_run_job(job_id, runner))
    return job_id


def get_job(job_id: str) -> JobRecord | None:
    return _jobs.get(job_id)


def create_prospecting_batch(batch: dict[str, Any]) -> str:
    batch_id = batch["batch_id"]
    _prospecting_batches[batch_id] = batch
    return batch_id


def get_prospecting_batch(batch_id: str) -> dict[str, Any] | None:
    batch = _prospecting_batches.get(batch_id)
    if not batch:
        return None

    completed = 0
    companies = []
    for company in batch.get("companies", []):
        task_id = company.get("task_id")
        task = get_job(task_id) if task_id else None
        status = str(task.get("status") if task else company.get("status") or "PENDING").lower()
        if status == "success":
            completed += 1
        updated = dict(company)
        updated["status"] = status
        companies.append(updated)

    return {
        **batch,
        "companies": companies,
        "completed_enrichments": completed,
    }


def clear_background_jobs() -> None:
    _jobs.clear()
    _prospecting_batches.clear()
