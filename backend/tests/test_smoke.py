"""End-to-end smoke test against the Mock provider — no GPU, no API keys.

Exercises the full loop: project -> nodes -> edge -> generate image -> generate
loop video -> triage/select -> upscale.
"""
from __future__ import annotations

import os
import tempfile

import pytest

# Point storage/db at a throwaway dir BEFORE importing the app.
os.environ["ANIMPIPE_DATA_DIR"] = tempfile.mkdtemp(prefix="animpipe-test-")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # triggers lifespan (db init + workers)
        yield c


def _wait_job(client, job_id, timeout=15.0):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_full_flow(client):
    assert client.get("/api/health").json()["status"] == "ok"

    pid = client.post("/api/projects", json={"name": "t"}).json()["id"]
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]
    n1 = client.post(f"/api/graphs/{gid}/nodes",
                     json={"key": "idle", "prompt": "hero standing"}).json()
    n2 = client.post(f"/api/graphs/{gid}/nodes",
                     json={"key": "wave", "prompt": "hero waving"}).json()

    # Keyframe images for both nodes.
    for n in (n1, n2):
        job = client.post(f"/api/nodes/{n['id']}/generate", json={"n": 3}).json()
        done = _wait_job(client, job["id"])
        assert done["status"] == "done"
        assets = client.get(f"/api/node/{n['id']}/assets").json()
        assert len(assets) == 3
        client.post(f"/api/nodes/{n['id']}/select/{assets[0]['id']}")

    # Loop edge (n1 -> n1) and a transition edge (n1 -> n2).
    loop = client.post(f"/api/graphs/{gid}/edges", json={
        "source_node_id": n1["id"], "target_node_id": n1["id"], "kind": "loop"}).json()
    trans = client.post(f"/api/graphs/{gid}/edges", json={
        "source_node_id": n1["id"], "target_node_id": n2["id"], "kind": "transition"}).json()

    for e in (loop, trans):
        job = client.post(f"/api/edges/{e['id']}/generate", json={"n": 2}).json()
        done = _wait_job(client, job["id"])
        assert done["status"] == "done"
        assets = client.get(f"/api/edge/{e['id']}/assets").json()
        assert len(assets) == 2
        assert all(a["kind"] == "video" for a in assets)

    # Triage: score + select a video.
    vid = client.get(f"/api/edge/{loop['id']}/assets").json()[0]
    scored = client.post(f"/api/assets/{vid['id']}/score").json()
    assert "overall" in scored["ai_score"]
    client.post(f"/api/edges/{loop['id']}/select/{vid['id']}")

    # Upscale a keyframe (two-stage cost saving).
    img = client.get(f"/api/node/{n1['id']}/assets").json()[0]
    up_job = client.post(f"/api/assets/{img['id']}/upscale", json={"params": {"scale": 2}}).json()
    assert _wait_job(client, up_job["id"])["status"] == "done"
