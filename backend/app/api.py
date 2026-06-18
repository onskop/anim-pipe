"""REST API routes."""
from __future__ import annotations

import mimetypes

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import queue, runtime, storage
from .config import get_settings
from .db import get_db
from .models import Asset, Character, Edge, GenerationJob, Node, Project
from .providers import get_llm_provider
from .providers import comfyui as comfyui_provider
from .schemas import (
    AssetOut, CharacterIn, CharacterOut, ComfyModels, EdgeIn, EdgeOut, ExpandRequest,
    GenerateRequest, GraphOut, JobOut, NodeIn, NodeOut, ProjectCreate,
    ProjectOut, ProviderStatus, ScenarioRequest, SettingsOut, SettingsPatch,
    TestLLMResult, TriageUpdate,
)

router = APIRouter(prefix="/api")


# --- helpers -----------------------------------------------------------
def _get(db: Session, model, id_: str):
    obj = db.get(model, id_)
    if not obj:
        raise HTTPException(404, f"{model.__name__} {id_} not found")
    return obj


def _enqueue_job(db: Session, project_id: str, target_type: str, target_id: str,
                 kind: str, n: int, params: dict) -> GenerationJob:
    s = get_settings()
    provider = {
        "image": s.image_provider, "video_loop": s.video_provider,
        "video_transition": s.video_provider, "upscale": s.upscale_provider,
    }[kind]
    job = GenerationJob(
        project_id=project_id, target_type=target_type, target_id=target_id,
        kind=kind, provider=provider, n=n, params=params, status="queued",
    )
    db.add(job)
    db.commit()
    queue.enqueue(job.id)
    return job


# --- providers ---------------------------------------------------------
@router.get("/providers", response_model=ProviderStatus)
def providers_status():
    s = get_settings()
    return ProviderStatus(
        image=s.image_provider, video=s.video_provider, upscale=s.upscale_provider,
        llm=s.llm_provider, comfyui_url=s.comfyui_url,
        openrouter_configured=bool(s.openrouter_api_key),
    )


# --- settings (runtime-editable) --------------------------------------
def _settings_out() -> SettingsOut:
    s = get_settings()
    return SettingsOut(
        image_provider=s.image_provider, video_provider=s.video_provider,
        upscale_provider=s.upscale_provider, llm_provider=s.llm_provider,
        comfyui_url=s.comfyui_url, upscale_model=s.upscale_model,
        openrouter_base_url=s.openrouter_base_url, openrouter_api_key=s.openrouter_api_key,
        llm_text_model=s.llm_text_model, llm_vision_model=s.llm_vision_model,
        default_candidates=s.default_candidates,
    )


@router.get("/settings", response_model=SettingsOut)
def get_settings_route():
    return _settings_out()


@router.patch("/settings", response_model=SettingsOut)
def update_settings_route(body: SettingsPatch):
    patch = {k: v for k, v in body.model_dump().items() if v is not None}
    runtime.update(patch)
    return _settings_out()


@router.post("/settings/test-llm", response_model=TestLLMResult)
async def test_llm():
    s = get_settings()
    try:
        sample = await get_llm_provider().expand_prompt("a brave knight by a campfire")
        return TestLLMResult(ok=True, provider=s.llm_provider, model=s.llm_text_model,
                             sample=sample[:300])
    except Exception as exc:  # noqa: BLE001
        return TestLLMResult(ok=False, provider=s.llm_provider, model=s.llm_text_model,
                             error=str(exc))


@router.get("/comfyui/models", response_model=ComfyModels)
async def comfyui_models():
    return ComfyModels(**await comfyui_provider.list_models())


@router.post("/restart")
async def restart_backend():
    """Trigger a reload by touching a sentinel module. Requires the server to be
    run with ``uvicorn --reload`` (the documented dev launch)."""
    import time
    sentinel = __import__("pathlib").Path(__file__).parent / "_reload_sentinel.py"
    sentinel.write_text(f"# touched {time.time()}\n")
    return {"ok": True, "note": "reload triggered if running with --reload"}


# --- projects ----------------------------------------------------------
@router.post("/projects", response_model=ProjectOut)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    p = Project(name=body.name, scenario=body.scenario)
    db.add(p)
    db.commit()
    return p


