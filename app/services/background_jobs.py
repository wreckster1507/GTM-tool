"""
Async in-process background jobs that run on the application's event loop.

This is intentionally lightweight, but unlike thread-backed execution it keeps
asyncpg/SQLAlchemy async sessions on the same loop they were created for.
"""
from __future__ import annotations

import asyncio
import inspect
import logging
from datetime import datetime
from threading import RLock
from typing import Any, Awaitable, Callable
from uuid import uuid4


logger = logging.getLogger(__name__)

JobRunner = Callable[[], Awaitable[Any] | Any]

_WORKER_COUNT = 2

_lock = RLock()
_worker_loop: asyncio.AbstractEventLoop | None = None
_job_queue: asyncio.Queue[str] | None = None
_worker_tasks: list[asyncio.Task[Any]] = []
_job_runners: dict[str, JobRunner] = {}
_jobs: dict[str, dict[str, Any]] = {}
_prospecting_batches: dict[str, dict[str, Any]] = {}
_cancelled_jobs: set[str] = set()


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


def _set_job_fields(job_id: str, **fields: Any) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            job.update(fields)


async def _background_worker(worker_index: int) -> None:
    logger.info("Background worker %s started", worker_index)

    while True:
        assert _job_queue is not None
        job_id = await _job_queue.get()

        try:
            with _lock:
                if job_id in _cancelled_jobs:
                    _jobs.pop(job_id, None)
                    _job_runners.pop(job_id, None)
                    continue

                runner = _job_runners.get(job_id)

            if runner is None:
                logger.warning("Background worker %s skipped missing runner for job %s", worker_index, job_id)
                continue

            _set_job_fields(job_id, status="running", started_at=_now_iso())
            logger.info("Background job %s started", job_id)

            result = runner()
            if inspect.isawaitable(result):
                result = await result

            _set_job_fields(
                job_id,
                status="completed",
                result=result,
                error=None,
                completed_at=_now_iso(),
            )
            logger.info("Background job %s completed", job_id)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - surfaced through status/logs
            logger.exception("Background job %s failed", job_id)
            _set_job_fields(
                job_id,
                status="failed",
                result=None,
                error=str(exc),
                completed_at=_now_iso(),
            )
        finally:
            with _lock:
                _job_runners.pop(job_id, None)
                _cancelled_jobs.discard(job_id)
            assert _job_queue is not None
            _job_queue.task_done()


def _enqueue_job(loop: asyncio.AbstractEventLoop, job_id: str) -> None:
    if _job_queue is None:
        raise RuntimeError("Background workers are not running")

    if loop is _worker_loop:
        _job_queue.put_nowait(job_id)
    else:
        _worker_loop.call_soon_threadsafe(_job_queue.put_nowait, job_id)


def _ensure_worker_runtime(loop: asyncio.AbstractEventLoop) -> None:
    global _worker_loop, _job_queue, _worker_tasks

    with _lock:
        active_tasks = [task for task in _worker_tasks if not task.done()]
        if _worker_loop is loop and _job_queue is not None and len(active_tasks) == _WORKER_COUNT:
            _worker_tasks = active_tasks
            return

        if _worker_loop is not None and _worker_loop is not loop and active_tasks:
            raise RuntimeError("Background workers are bound to a different event loop")

        _worker_loop = loop
        _job_queue = asyncio.Queue()
        _worker_tasks = [
            loop.create_task(_background_worker(index + 1), name=f"beacon-bg-{index + 1}")
            for index in range(_WORKER_COUNT)
        ]
        logger.info("Background workers initialized with %s workers", _WORKER_COUNT)


def queue_job(kind: str, runner: JobRunner, metadata: dict[str, Any] | None = None) -> str:
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError as exc:  # pragma: no cover - queueing happens inside async requests
        raise RuntimeError("queue_job must be called while an event loop is running") from exc

    _ensure_worker_runtime(loop)

    job_id = str(uuid4())
    payload = {
        "job_id": job_id,
        "kind": kind,
        "status": "queued",
        "metadata": metadata or {},
        "result": None,
        "error": None,
        "queued_at": _now_iso(),
        "started_at": None,
        "completed_at": None,
    }

    with _lock:
        _jobs[job_id] = payload
        _job_runners[job_id] = runner

    _enqueue_job(loop, job_id)
    logger.info("Queued background job %s (%s)", job_id, kind)
    return job_id


def get_job(job_id: str) -> dict[str, Any] | None:
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def create_prospecting_batch(batch: dict[str, Any]) -> None:
    batch_id = str(batch.get("batch_id") or "")
    if not batch_id:
        raise ValueError("Prospecting batch requires batch_id")

    with _lock:
        _prospecting_batches[batch_id] = dict(batch)


def get_prospecting_batch(batch_id: str) -> dict[str, Any] | None:
    with _lock:
        batch = _prospecting_batches.get(batch_id)
        if not batch:
            return None
        snapshot = dict(batch)

    companies = snapshot.get("companies")
    if not isinstance(companies, list):
        return snapshot

    queued = 0
    running = 0
    completed = 0
    failed = 0
    updated_companies: list[dict[str, Any]] = []

    for item in companies:
        company_row = dict(item) if isinstance(item, dict) else {"value": item}
        task_id = str(company_row.get("task_id") or "")
        job = get_job(task_id) if task_id else None
        if job:
            status = str(job.get("status") or "").lower()
            company_row["task_status"] = status or "unknown"
            company_row["task_result"] = job.get("result")
            company_row["task_error"] = job.get("error")
            if status == "queued":
                queued += 1
            elif status == "running":
                running += 1
            elif status == "completed":
                completed += 1
            elif status == "failed":
                failed += 1
        else:
            company_row["task_status"] = "unknown"
        updated_companies.append(company_row)

    total = len(updated_companies)
    batch_status = "queued"
    if failed and failed == total:
        batch_status = "failed"
    elif completed == total and total > 0:
        batch_status = "completed"
    elif running or completed or failed:
        batch_status = "processing"

    snapshot["status"] = batch_status
    snapshot["queued_jobs"] = queued
    snapshot["running_jobs"] = running
    snapshot["completed_jobs"] = completed
    snapshot["failed_jobs"] = failed
    snapshot["companies"] = updated_companies
    return snapshot


def clear_background_jobs() -> None:
    with _lock:
        pending_job_ids = list(_jobs.keys())
        _cancelled_jobs.update(pending_job_ids)
        _job_runners.clear()
        _jobs.clear()
        _prospecting_batches.clear()

    if _worker_loop and _job_queue:
        def _drain_queue() -> None:
            if _job_queue is None:
                return
            try:
                while True:
                    _job_queue.get_nowait()
                    _job_queue.task_done()
            except asyncio.QueueEmpty:
                return

        _worker_loop.call_soon_threadsafe(_drain_queue)

    logger.info("Cleared background job state")


async def start_background_workers() -> None:
    loop = asyncio.get_running_loop()
    _ensure_worker_runtime(loop)


async def shutdown_background_workers() -> None:
    global _worker_loop, _job_queue, _worker_tasks

    with _lock:
        tasks = list(_worker_tasks)
        _worker_tasks = []
        _job_queue = None
        _worker_loop = None

    for task in tasks:
        task.cancel()

    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
        logger.info("Background workers shut down")
