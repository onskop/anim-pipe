"""Game bundle export — the ship step.

Collects the project's locked keepers, converts them to the decided web
formats (WebP stills, WebM clips), and writes a self-contained bundle:

    graph.json        machine-readable contract: scenes/nodes/edges/logic/vars
    assets/           img-<id>.webp / clip-<id>.webm (keepers only, deduped)
    characters.json   consistency anchors + ref images
    instructions.md   project brief + structure summary for the compile agent
    style.md          look & feel notes
    COMPILE_PACK.md   the agent prompt: build the final game from this bundle
    index.html        \\  reference runtime — dependency-free player defining
    runtime.js        /   the exact traversal semantics (same as the studio)

The bundle folder stays on disk (instantly playable via any static server)
and is also zipped into data/exports/<name>.zip for download. Media
conversions run in worker threads so the job queue's event loop stays live.
"""
from __future__ import annotations

import asyncio
import json
import re
import shutil
import subprocess
import time
import zipfile
from pathlib import Path
from typing import Callable

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import storage
from .config import get_settings
from .editops import _ffmpeg_exe
from .models import Asset, Character, Edge, Graph, Node, Project

RUNTIME_DIR = Path(__file__).parent / "export_runtime"


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "project"


# ---------------------------------------------------------------------------
# media conversion (runs in worker threads)
# ---------------------------------------------------------------------------
def _convert_image(src: Path, dst_dir: Path, stem: str) -> str:
    out = dst_dir / f"{stem}.webp"
    im = Image.open(src)
    im.save(out, format="WEBP", quality=90, method=4)
    return out.name


def _convert_clip(src: Path, dst_dir: Path, stem: str) -> str:
    """Transcode any clip (gif/mp4/webm/…) to VP9 WebM; if ffmpeg can't
    (missing codec), fall back to copying the original so the bundle still
    plays (the runtime renders gif via <img>)."""
    out = dst_dir / f"{stem}.webm"
    if src.suffix.lower() == ".webm":
        shutil.copy2(src, out)
        return out.name
    try:
        subprocess.run(
            [
                _ffmpeg_exe(), "-y", "-i", str(src),
                "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "34",
                "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
                "-pix_fmt", "yuv420p", "-an", str(out),
            ],
            capture_output=True, check=True, timeout=600,
        )
        return out.name
    except Exception:  # noqa: BLE001 — fall back to the original container
        out.unlink(missing_ok=True)
        fallback = dst_dir / f"{stem}{src.suffix.lower()}"
        shutil.copy2(src, fallback)
        return fallback.name


# ---------------------------------------------------------------------------
# document generation
# ---------------------------------------------------------------------------
def _cond_str(cond: list[dict]) -> str:
    return " AND ".join(f"{c.get('var')} {c.get('op')} {c.get('value')}" for c in cond)


def _instructions_md(project: Project, scenes: list[dict],
                     variables: list[dict]) -> str:
    lines = [f"# {project.name} — build instructions", ""]
    lines += ["## Scenario / brief", "", project.scenario or "_(no scenario text)_", ""]
    lines += ["## Structure", ""]
    for sc in scenes:
        lines.append(f"### Scene: {sc['name']} ({len(sc['nodes'])} nodes, {len(sc['edges'])} edges)")
        start = next((n for n in sc["nodes"] if n["id"] == sc["start"]), None)
        lines.append(f"- start: **{start['key'] if start else '?'}**")
        for e in sc["edges"]:
            logic = e.get("logic") or {}
            if logic.get("type") == "choice":
                cond = logic.get("condition") or []
                gate = f" (requires {_cond_str(cond)})" if cond else ""
                lines.append(f"- choice **{logic.get('trigger') or e['label']}**{gate}")
        lines.append("")
    if variables:
        lines += ["## Variables", ""]
        for v in variables:
            lines.append(f"- `{v.get('name')}` ({v.get('type')}, default {v.get('default')})")
        lines.append("")
    lines += [
        "## Notes for the compile agent",
        "",
        "Everything gameplay-mechanical that is expressible as variables /",
        "conditions / effects is already encoded in `graph.json` — implement it",
        "exactly. Anything described above in prose but NOT encoded (meters,",
        "timers, scoring, audio, menus) is yours to design within the brief.",
    ]
    return "\n".join(lines) + "\n"


def _style_md(characters: list[Character]) -> str:
    from .prompts import DEFAULT_NEGATIVE, DEFAULT_STYLE

    lines = ["# Look & feel", "", f"Style preset: {DEFAULT_STYLE}", "",
             f"Avoid: {DEFAULT_NEGATIVE}", ""]
    if characters:
        lines += ["## Characters", ""]
        for c in characters:
            lines += [f"### {c.name}", "", c.description or "_(no description)_", ""]
    lines += ["## UI wishes", "",
              "Dark theme; the artwork is the hero — keep chrome minimal.",
              "Match the reference runtime's mood unless instructed otherwise."]
    return "\n".join(lines) + "\n"


