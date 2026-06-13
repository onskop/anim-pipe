"""In-process async job queue.

A background worker drains queued GenerationJobs with bounded concurrency. Good
enough for a single-user local tool; the DB is the source of truth so the UI can
poll job status/progress. Swap for Celery/RQ later if you go multi-user.
"""
from __future__ import annotations

import asyncio
import datetime as dt
import logging

from .config import get_settings
from .db import session_scope
from .models import GenerationJob
from .pipeline import run_job

log = logging.getLogger("animpipe.queue")

_queue: asyncio.Queue[str] = asyncio.Queue()
_workers: list[asyncio.Task] = []


def enqueue(job_id: str) -> None:
    _queue.put_nowait(job_id)


async def _process(job_id: str) -> None:
    with session_scope() as db:
        job = db.get(GenerationJob, job_id)
        if not job or job.status not in ("queued", "running"):
            return
        job.status = "running"
        job.started_at = dt.datetime.now(dt.timezone.utc)
        db.commit()
        try:
            await run_job(db, job)
            job.status = "done"
        except Exception as exc:  # noqa: BLE001
            log.exception("job %s failed", job_id)
            job.status = "error"
            job.error = str(exc)
        finally:
            job.finished_at = dt.datetime.now(dt.timezone.utc)
            db.commit()


async def _worker(idx: int) -> None:
    while True:
        job_id = await _queue.get()
        try:
            await _process(job_id)
        finally:
            _queue.task_done()


def start_workers() -> None:
    if _workers:
        return
    n = max(1, get_settings().max_concurrent_jobs)
    for i in range(n):
        _workers.append(asyncio.create_task(_worker(i)))
    log.info("started %d generation worker(s)", n)


def requeue_pending() -> None:
    """On startup, re-enqueue jobs left queued/running by a previous run."""
    with session_scope() as db:
        from sqlalchemy import select

        rows = db.execute(
            select(GenerationJob.id).where(GenerationJob.status.in_(("queued", "running")))
        ).scalars().all()
    for jid in rows:
        enqueue(jid)
