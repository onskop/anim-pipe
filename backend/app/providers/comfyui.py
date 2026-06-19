"""ComfyUI adapter (local GPU).

Talks to a running ComfyUI instance over its HTTP API:
  1. upload conditioning images        -> POST /upload/image
  2. patch a workflow template + queue -> POST /prompt
  3. poll until finished               -> GET  /history/{id}
  4. download the output bytes         -> GET  /view

Workflow templates live in ``workflows/*.json`` in ComfyUI **API format**
(``{node_id: {class_type, inputs}}``). Each template carries an ``_animpipe``
map describing which node input each logical field patches into, e.g.::

    "_animpipe": {"patch": {"positive": ["6", "text"], "seed": ["3", "seed"]}}

This indirection means you can rebuild a workflow in the ComfyUI editor, export
the API JSON, fix the map, and swap models/LoRAs without touching Python.

NOTE: node ids, checkpoint names and custom-node availability depend on YOUR
ComfyUI install. The shipped templates are sane starting points — wire them to
your actual models before first real run. Until then, keep ANIMPIPE_*_PROVIDER
on "mock".
"""
from __future__ import annotations

import asyncio
import json
import random
import uuid
from pathlib import Path
from typing import Any

import httpx

from ..config import get_settings
from .base import GenAsset, ImageRequest, UpscaleRequest, VideoRequest

WORKFLOW_DIR = Path(__file__).parent / "workflows"


class ComfyUIError(RuntimeError):
    pass


# --- workflow field auto-mapping ---------------------------------------------
# The app drives a workflow by writing the *variable* per-generation values into
# specific node inputs. Which node input each logical field targets is resolved,
# in priority order, from:
#   1. an explicit ``_animpipe.patch`` map in the template (full manual control),
#   2. a ComfyUI node *title* matching a logical field (set titles in the editor),
#   3. an input *key name* matching a logical field (great for grouped/packaged
#      nodes whose widgets are already named width/height/noise_seed/…),
#   4. type heuristics for the standard nodes (KSampler, EmptyLatent, LoadImage…).
# A field may resolve to several node inputs (e.g. one seed feeding both experts
# of a Wan2.2 high/low-noise pair) — all of them get written.

# logical field -> input-key / title aliases it answers to (normalised)
FIELD_ALIASES: dict[str, tuple[str, ...]] = {
    "positive": ("positive", "positive_prompt", "pos_prompt"),
    "negative": ("negative", "negative_prompt", "neg_prompt"),
    "seed": ("seed", "noise_seed", "rand_seed"),
    "steps": ("steps", "sampling_steps"),
    "cfg": ("cfg", "cfg_scale", "guidance", "guidance_scale"),
    "width": ("width",),
    "height": ("height",),
    "checkpoint": ("ckpt_name", "checkpoint"),
    "frames": ("frames", "length", "video_frames", "num_frames", "video_length"),
    "duration": ("duration", "seconds", "length_seconds"),
    "fps": ("fps", "frame_rate"),
    "motion_scale": ("motion_scale", "motion_bucket_id", "motion"),
    "start_image": ("start_image", "first_frame", "start", "first_image"),
    "end_image": ("end_image", "last_frame", "end", "last_image"),
    "mask": ("mask", "motion_mask"),
}
_REV_ALIAS: dict[str, str] = {a: f for f, al in FIELD_ALIASES.items() for a in al}


def _norm(s: Any) -> str:
    return str(s).strip().lower().replace(" ", "_").replace("-", "_")


def _is_scalar(v: Any) -> bool:
    """True for a widget value; False for a ``[node_id, slot]`` connection ref."""
    return not (isinstance(v, list) and len(v) == 2
                and isinstance(v[0], str) and isinstance(v[1], int))


