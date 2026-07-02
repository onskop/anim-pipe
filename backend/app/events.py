"""Server-sent events — push job updates to the UI instead of polling.

A tiny in-process pub/sub: the queue worker and pipeline publish job snapshots,
every connected UI subscribes via ``GET /api/events``. Events are JSON with a
``type`` discriminator ("job" today; more event types can ride the same stream).
Slow consumers just drop events — the UI refetches state on reconnect, the DB
stays the source of truth.
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator

_subscribers: set[asyncio.Queue] = set()

KEEPALIVE_SECONDS = 15.0


def publish(event: dict[str, Any]) -> None:
    data = json.dumps(event)
    for q in list(_subscribers):
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            pass


def publish_job(job: Any) -> None:
    """Snapshot a GenerationJob row onto the stream."""
    publish({
        "type": "job",
        "id": job.id,
        "project_id": job.project_id,
        "target_type": job.target_type,
        "target_id": job.target_id,
        "kind": job.kind,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "cost": job.cost,
    })


async def stream() -> AsyncIterator[str]:
    """SSE frame generator for one client connection."""
    q: asyncio.Queue = asyncio.Queue(maxsize=256)
    _subscribers.add(q)
    try:
        yield "retry: 2000\n\n"
        while True:
            try:
                data = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_SECONDS)
                yield f"data: {data}\n\n"
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
    finally:
        _subscribers.discard(q)
