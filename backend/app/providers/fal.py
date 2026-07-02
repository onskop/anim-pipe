"""fal.ai adapter — cloud generation over the fal queue API.

One key covers image generation, instruction edits, first/last-frame video and
upscaling. Model endpoints are plain settings (swap models without code): each
capability maps the neutral request onto the field names the default models
share, merges ``extra["fal"]`` last for model-specific overrides, then polls
the queue until done and downloads the first image/video in the result.

Input images are sent as data URIs, so nothing needs to be uploaded/hosted
first. Queue protocol: https://docs.fal.ai/model-apis/queue
"""
from __future__ import annotations

import asyncio
import base64
from typing import Any

import httpx

from ..config import get_settings
from .base import GenAsset, ImageEditRequest, ImageRequest, UpscaleRequest, VideoRequest


class FalError(RuntimeError):
    pass


_EXT = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/webm": "webm",
}

_POLL_SECONDS = 1.5


def _headers() -> dict[str, str]:
    key = get_settings().fal_api_key
    if not key:
        raise FalError("fal.ai API key not configured (Settings → fal API key)")
    return {"Authorization": f"Key {key}"}


def _data_uri(data: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode()


async def _run(model: str, payload: dict[str, Any], timeout: float = 600.0) -> dict[str, Any]:
    """Submit to the queue, poll status until COMPLETED, return the result JSON."""
    base = get_settings().fal_queue_url.rstrip("/")
    headers = _headers()
    async with httpx.AsyncClient(timeout=60.0) as client:
        r = await client.post(f"{base}/{model}", json=payload, headers=headers)
        if r.status_code >= 400:
            raise FalError(f"fal submit {r.status_code}: {r.text[:500]}")
        sub = r.json()
        rid = sub.get("request_id", "")
        status_url = sub.get("status_url") or f"{base}/{model}/requests/{rid}/status"
        response_url = sub.get("response_url") or f"{base}/{model}/requests/{rid}"

        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            s = (await client.get(status_url, headers=headers)).json()
            status = s.get("status")
            if status == "COMPLETED":
                break
            if status in ("FAILED", "CANCELLED", "ERROR"):
                raise FalError(f"fal job {status}: {s}")
            if asyncio.get_event_loop().time() > deadline:
                raise FalError(f"fal job timed out after {timeout:.0f}s ({model})")
            await asyncio.sleep(_POLL_SECONDS)

        rr = await client.get(response_url, headers=headers)
        if rr.status_code >= 400:
            raise FalError(f"fal result {rr.status_code}: {rr.text[:500]}")
        return rr.json()


def _find_media(result: dict[str, Any]) -> dict[str, Any]:
    """First media object across the common fal result shapes:
    {images:[{url,..}]} | {image:{url,..}} | {video:{url,..}}."""
    v = result.get("images")
    if isinstance(v, list) and v and isinstance(v[0], dict) and v[0].get("url"):
        return v[0]
    for key in ("image", "video"):
        v = result.get(key)
        if isinstance(v, dict) and v.get("url"):
            return v
    raise FalError(f"no media in fal result (keys: {sorted(result)[:8]})")


async def _download(url: str) -> tuple[bytes, str]:
    async with httpx.AsyncClient(timeout=300.0) as client:
        r = await client.get(url)
        r.raise_for_status()
        return r.content, (r.headers.get("content-type") or "application/octet-stream").split(";")[0]


async def _to_asset(result: dict[str, Any], model: str,
                    params: dict[str, Any]) -> GenAsset:
    media = _find_media(result)
    data, mime = await _download(media["url"])
    return GenAsset(
        data=data,
        ext=_EXT.get(mime, "bin"),
        mime=mime,
        width=media.get("width"),
        height=media.get("height"),
        params={**params, "provider": "fal", "model": model,
                "seed": result.get("seed", params.get("seed"))},
        # fal doesn't return per-request pricing in the response; cost stays 0
        # until a price map lands with the cost dashboard.
        cost=0.0,
    )


class FalProvider:
    async def generate_image(self, req: ImageRequest) -> GenAsset:
        model = get_settings().fal_model_image
        payload: dict[str, Any] = {
            "prompt": req.prompt,
            "image_size": {"width": req.width, "height": req.height},
            "num_inference_steps": req.steps,
            "guidance_scale": req.cfg,
            "num_images": 1,
        }
        if req.negative:
            payload["negative_prompt"] = req.negative
        if req.seed is not None:
            payload["seed"] = req.seed
        payload.update(req.extra.get("fal", {}))
        result = await _run(model, payload)
        return await _to_asset(result, model, {"prompt": req.prompt, "seed": req.seed})

    async def edit_image(self, req: ImageEditRequest) -> GenAsset:
        model = get_settings().fal_model_edit
        payload: dict[str, Any] = {"prompt": req.instruction}
        # Edit models disagree on the input-image field: Kontext-class takes a
        # single image_url; nano-banana-class takes an image_urls list.
        uri = _data_uri(req.image)
        if "nano-banana" in model:
            payload["image_urls"] = [uri] + [_data_uri(r) for r in req.ref_images]
        else:
            payload["image_url"] = uri
        if req.seed is not None:
            payload["seed"] = req.seed
        if req.negative:
            payload["negative_prompt"] = req.negative
        payload.update(req.extra.get("fal", {}))
        result = await _run(model, payload)
        return await _to_asset(result, model,
                               {"instruction": req.instruction, "seed": req.seed})

    async def generate_video(self, req: VideoRequest) -> GenAsset:
        model = get_settings().fal_model_video
        if not req.start_image:
            raise FalError("fal video needs a start keyframe — lock one on the source node first")
        # Loops are seamless by construction: first frame == last frame.
        end = req.end_image if req.kind == "transition" else (req.end_image or req.start_image)
        if not end:
            raise FalError("fal transition needs an end keyframe — lock one on the target node first")
        # FLF field names vary per model family; Kling uses image_url/tail_image_url,
        # Wan-class uses start_image_url/end_image_url. extra["fal"] overrides win.
        if "kling" in model:
            payload: dict[str, Any] = {
                "prompt": req.prompt,
                "image_url": _data_uri(req.start_image),
                "tail_image_url": _data_uri(end),
            }
        else:
            payload = {
                "prompt": req.prompt,
                "start_image_url": _data_uri(req.start_image),
                "end_image_url": _data_uri(end),
            }
        if req.negative:
            payload["negative_prompt"] = req.negative
        if req.seed is not None:
            payload["seed"] = req.seed
        payload.update(req.extra.get("fal", {}))
        result = await _run(model, payload, timeout=1800.0)
        gen = await _to_asset(result, model, {"prompt": req.prompt, "kind": req.kind,
                                              "seed": req.seed})
        gen.frames = gen.frames or req.frames
        gen.fps = gen.fps or req.fps
        return gen

    async def upscale(self, req: UpscaleRequest) -> GenAsset:
        model = get_settings().fal_model_upscale
        if req.image is None:
            raise FalError("fal upscale currently supports image assets")
        payload: dict[str, Any] = {"image_url": _data_uri(req.image)}
        if req.scale:
            payload["scale"] = req.scale
        if req.model:
            payload["model"] = req.model
        payload.update(req.extra.get("fal", {}))
        result = await _run(model, payload)
        return await _to_asset(result, model, {"scale": req.scale})