def build_field_map(doc: dict, want_video: bool) -> dict:
    """Derive ``{logical_field: [node_id, key] | [[node_id, key], ...]}`` from a
    workflow's node titles, input names and types (see module note above)."""
    found: dict[str, list[list[str]]] = {}

    def add(field: str, node_id: str, key: str, front: bool = False) -> None:
        tgt = [node_id, key]
        bucket = found.setdefault(field, [])
        if tgt in bucket:
            if front:
                bucket.remove(tgt)
            else:
                return
        bucket.insert(0, tgt) if front else bucket.append(tgt)

    nodes = [(nid, n) for nid, n in doc.items() if isinstance(n, dict)]

    # 2/3) input-key-name match (scalar widgets only)
    for nid, node in nodes:
        for k, v in (node.get("inputs") or {}).items():
            field = _REV_ALIAS.get(_norm(k))
            if field and _is_scalar(v):
                add(field, nid, k)

    # 2) node-title match wins over a bare key match — front-load it
    for nid, node in nodes:
        field = _REV_ALIAS.get(_norm((node.get("_meta") or {}).get("title", "")))
        if not field:
            continue
        inputs = node.get("inputs") or {}
        key = next((a for a in FIELD_ALIASES[field] if a in inputs and _is_scalar(inputs[a])), None)
        if key is None:
            scalars = [k for k, v in inputs.items() if _is_scalar(v)]
            key = scalars[0] if len(scalars) == 1 else ("value" if "value" in inputs else None)
        if key is not None:
            add(field, nid, key, front=True)

    # 4) type heuristics for the standard nodes, only to fill gaps
    _heuristics(doc, nodes, found, add, want_video)

    return {f: (t[0] if len(t) == 1 else t) for f, t in found.items()}


def _heuristics(doc, nodes, found, add, want_video: bool) -> None:
    for nid, node in nodes:
        ct = node.get("class_type", "")
        ins = node.get("inputs") or {}
        if ct in ("CheckpointLoaderSimple", "ImageOnlyCheckpointLoader") and "checkpoint" not in found:
            add("checkpoint", nid, "ckpt_name")
        if ct.startswith("KSampler"):
            for fld, key in (("seed", "seed"), ("steps", "steps"), ("cfg", "cfg")):
                if key in ins and fld not in found:
                    add(fld, nid, key)
        if "Latent" in ct and ("Empty" in ct or "Hunyuan" in ct):
            for key in ("width", "height"):
                if key in ins and key not in found:
                    add(key, nid, key)
            if "length" in ins and "frames" not in found:
                add("frames", nid, "length")

    # positive/negative: trace the first KSampler's conditioning back to CLIP nodes
    if "positive" not in found or "negative" not in found:
        for nid, node in nodes:
            if not node.get("class_type", "").startswith("KSampler"):
                continue
            ins = node.get("inputs") or {}
            for slot in ("positive", "negative"):
                ref = ins.get(slot)
                if isinstance(ref, list) and len(ref) == 2 and slot not in found:
                    tgt = doc.get(ref[0], {})
                    if tgt.get("class_type") == "CLIPTextEncode" and "text" in (tgt.get("inputs") or {}):
                        add(slot, ref[0], "text")
            break

    if want_video:
        loads = [nid for nid, node in nodes if node.get("class_type") == "LoadImage"]
        if loads and "start_image" not in found:
            add("start_image", loads[0], "image")
        if len(loads) >= 2 and "end_image" not in found:
            add("end_image", loads[1], "image")


