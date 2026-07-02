"""Bundle export e2e over Mock: build a tiny playable scene, export, and
verify the zip carries the contract (graph.json), converted media, the
reference runtime and the compile pack."""
from __future__ import annotations

import json
import os
import tempfile
import zipfile
from pathlib import Path

import pytest

os.environ.setdefault("ANIMPIPE_DATA_DIR", tempfile.mkdtemp(prefix="animpipe-test-"))

from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def _wait_job(client, job_id, timeout=60.0):
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        j = client.get(f"/api/jobs/{job_id}").json()
        if j["status"] in ("done", "error"):
            return j
        time.sleep(0.2)
    raise AssertionError("job did not finish")


def test_export_bundle(client):
    pid = client.post("/api/projects", json={"name": "Duel Demo"}).json()["id"]
    client.patch(f"/api/projects/{pid}", json={"meta": {"variables": [
        {"name": "depth", "type": "number", "default": 0},
    ]}})
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]

    n1 = client.post(f"/api/graphs/{gid}/nodes", json={"key": "awake", "prompt": "a"}).json()
    n2 = client.post(f"/api/graphs/{gid}/nodes", json={"key": "deep", "prompt": "b"}).json()
    for n in (n1, n2):
        job = client.post(f"/api/nodes/{n['id']}/generate", json={"n": 1}).json()
        assert _wait_job(client, job["id"])["status"] == "done"
        aid = client.get(f"/api/node/{n['id']}/assets").json()[0]["id"]
        client.post(f"/api/nodes/{n['id']}/select/{aid}")
    client.patch(f"/api/graphs/{gid}", json={"start_node_id": n1["id"]})

    edge = client.post(f"/api/graphs/{gid}/edges", json={
        "source_node_id": n1["id"], "target_node_id": n2["id"],
        "kind": "transition", "label": "descend",
    }).json()
    client.patch(f"/api/edges/{edge['id']}", json={"params": {"logic": {
        "type": "choice", "trigger": "Swing pendant",
        "effects": [{"op": "add", "var": "depth", "value": 1}],
    }}})
    job = client.post(f"/api/edges/{edge['id']}/generate", json={"n": 1}).json()
    assert _wait_job(client, job["id"])["status"] == "done"
    vid = client.get(f"/api/edge/{edge['id']}/assets").json()[0]["id"]
    client.post(f"/api/edges/{edge['id']}/select/{vid}")

    # -- export ---------------------------------------------------------------
    job = client.post(f"/api/projects/{pid}/export").json()
    assert job["kind"] == "export"
    done = _wait_job(client, job["id"])
    assert done["status"] == "done", done.get("error")
    zip_name = done["params"]["output"]
    assert zip_name.endswith(".zip")

    # download route works
    r = client.get(f"/api/exports/{zip_name}")
    assert r.status_code == 200

    zf = zipfile.ZipFile(Path(get_settings().data_dir) / "exports" / zip_name)
    names = set(zf.namelist())
    for required in ("graph.json", "characters.json", "instructions.md",
                     "style.md", "COMPILE_PACK.md", "index.html", "runtime.js"):
        assert required in names, f"missing {required}"

    g = json.loads(zf.read("graph.json"))
    assert g["schema"] == "anim-pipe-bundle@1"
    assert g["variables"][0]["name"] == "depth"
    scene = g["scenes"][0]
    assert scene["start"] == n1["id"]
    nodes = {n["key"]: n for n in scene["nodes"]}
    assert nodes["awake"]["image"].endswith(".webp")
    assert nodes["awake"]["image"] in names  # converted still is in the zip
    e = scene["edges"][0]
    assert e["logic"]["trigger"] == "Swing pendant"
    assert e["clip"] and e["clip"] in names  # clip exported (webm, or source fallback)

    # path traversal is rejected
    assert client.get("/api/exports/..%2Fanimpipe.sqlite").status_code in (404, 422)
