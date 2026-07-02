"""Image-edit derive: keyframe candidates from an existing image, over Mock.

Covers the consistency-first generation path: generate a source keyframe, then
POST /nodes/{nid}/derive with an instruction and check the derived candidates
carry lineage back to the source.
"""
from __future__ import annotations

import os
import tempfile

import pytest

# Point storage/db at a throwaway dir BEFORE importing the app.
os.environ.setdefault("ANIMPIPE_DATA_DIR", tempfile.mkdtemp(prefix="animpipe-test-"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
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


def test_derive_from_keyframe(client):
    pid = client.post("/api/projects", json={"name": "derive"}).json()["id"]
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]
    node = client.post(f"/api/graphs/{gid}/nodes",
                       json={"key": "awake", "prompt": "standing tall"}).json()

    job = client.post(f"/api/nodes/{node['id']}/generate", json={"n": 1}).json()
    assert _wait_job(client, job["id"])["status"] == "done"
    src = client.get(f"/api/node/{node['id']}/assets").json()[0]

    r = client.post(f"/api/nodes/{node['id']}/derive", json={
        "source_asset_id": src["id"],
        "instruction": "same framing, but eyes closed",
        "n": 2,
    })
    assert r.status_code == 200
    job = r.json()
    assert job["kind"] == "image_edit"
    assert _wait_job(client, job["id"])["status"] == "done"

    assets = client.get(f"/api/node/{node['id']}/assets").json()
    derived = [a for a in assets if a["parent_asset_id"] == src["id"]]
    assert len(derived) == 2
    for a in derived:
        assert a["kind"] == "image"
        assert a["role"] == "keyframe"
        assert a["params"]["instruction"] == "same framing, but eyes closed"
        assert a["params"]["source_asset_id"] == src["id"]


def test_derive_validation(client):
    pid = client.post("/api/projects", json={"name": "derive-val"}).json()["id"]
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]
    node = client.post(f"/api/graphs/{gid}/nodes", json={"key": "n1"}).json()

    job = client.post(f"/api/nodes/{node['id']}/generate", json={"n": 1}).json()
    _wait_job(client, job["id"])
    src = client.get(f"/api/node/{node['id']}/assets").json()[0]

    # Blank instruction is rejected.
    r = client.post(f"/api/nodes/{node['id']}/derive",
                    json={"source_asset_id": src["id"], "instruction": "   "})
    assert r.status_code == 400

    # A source from another project is rejected.
    pid2 = client.post("/api/projects", json={"name": "other"}).json()["id"]
    gid2 = client.post(f"/api/projects/{pid2}/graphs", json={"name": "Main"}).json()["id"]
    node2 = client.post(f"/api/graphs/{gid2}/nodes", json={"key": "x"}).json()
    r = client.post(f"/api/nodes/{node2['id']}/derive",
                    json={"source_asset_id": src["id"], "instruction": "shift pose"})
    assert r.status_code == 400