COMPILE_PACK = """# Compile pack — build the final game from this bundle

You are an expert game developer agent. This folder is a complete,
self-contained game specification:

| file | role |
|---|---|
| `graph.json` | **THE CONTRACT** — scenes, nodes (keyframes), edges (clips), variables, and declarative logic (choice/auto/idle, conditions, effects, once) |
| `runtime.js` + `index.html` | **the reference runtime** — a working, dependency-free player. Its traversal semantics are normative; the comment block at the top of `runtime.js` spells them out |
| `assets/` | final media — WebP stills, WebM clips. Do not re-encode |
| `instructions.md` | the designer's brief: story, structure, and everything beyond the declarative layer |
| `style.md` | look & feel, character sheets |

## Your job

Build a **polished, static, single-page HTML5 game** — one folder, no build
step, no external dependencies, runnable from any static file server — that:

1. **Preserves the traversal semantics of `runtime.js` exactly**: weighted
   idle roaming, choice buttons that queue and route through idle edges,
   auto edges firing on condition, effects applied when an edge finishes,
   once-edges, condition-gated availability, still+hold fallback for
   clip-less edges.
2. Implements everything in `instructions.md`, including mechanics that are
   not in the declarative layer (meters, timers, scoring, audio hooks,
   menus, save/restart) — designed by you, in the spirit of `style.md`.
3. Polishes the presentation: title screen, styled choices, smooth
   crossfades between stills, media preloading, responsive layout.

## Acceptance

Serve both this bundle (`python -m http.server`) and your build side by
side. Play the same choices in both: node/edge progression and variable
values must match. Your game may look far better — it must not *behave*
differently.
"""


# ---------------------------------------------------------------------------
# bundle build
# ---------------------------------------------------------------------------
async def build_bundle(db: Session, project_id: str,
                       progress: Callable[[float], None]) -> str:
    """Build the bundle directory + zip. Returns the zip's filename."""
    settings = get_settings()
    project = db.get(Project, project_id)
    if not project:
        raise ValueError("project not found")

    graphs = db.execute(
        select(Graph).where(Graph.project_id == project_id).order_by(Graph.created_at)
    ).scalars().all()
    characters = db.execute(
        select(Character).where(Character.project_id == project_id)
    ).scalars().all()

    name = f"{_slug(project.name)}-{time.strftime('%Y%m%d-%H%M%S')}"
    out = settings.data_dir / "exports" / name
    assets_dir = out / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    # -- collect every referenced keeper (deduped by asset id) --------------
    jobs: dict[str, Asset] = {}

    def want(aid: str | None) -> None:
        if not aid or aid in jobs:
            return
        a = db.get(Asset, aid)
        if a:
            jobs[a.id] = a

    scene_rows: list[tuple[Graph, list[Node], list[Edge]]] = []
    for g in graphs:
        nodes = db.execute(select(Node).where(Node.graph_id == g.id)).scalars().all()
        edges = db.execute(select(Edge).where(Edge.graph_id == g.id)).scalars().all()
        scene_rows.append((g, nodes, edges))
        for n in nodes:
            want(n.selected_asset_id)
        for e in edges:
            want(e.selected_asset_id)
    for c in characters:
        for aid in c.ref_image_ids or []:
            want(aid)

    # -- convert media in worker threads ------------------------------------
    asset_files: dict[str, str] = {}
    total = max(1, len(jobs))
    for i, a in enumerate(jobs.values()):
        src = storage.abs_path(a.path)
        stem = f"{'clip' if a.kind == 'video' else 'img'}-{a.id[:12]}"
        if a.kind == "video":
            fname = await asyncio.to_thread(_convert_clip, src, assets_dir, stem)
        else:
            fname = await asyncio.to_thread(_convert_image, src, assets_dir, stem)
        asset_files[a.id] = f"assets/{fname}"
        progress(0.05 + 0.8 * (i + 1) / total)

    # -- graph.json ----------------------------------------------------------
    scenes: list[dict] = []
    for g, nodes, edges in scene_rows:
        node_dicts = [{
            "id": n.id, "key": n.key, "title": n.title,
            "image": asset_files.get(n.selected_asset_id or ""),
            "logic": (n.params or {}).get("logic"),
        } for n in nodes]
        edge_dicts = [{
            "id": e.id, "from": e.source_node_id, "to": e.target_node_id,
            "kind": e.kind, "label": e.label or e.kind,
            "clip": asset_files.get(e.selected_asset_id or ""),
            "logic": (e.params or {}).get("logic"),
        } for e in edges]
        start = g.start_node_id if any(n.id == g.start_node_id for n in nodes) else (
            nodes[0].id if nodes else None)
        scenes.append({"id": g.id, "name": g.name, "start": start,
                       "nodes": node_dicts, "edges": edge_dicts})

    variables = (project.meta or {}).get("variables", [])
    bundle = {
        "schema": "anim-pipe-bundle@1",
        "project": {"id": project.id, "name": project.name},
        "variables": variables,
        "start_scene": scenes[0]["id"] if scenes else None,
        "scenes": scenes,
    }
    (out / "graph.json").write_text(json.dumps(bundle, indent=2))

    # -- characters.json + docs + runtime ------------------------------------
    (out / "characters.json").write_text(json.dumps([{
        "name": c.name, "description": c.description,
        "ref_images": [asset_files[a] for a in (c.ref_image_ids or []) if a in asset_files],
    } for c in characters], indent=2))
    (out / "instructions.md").write_text(_instructions_md(project, scenes, variables))
    (out / "style.md").write_text(_style_md(characters))
    (out / "COMPILE_PACK.md").write_text(COMPILE_PACK)
    for f in ("index.html", "runtime.js"):
        shutil.copy2(RUNTIME_DIR / f, out / f)
    progress(0.9)

    # -- zip ------------------------------------------------------------------
    zip_path = out.parent / f"{name}.zip"

    def _zip() -> None:
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
            for p in sorted(out.rglob("*")):
                if p.is_file():
                    z.write(p, p.relative_to(out))

    await asyncio.to_thread(_zip)
    progress(1.0)
    return zip_path.name
