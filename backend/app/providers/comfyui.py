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


class ComfyUIProvider:
    def __init__(self, base_url: str | None = None):
        self.base_url = (base_url or get_settings().comfyui_url).rstrip("/")
        self.client_id = uuid.uuid4().hex

    # --- public API -----------------------------------------------------
    async def generate_image(self, req: ImageRequest) -> GenAsset:
        wf, mapping = self._load("txt2img_anime.json")
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
            self._apply(wf, mapping, patch)
            data, ext, mime = await self._run(http, wf)
        return GenAsset(
            data=data, ext=ext, mime=mime, width=req.width, height=req.height,
            params={"seed": seed, "model": req.checkpoint or "comfyui", "prompt": req.prompt},
        )

    async def generate_video(self, req: VideoRequest) -> GenAsset:
        template = "video_loop.json" if req.kind == "loop" else "video_flf2v.json"
        wf, mapping = self._load(template)
        seed = req.seed if req.seed is not None else random.randint(0, 2**31)
        async with httpx.AsyncClient(timeout=1200) as http:
            patch: dict[str, Any] = {
                "positive": req.prompt,
                "negative": req.negative,
                "seed": seed,
                "frames": req.frames,
                "fps": req.fps,
                "motion_scale": req.motion_scale,
                "closed_loop": req.closed_loop or req.kind == "loop",
                "width": req.width,
                "height": req.height,
            }
            if req.start_image:
                patch["start_image"] = await self._upload(http, req.start_image, "start.png")
            if req.end_image:
                patch["end_image"] = await self._upload(http, req.end_image, "end.png")
            if req.motion_mask:
                patch["mask"] = await self._upload(http, req.motion_mask, "mask.png")
            self._apply(wf, mapping, patch)
            data, ext, mime = await self._run(http, wf)
        return GenAsset(
            data=data, ext=ext, mime=mime, width=req.width, height=req.height,
            frames=req.frames, fps=req.fps,
            params={"seed": seed, "kind": req.kind, "model": "comfyui"},
        )

    async def upscale(self, req: UpscaleRequest) -> GenAsset:
        wf, mapping = self._load("upscale.json")
        async with httpx.AsyncClient(timeout=900) as http:
            if req.image is None:
                raise ComfyUIError("comfyui upscale currently supports images only")
            name = await self._upload(http, req.image, "in.png")
            self._apply(wf, mapping, {"image": name, "scale": req.scale})
            data, ext, mime = await self._run(http, wf)
        return GenAsset(data=data, ext=ext, mime=mime, params={"model": "comfyui-upscale"})

    # --- template handling ---------------------------------------------
    def _load(self, name: str) -> tuple[dict, dict]:
        path = WORKFLOW_DIR / name
        if not path.exists():
            raise ComfyUIError(f"workflow template missing: {name}")
        doc = json.loads(path.read_text())
        mapping = doc.pop("_animpipe", {}).get("patch", {})
        return doc, mapping

    @staticmethod
    def _apply(wf: dict, mapping: dict, values: dict) -> None:
        for field, value in values.items():
            target = mapping.get(field)
            if not target:
                continue  # template doesn't expose this field — skip
            node_id, input_key = target
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