def inspect_workflows() -> list[dict]:
    """List every workflow template with the logical fields the app can drive and
    the model files it references — powers the Settings workflow picker."""
    out: list[dict] = []
    for path in sorted(WORKFLOW_DIR.glob("*.json")):
        try:
            doc = json.loads(path.read_text())
        except Exception:  # noqa: BLE001
            continue
        meta = doc.pop("_animpipe", {}) if isinstance(doc, dict) else {}
        want_video = any(t in path.name for t in ("loop", "flf2v", "video", "i2v", "transition"))
        fmap = build_field_map(doc, want_video)
        fmap.update(meta.get("patch", {}))
        has_se = "start_image" in fmap or "end_image" in fmap
        models = sorted({
            v for node in doc.values() if isinstance(node, dict)
            for k, v in (node.get("inputs") or {}).items()
            if isinstance(v, str) and v and _norm(v) != "none" and any(
                t in _norm(k) for t in ("ckpt", "checkpoint", "model_name",
                                        "vae", "lora", "clip_name", "unet"))
        })
        out.append({
            "name": path.name,
            "role": "video" if (has_se or want_video) else "image",
            "fields": sorted(fmap.keys()),
            "models": models,
        })
    return out


def _combo_options(spec: Any) -> list[str]:
    """ComfyUI exposes COMBO inputs as either ``[[opt, ...], {meta}]`` (classic)
    or ``["COMBO", {"options": [...]}]`` (newer). Normalise both to a list."""
    if not isinstance(spec, list) or not spec:
        return []
    first = spec[0]
    if isinstance(first, list):
        return [str(x) for x in first]
    if isinstance(first, str):  # "COMBO"
        meta = spec[1] if len(spec) > 1 and isinstance(spec[1], dict) else {}
        return [str(x) for x in meta.get("options", [])]
    return []


async def list_models(base_url: str | None = None) -> dict[str, Any]:
    """Query a running ComfyUI for installed checkpoints / upscale models /
    samplers. Returns ``{"online": bool, "error": str|None, ...lists}``."""
    url = (base_url or get_settings().comfyui_url).rstrip("/")
    out: dict[str, Any] = {
        "online": False, "error": None,
        "checkpoints": [], "loras": [], "upscale_models": [], "samplers": [], "schedulers": [],
    }

    async def _opts(http: httpx.AsyncClient, node: str, field: str) -> list[str]:
        r = await http.get(f"{url}/object_info/{node}")
        r.raise_for_status()
        spec = r.json()[node]["input"]["required"][field]
        return _combo_options(spec)

    try:
        async with httpx.AsyncClient(timeout=10) as http:
            out["checkpoints"] = await _opts(http, "CheckpointLoaderSimple", "ckpt_name")
            try:
                out["loras"] = await _opts(http, "LoraLoader", "lora_name")
            except Exception:
                pass  # node may be absent
            try:
                out["upscale_models"] = await _opts(http, "UpscaleModelLoader", "model_name")
            except Exception:
                pass  # node may be absent
            try:
                out["samplers"] = await _opts(http, "KSampler", "sampler_name")
                out["schedulers"] = await _opts(http, "KSampler", "scheduler")
            except Exception:
                pass
            out["online"] = True
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)
    return out


