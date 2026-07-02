"""Logic-layer persistence: edge/node params and project meta round-trip.

The declarative gameplay layer (variables, conditions, effects) lives in the
existing JSON columns — these tests pin the PATCH contracts the editor uses.
"""
from __future__ import annotations

import os
import tempfile

import pytest

os.environ.setdefault("ANIMPIPE_DATA_DIR", tempfile.mkdtemp(prefix="animpipe-test-"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


def test_edge_logic_roundtrip(client):
    pid = client.post("/api/projects", json={"name": "logic"}).json()["id"]
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]
    n1 = client.post(f"/api/graphs/{gid}/nodes", json={"key": "a"}).json()
    n2 = client.post(f"/api/graphs/{gid}/nodes", json={"key": "b"}).json()
    edge = client.post(f"/api/graphs/{gid}/edges", json={
        "source_node_id": n1["id"], "target_node_id": n2["id"], "kind": "transition",
    }).json()

    logic = {
        "type": "choice",
        "trigger": "Swing pendant",
        "condition": [{"var": "depth", "op": ">=", "value": 1}],
        "effects": [{"op": "add", "var": "depth", "value": 1}],
        "once": False,
    }
    r = client.patch(f"/api/edges/{edge['id']}", json={"params": {"logic": logic}})
    assert r.status_code == 200
    assert r.json()["params"]["logic"] == logic

    # Edge params survive a graph fetch (what the player consumes).
    g = client.get(f"/api/graphs/{gid}").json()
    e = next(x for x in g["edges"] if x["id"] == edge["id"])
    assert e["params"]["logic"]["trigger"] == "Swing pendant"


def test_project_variables_roundtrip(client):
    pid = client.post("/api/projects", json={"name": "vars"}).json()["id"]
    meta = {"variables": [
        {"name": "depth", "type": "number", "default": 0},
        {"name": "has_key", "type": "bool", "default": False},
    ]}
    r = client.patch(f"/api/projects/{pid}", json={"meta": meta})
    assert r.status_code == 200
    assert r.json()["meta"]["variables"][0]["name"] == "depth"


def test_node_params_roundtrip(client):
    pid = client.post("/api/projects", json={"name": "nparams"}).json()["id"]
    gid = client.post(f"/api/projects/{pid}/graphs", json={"name": "Main"}).json()["id"]
    node = client.post(f"/api/graphs/{gid}/nodes", json={"key": "x"}).json()
    r = client.patch(f"/api/nodes/{node['id']}",
                     json={"params": {"logic": {"dialogue": ["hello", "hi"]}}})
    assert r.status_code == 200
    assert r.json()["params"]["logic"]["dialogue"] == ["hello", "hi"]
