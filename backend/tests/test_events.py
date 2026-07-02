"""SSE pub/sub unit tests (no HTTP layer needed)."""
from __future__ import annotations

import asyncio
import os
import tempfile

os.environ.setdefault("ANIMPIPE_DATA_DIR", tempfile.mkdtemp(prefix="animpipe-test-"))

from app import events  # noqa: E402


def test_pubsub_roundtrip():
    async def go():
        gen = events.stream()
        first = await gen.__anext__()  # subscribes + emits the retry preamble
        assert first.startswith("retry:")

        events.publish({"type": "job", "id": "j1", "status": "done"})
        frame = await gen.__anext__()
        assert frame.startswith("data:")
        assert '"j1"' in frame and '"done"' in frame

        await gen.aclose()
        assert not events._subscribers  # unsubscribed on close

    asyncio.run(go())


def test_publish_job_snapshot():
    class FakeJob:
        id = "j2"
        project_id = "p"
        target_type = "node"
        target_id = "n"
        kind = "image"
        status = "running"
        progress = 0.5
        error = None
        cost = 0.0

    async def go():
        gen = events.stream()
        await gen.__anext__()
        events.publish_job(FakeJob())
        frame = await gen.__anext__()
        assert '"type": "job"' in frame and '"progress": 0.5' in frame
        await gen.aclose()

    asyncio.run(go())