@router.get("/projects", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)):
    return db.execute(select(Project).order_by(Project.created_at.desc())).scalars().all()


@router.get("/projects/{pid}/graph", response_model=GraphOut)
def get_graph(pid: str, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    chars = db.execute(select(Character).where(Character.project_id == pid)).scalars().all()
    nodes = db.execute(select(Node).where(Node.project_id == pid)).scalars().all()
    edges = db.execute(select(Edge).where(Edge.project_id == pid)).scalars().all()

    def selected(asset_id: str | None) -> tuple[str | None, str | None, str | None]:
        """(thumb_for_canvas, full_path_for_player, kind) for a selected asset."""
        if not asset_id:
            return (None, None, None)
        a = db.get(Asset, asset_id)
        if not a:
            return (None, None, None)
        return (a.thumb_path or a.path, a.path, a.kind)

    for n in nodes:
        n.selected_thumb, n.selected_path, n.selected_kind = selected(n.selected_asset_id)
    for e in edges:
        e.selected_thumb, e.selected_path, e.selected_kind = selected(e.selected_asset_id)
    return GraphOut(project=p, characters=chars, nodes=nodes, edges=edges)


@router.delete("/projects/{pid}")
def delete_project(pid: str, db: Session = Depends(get_db)):
    db.delete(_get(db, Project, pid))
    db.commit()
    return {"ok": True}


# --- characters --------------------------------------------------------
@router.post("/projects/{pid}/characters", response_model=CharacterOut)
def create_character(pid: str, body: CharacterIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    ch = Character(project_id=pid, **body.model_dump())
    db.add(ch)
    db.commit()
    return ch


@router.put("/characters/{cid}", response_model=CharacterOut)
def update_character(cid: str, body: CharacterIn, db: Session = Depends(get_db)):
    ch = _get(db, Character, cid)
    for k, v in body.model_dump().items():
        setattr(ch, k, v)
    db.commit()
    return ch


# --- nodes -------------------------------------------------------------
@router.post("/projects/{pid}/nodes", response_model=NodeOut)
def create_node(pid: str, body: NodeIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    n = Node(project_id=pid, **body.model_dump())
    db.add(n)
    db.commit()
    return n


@router.patch("/nodes/{nid}", response_model=NodeOut)
def update_node(nid: str, body: dict, db: Session = Depends(get_db)):
    n = _get(db, Node, nid)
    for k in ("key", "title", "prompt", "negative_prompt", "character_id", "x", "y"):
        if k in body:
            setattr(n, k, body[k])
    db.commit()
    return n


@router.delete("/nodes/{nid}")
def delete_node(nid: str, db: Session = Depends(get_db)):
    n = _get(db, Node, nid)
    for e in db.execute(
        select(Edge).where((Edge.source_node_id == nid) | (Edge.target_node_id == nid))
    ).scalars().all():
        db.delete(e)
    db.delete(n)
    db.commit()
    return {"ok": True}


# --- edges -------------------------------------------------------------
@router.post("/projects/{pid}/edges", response_model=EdgeOut)
def create_edge(pid: str, body: EdgeIn, db: Session = Depends(get_db)):
    _get(db, Project, pid)
    e = Edge(project_id=pid, **body.model_dump())
    db.add(e)
    db.commit()
    return e


@router.patch("/edges/{eid}", response_model=EdgeOut)
def update_edge(eid: str, body: dict, db: Session = Depends(get_db)):
    e = _get(db, Edge, eid)
    for k in ("kind", "label", "prompt", "motion_mask_id"):
        if k in body:
            setattr(e, k, body[k])
    db.commit()
    return e


@router.delete("/edges/{eid}")
def delete_edge(eid: str, db: Session = Depends(get_db)):
    db.delete(_get(db, Edge, eid))
    db.commit()
    return {"ok": True}


# --- generation --------------------------------------------------------
@router.post("/nodes/{nid}/generate", response_model=JobOut)
def generate_node(nid: str, body: GenerateRequest, db: Session = Depends(get_db)):
    n = _get(db, Node, nid)
    count = body.n or get_settings().default_candidates
    return _enqueue_job(db, n.project_id, "node", nid, "image", count, body.params)


@router.post("/edges/{eid}/generate", response_model=JobOut)
def generate_edge(eid: str, body: GenerateRequest, db: Session = Depends(get_db)):
    e = _get(db, Edge, eid)
    kind = "video_loop" if e.kind == "loop" else "video_transition"
    count = body.n or get_settings().default_candidates
    return _enqueue_job(db, e.project_id, "edge", eid, kind, count, body.params)


@router.get("/jobs/{jid}", response_model=JobOut)
def get_job(jid: str, db: Session = Depends(get_db)):
    return _get(db, GenerationJob, jid)


@router.get("/projects/{pid}/jobs", response_model=list[JobOut])
def list_jobs(pid: str, db: Session = Depends(get_db)):
    return db.execute(
        select(GenerationJob).where(GenerationJob.project_id == pid)
        .order_by(GenerationJob.created_at.desc()).limit(100)
    ).scalars().all()


# --- assets / triage ---------------------------------------------------
@router.get("/{owner_type}/{owner_id}/assets", response_model=list[AssetOut])
def list_assets(owner_type: str, owner_id: str, db: Session = Depends(get_db)):
    if owner_type not in ("node", "edge"):
        raise HTTPException(400, "owner_type must be node|edge")
    return db.execute(
        select(Asset).where(Asset.owner_type == owner_type, Asset.owner_id == owner_id)
        .order_by(Asset.created_at.desc())
    ).scalars().all()


@router.get("/assets/{aid}", response_model=AssetOut)
def get_asset(aid: str, db: Session = Depends(get_db)):
    return _get(db, Asset, aid)


@router.patch("/assets/{aid}", response_model=AssetOut)
def triage_asset(aid: str, body: TriageUpdate, db: Session = Depends(get_db)):
    a = _get(db, Asset, aid)
    a.status = body.status
    db.commit()
    return a


@router.delete("/assets/{aid}")
def delete_asset(aid: str, db: Session = Depends(get_db)):
    """Hard-delete a candidate: drop the DB row, clear any references to it, and
    remove the file if no other asset still points at the same content."""
    a = _get(db, Asset, aid)
    path, thumb = a.path, a.thumb_path
    # Detach references so we don't leave dangling FKs.
    for n in db.execute(select(Node).where(Node.selected_asset_id == aid)).scalars():
        n.selected_asset_id = None
    for e in db.execute(
        select(Edge).where((Edge.selected_asset_id == aid) | (Edge.motion_mask_id == aid))
    ).scalars():
        if e.selected_asset_id == aid:
            e.selected_asset_id = None
        if e.motion_mask_id == aid:
            e.motion_mask_id = None
    for child in db.execute(select(Asset).where(Asset.parent_asset_id == aid)).scalars():
        child.parent_asset_id = None
    db.delete(a)
    db.commit()
    # Remove files only if no surviving asset shares the same content-addressed path.
    for rel in (path, thumb):
        if rel and not db.execute(
            select(Asset.id).where((Asset.path == rel) | (Asset.thumb_path == rel)).limit(1)
        ).first():
            storage.remove_file(rel)
    return {"ok": True}


@router.post("/nodes/{nid}/select/{aid}", response_model=NodeOut)
def select_node_asset(nid: str, aid: str, db: Session = Depends(get_db)):
    n = _get(db, Node, nid)
    a = _get(db, Asset, aid)
    n.selected_asset_id = a.id
    a.status = "accepted"
    db.commit()
    return n


@router.post("/edges/{eid}/select/{aid}", response_model=EdgeOut)
def select_edge_asset(eid: str, aid: str, db: Session = Depends(get_db)):
    e = _get(db, Edge, eid)
    a = _get(db, Asset, aid)
    e.selected_asset_id = a.id
    a.status = "accepted"
    db.commit()
    return e


@router.post("/assets/{aid}/upscale", response_model=JobOut)
def upscale_asset(aid: str, body: GenerateRequest, db: Session = Depends(get_db)):
    a = _get(db, Asset, aid)
    return _enqueue_job(db, a.project_id, "asset", aid, "upscale", 1, body.params)


# Params worth reusing when regenerating "more like this" candidate.
_REGEN_PARAMS = ("width", "height", "steps", "cfg", "checkpoint",
                 "frames", "fps", "motion_scale")


@router.post("/assets/{aid}/regenerate", response_model=JobOut)
def regenerate_asset(aid: str, body: GenerateRequest, db: Session = Depends(get_db)):
    """Generate more candidates for this asset's owner, reusing the candidate's
    own params (size/steps/cfg/checkpoint…). Seed is intentionally dropped so we
    get fresh variations; pass seed in params to reproduce exactly."""
    a = _get(db, Asset, aid)
    if a.owner_type not in ("node", "edge") or not a.owner_id:
        raise HTTPException(400, "asset has no node/edge owner to regenerate for")
    base = {k: v for k, v in (a.params or {}).items() if k in _REGEN_PARAMS}
    base.update(body.params or {})
    n = body.n or get_settings().default_candidates
    if a.owner_type == "node":
        return _enqueue_job(db, a.project_id, "node", a.owner_id, "image", n, base)
    e = db.get(Edge, a.owner_id)
    kind = "video_loop" if (e and e.kind == "loop") else "video_transition"
    return _enqueue_job(db, a.project_id, "edge", a.owner_id, kind, n, base)


@router.post("/assets/{aid}/score", response_model=AssetOut)
async def score_asset(aid: str, db: Session = Depends(get_db)):
    a = _get(db, Asset, aid)
    llm = get_llm_provider()
    # Score the still (or first frame thumb for video).
    src = a.thumb_path or a.path
    score = await llm.score_candidate(storage.read_bytes(src), a.params.get("prompt", ""), a.role)
    a.ai_score = score.__dict__
    db.commit()
    return a


# --- uploads + file serving -------------------------------------------
@router.post("/projects/{pid}/upload", response_model=AssetOut)
async def upload_asset(pid: str, file: UploadFile, kind: str = "image",
                       db: Session = Depends(get_db)):
    _get(db, Project, pid)
    data = await file.read()
    ext = (file.filename or "x.png").rsplit(".", 1)[-1].lower()
    rel, sha = storage.store_bytes(data, ext)
    thumb = storage.make_thumb(rel) if kind != "mask" else None
    a = Asset(project_id=pid, kind=kind, role="upload", status="accepted",
              path=rel, thumb_path=thumb, sha256=sha,
              mime=file.content_type or "application/octet-stream")
    db.add(a)
    db.commit()
    return a


@router.get("/files/{path:path}")
def serve_file(path: str):
    fp = storage.abs_path(path)
    if not fp.exists():
        raise HTTPException(404, "not found")
    mime, _ = mimetypes.guess_type(str(fp))
    return FileResponse(fp, media_type=mime or "application/octet-stream")


# --- LLM ---------------------------------------------------------------
@router.post("/llm/expand")
async def expand_prompt(body: ExpandRequest):
    return {"prompt": await get_llm_provider().expand_prompt(body.brief, body.context)}


@router.post("/projects/{pid}/scenario", response_model=GraphOut)
async def scenario_to_graph(pid: str, body: ScenarioRequest, db: Session = Depends(get_db)):
    p = _get(db, Project, pid)
    graph = await get_llm_provider().scenario_to_graph(body.scenario)
    if body.apply:
        p.scenario = body.scenario
        key_to_node: dict[str, Node] = {}
        for i, nd in enumerate(graph.get("nodes", [])):
            node = Node(project_id=pid, key=nd.get("key", f"n{i+1}"),
                        title=nd.get("title", ""), prompt=nd.get("prompt", ""),
                        x=160 + (i % 5) * 220, y=120 + (i // 5) * 220)
            db.add(node)
            db.flush()
            key_to_node[node.key] = node
        for ed in graph.get("edges", []):
            src = key_to_node.get(ed.get("source"))
            tgt = key_to_node.get(ed.get("target"))
            if src and tgt:
                db.add(Edge(project_id=pid, source_node_id=src.id, target_node_id=tgt.id,
                            kind=ed.get("kind", "transition"), label=ed.get("label", "")))
        db.commit()
    return get_graph(pid, db)
