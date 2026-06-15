"""Generation pipeline.

Turns a node/edge (+ its character sheet) into provider requests, fans out N
candidates, and persists each as an Asset with full lineage. Two-stage by
design: generate cheap candidates -> triage -> upscale only the keepers.
"""
from __future__ import annotations

import random

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .models import Asset, Character, Edge, GenerationJob, Node
from .prompts import PromptContext, build_image_prompt, build_video_prompt
from .providers import get_image_provider, get_upscale_provider, get_video_provider
from .providers.base import GenAsset, ImageRequest, UpscaleRequest, VideoRequest


def _character_ctx(db: Session, node: Node | None) -> PromptContext:
    ctx = PromptContext()
    if node and node.character_id:
        ch = db.get(Character, node.character_id)
        if ch:
            ctx.character_description = ch.description
    return ctx


def _char_for_node(db: Session, node: Node) -> Character | None:
    return db.get(Character, node.character_id) if node.character_id else None


def _ref_bytes(db: Session, ch: Character | None) -> list[bytes]:
    if not ch:
        return []
    out = []
    for aid in ch.ref_image_ids or []:
        a = db.get(Asset, aid)
        if a:
            out.append(storage.read_bytes(a.path))
    return out


def _selected_bytes(db: Session, node_id: str) -> bytes | None:
    node = db.get(Node, node_id)
    if node and node.selected_asset_id:
        a = db.get(Asset, node.selected_asset_id)
        if a:
            return storage.read_bytes(a.path)
    return None


def _persist(db: Session, job: GenerationJob, owner_type: str, owner_id: str,
             gen: GenAsset, role: str, parent_id: str | None = None) -> Asset:
    rel, sha = storage.store_bytes(gen.data, gen.ext)
    thumb = storage.make_thumb(rel)
    asset = Asset(
        project_id=job.project_id, job_id=job.id, owner_type=owner_type, owner_id=owner_id,
        kind="video" if gen.ext in ("gif", "mp4", "webm", "webp") and gen.frames else "image",
        role=role, status="candidate", path=rel, thumb_path=thumb, sha256=sha, mime=gen.mime,
        width=gen.width, height=gen.height, frames=gen.frames, fps=gen.fps,
        params=gen.params, parent_asset_id=parent_id, cost=gen.cost,
    )
    db.add(asset)
    job.cost += gen.cost
    return asset


async def run_job(db: Session, job: GenerationJob) -> None:
    if job.kind == "image":
        await _run_image(db, job)
    elif job.kind in ("video_loop", "video_transition"):
        await _run_video(db, job)
    elif job.kind == "upscale":
        await _run_upscale(db, job)
    else:
        raise ValueError(f"unknown job kind: {job.kind}")


async def _run_image(db: Session, job: GenerationJob) -> None:
    node = db.get(Node, job.target_id)
    if not node:
        raise ValueError("node not found")
    ch = _char_for_node(db, node)
    ctx = _character_ctx(db, node)
    positive, negative = build_image_prompt(node.prompt, ctx)
    # Append the node's own negatives to the sensible defaults (if any).
    if node.negative_prompt and node.negative_prompt.strip():
        negative = f"{negative}, {node.negative_prompt.strip()}"
    p = job.params or {}
    provider = get_image_provider()
    refs = _ref_bytes(db, ch)
    for i in range(job.n):
        req = ImageRequest(
            prompt=positive, negative=negative,
            width=p.get("width", 768), height=p.get("height", 768),
            seed=p.get("seed") if job.n == 1 else random.randint(0, 2**31),
            steps=p.get("steps", 28), cfg=p.get("cfg", 6.5),
            checkpoint=p.get("checkpoint"),
            lora_name=ch.lora_name if ch else None,
            lora_weight=ch.lora_weight if ch else 0.8,
            ref_images=refs, ip_adapter_weight=ch.ip_adapter_weight if ch else 0.6,
        )
        gen = await provider.generate_image(req)
        _persist(db, job, "node", node.id, gen, role="keyframe")
        job.progress = (i + 1) / job.n
        db.flush()


async def _run_video(db: Session, job: GenerationJob) -> None:
    edge = db.get(Edge, job.target_id)
    if not edge:
        raise ValueError("edge not found")
    kind = "loop" if job.kind == "video_loop" else "transition"
    src_node = db.get(Node, edge.source_node_id)
    ctx = _character_ctx(db, src_node)
    positive, negative = build_video_prompt(edge.prompt, kind, ctx)
    p = job.params or {}

    start = _selected_bytes(db, edge.source_node_id)
    end = None if kind == "loop" else _selected_bytes(db, edge.target_node_id)
    mask = None
    if edge.motion_mask_id:
        m = db.get(Asset, edge.motion_mask_id)
        if m:
            mask = storage.read_bytes(m.path)

    provider = get_video_provider()
    for i in range(job.n):
        req = VideoRequest(
            kind=kind, prompt=positive, negative=negative,
            start_image=start, end_image=end, motion_mask=mask,
            frames=p.get("frames", 25), fps=p.get("fps", 12),
            motion_scale=p.get("motion_scale", 0.6),
            seed=p.get("seed") if job.n == 1 else random.randint(0, 2**31),
            closed_loop=p.get("closed_loop", kind == "loop"),
            width=p.get("width", 768), height=p.get("height", 768),
        )
        gen = await provider.generate_video(req)
        _persist(db, job, "edge", edge.id, gen, role=kind)
        job.progress = (i + 1) / job.n
        db.flush()


async def _run_upscale(db: Session, job: GenerationJob) -> None:
    parent = db.get(Asset, job.target_id)
    if not parent:
        raise ValueError("source asset not found")
    p = job.params or {}
    provider = get_upscale_provider()
    if parent.kind != "image":
        raise ValueError("upscale currently supports image assets")
    from .config import get_settings
    model = p.get("upscale_model") or (get_settings().upscale_model or None)
    gen = await provider.upscale(
        UpscaleRequest(image=storage.read_bytes(parent.path), scale=p.get("scale", 2),
                       model=model)
    )
    new = _persist(db, job, parent.owner_type or "node", parent.owner_id or "",
                   gen, role="upscaled", parent_id=parent.id)
    new.status = "accepted"
    job.progress = 1.0
    db.flush()