class ComfyUIProvider:
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or get_settings().comfyui_url).rstrip("/")
        self.client_id = uuid.uuid4().hex

    # --- public API -----------------------------------------------------
    async def generate_image(self, req: ImageRequest) -> GenAsset:
        wf, meta = self._load(get_settings().workflow_image or "txt2img_anime.json")
        seed = req.seed if req.seed is not None else random.randint(0, 2**31)
        async with httpx.AsyncClient(timeout=600) as http:
            patch = {
                "positive": req.prompt,
                "negative": req.negative,
                "seed": seed,
                "width": req.width,
                "height": req.height,
                "steps": req.steps,
                "cfg": req.cfg,
            }
            if req.checkpoint:
                patch["checkpoint"] = req.checkpoint
            if req.lora_name:
                patch["lora_name"] = req.lora_name
                patch["lora_weight"] = req.lora_weight
            if req.ref_images:
                ref_name = await self._upload(http, req.ref_images[0], "ref.png")
                patch["ref_image"] = ref_name
                patch["ip_weight"] = req.ip_adapter_weight
            # Splice out the LoRA / IP-Adapter stack when this character doesn't
            # use it, so the same template runs with or without consistency.
            self._prune_optional(wf, meta.get("optional", {}), set(patch))
            field_map = build_field_map(wf, want_video=False)
            field_map.update(meta.get("patch", {}))  # explicit map overrides auto
            self._apply(wf, field_map, patch)
            data, ext, mime = await self._run(http, wf)
        return GenAsset(
            data=data, ext=ext, mime=mime, width=req.width, height=req.height,
            params={"seed": seed, "model": req.checkpoint or "comfyui", "prompt": req.prompt},
        )

    async def generate_video(self, req: VideoRequest) -> GenAsset:
        s = get_settings()
        template = (s.workflow_loop or "video_loop.json") if req.kind == "loop" \
            else (s.workflow_transition or "video_flf2v.json")
        wf, meta = self._load(template)
        seed = req.seed if req.seed is not None else random.randint(0, 2**31)
        async with httpx.AsyncClient(timeout=1200) as http:
            patch: dict[str, Any] = {
                "positive": req.prompt,
                "negative": req.negative,
                "seed": seed,
                "frames": req.frames,
                # Some Wan/LTX graphs are clip-length-driven; offer both so the
                # workflow can expose whichever it prefers.
                "duration": round(req.frames / req.fps, 2) if req.fps else req.frames,
                "fps": req.fps,
                "motion_scale": req.motion_scale,
                "closed_loop": req.closed_loop or req.kind == "loop",
                "width": req.width,
                "height": req.height,
            }
            if req.start_image:
                patch["start_image"] = await self._upload(http, req.start_image, "start.png")
            # Seamless loops condition the same frame as first AND last (DreamLoop):
            # feed the start image into the end slot too when the graph exposes one.
            end_bytes = req.end_image or (req.start_image if req.kind == "loop" else None)
            if end_bytes:
                patch["end_image"] = await self._upload(http, end_bytes, "end.png")
            if req.motion_mask:
                patch["mask"] = await self._upload(http, req.motion_mask, "mask.png")
            field_map = build_field_map(wf, want_video=True)
            field_map.update(meta.get("patch", {}))  # explicit map overrides auto
            self._apply(wf, field_map, patch)
            data, ext, mime = await self._run(http, wf)
        return GenAsset(
            data=data, ext=ext, mime=mime, width=req.width, height=req.height,
            frames=req.frames, fps=req.fps,
            params={"seed": seed, "kind": req.kind, "model": "comfyui"},
        )

    async def upscale(self, req: UpscaleRequest) -> GenAsset:
        wf, meta = self._load("upscale.json")
        mapping = meta.get("patch", {})
        async with httpx.AsyncClient(timeout=900) as http:
            if req.image is None:
                raise ComfyUIError("comfyui upscale currently supports images only")
            name = await self._upload(http, req.image, "in.png")
            patch: dict[str, Any] = {"image": name, "scale": req.scale}
            if req.model:
                patch["model_name"] = req.model
            self._apply(wf, mapping, patch)
            data, ext, mime = await self._run(http, wf)
        return GenAsset(data=data, ext=ext, mime=mime, params={"model": "comfyui-upscale"})

    # --- template handling ---------------------------------------------
    def _load(self, name: str) -> tuple[dict, dict]:
        """Return ``(workflow, animpipe_meta)``. ``meta`` carries the ``patch``
        map and an optional ``optional`` map (see :meth:`_prune_optional`)."""
        path = WORKFLOW_DIR / name
        if not path.exists():
            raise ComfyUIError(f"workflow template missing: {name}")
        doc = json.loads(path.read_text())
        meta = doc.pop("_animpipe", {})
        return doc, meta

    @staticmethod
    def _prune_optional(wf: dict, optional: dict, active_fields: set[str]) -> None:
        """Splice out optional nodes whose gating field is absent this run.

        Each entry is ``{node_id: {"requires": field, "passthrough": {slot: ref}}}``.
        A node is removed when its ``requires`` field is not in ``active_fields``;
        any connection that read one of its outputs is rewired through
        ``passthrough`` (following the chain across consecutively removed nodes)
        so the graph stays valid. This lets one static template serve characters
        with *and* without the LoRA / IP-Adapter consistency stack.
        """
        removed = {nid for nid, spec in optional.items()
                   if spec.get("requires") not in active_fields}
        if not removed:
            return

        def resolve(node_id: str, slot: int):
            seen: set[str] = set()
            while node_id in removed and node_id not in seen:
                seen.add(node_id)
                pt = optional[node_id].get("passthrough", {})
                nxt = pt.get(str(slot))
                if nxt is None:
                    return None  # output should only feed other removed nodes
                node_id, slot = nxt[0], nxt[1]
            return [node_id, slot]

        for nid, node in wf.items():
            if nid in removed:
                continue
            for key, val in list(node.get("inputs", {}).items()):
                if (isinstance(val, list) and len(val) == 2
                        and isinstance(val[0], str) and isinstance(val[1], int)
                        and val[0] in removed):
                    resolved = resolve(val[0], val[1])
                    if resolved is not None:
                        node["inputs"][key] = resolved
        for nid in removed:
            wf.pop(nid, None)

    @staticmethod
    def _apply(wf: dict, mapping: dict, values: dict) -> None:
        for field, value in values.items():
            target = mapping.get(field)
            if not target:
                continue  # template doesn't expose this field — skip
            # target is either [node_id, key] or a list of those (multi-target,
            # e.g. one seed feeding both Wan high/low-noise samplers).
            targets = target if target and isinstance(target[0], list) else [target]
            for node_id, input_key in targets:
                if node_id in wf:
                    wf[node_id].setdefault("inputs", {})[input_key] = value

    # --- HTTP plumbing --------------------------------------------------
    async def _upload(self, http: httpx.AsyncClient, data: bytes, filename: str) -> str:
        r = await http.post(
            f"{self.base_url}/upload/image",
            files={"image": (filename, data, "image/png")},
            data={"overwrite": "true"},
        )
        r.raise_for_status()
        return r.json()["name"]

    async def _run(self, http: httpx.AsyncClient, wf: dict) -> tuple[bytes, str, str]:
        r = await http.post(
            f"{self.base_url}/prompt",
            json={"prompt": wf, "client_id": self.client_id},
        )
        r.raise_for_status()
        prompt_id = r.json()["prompt_id"]

        # Poll history until the prompt produces outputs.
        for _ in range(600):
            await asyncio.sleep(1.0)
            h = await http.get(f"{self.base_url}/history/{prompt_id}")
            h.raise_for_status()
            hist = h.json()
            if prompt_id in hist:
                outputs = hist[prompt_id].get("outputs", {})
                ref = self._first_output(outputs)
                if ref:
                    return await self._download(http, ref)
        raise ComfyUIError(f"timed out waiting for prompt {prompt_id}")

    @staticmethod
    def _first_output(outputs: dict) -> dict | None:
        for node_out in outputs.values():
            for key in ("gifs", "videos", "images"):
                if node_out.get(key):
                    return node_out[key][0]
        return None

    async def _download(self, http: httpx.AsyncClient, ref: dict) -> tuple[bytes, str, str]:
        params = {
            "filename": ref["filename"],
            "subfolder": ref.get("subfolder", ""),
            "type": ref.get("type", "output"),
        }
        r = await http.get(f"{self.base_url}/view", params=params)
        r.raise_for_status()
        fn = ref["filename"].lower()
        ext = fn.rsplit(".", 1)[-1] if "." in fn else "png"
        mime = {
            "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
            "gif": "image/gif", "webp": "image/webp", "mp4": "video/mp4",
            "webm": "video/webm",
        }.get(ext, "application/octet-stream")
        return r.content, ext, mime
