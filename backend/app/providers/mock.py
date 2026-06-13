"""Mock provider — deterministic placeholder generation with zero dependencies
beyond Pillow. Lets the entire app (graph -> generate -> triage -> select ->
upscale) run in any container with no GPU and no API keys.

Images are labeled cards; videos are short animated GIFs. Loops are made
seamless (ping-pong) and transitions cross-fade between the start/end frames so
the UI behaves like the real thing.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import random

from PIL import Image, ImageDraw, ImageFont

from .base import (
    GenAsset,
    ImageRequest,
    TriageScore,
    UpscaleRequest,
    VideoRequest,
)


def _color_from(seed_text: str) -> tuple[int, int, int]:
    h = hashlib.sha256(seed_text.encode()).digest()
    return (60 + h[0] % 150, 60 + h[1] % 150, 60 + h[2] % 150)


def _font():
    try:
        return ImageFont.load_default()
    except Exception:  # pragma: no cover
        return None


def _card(text: str, w: int, h: int, bg: tuple[int, int, int]) -> Image.Image:
    im = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(im)
    # A simple "character" silhouette so frames read as a standing figure.
    cx = w // 2
    d.ellipse([cx - w // 10, h // 6, cx + w // 10, h // 6 + h // 5], fill=(240, 230, 220))
    d.rectangle([cx - w // 8, h // 6 + h // 6, cx + w // 8, h - h // 6], fill=(230, 220, 210))
    font = _font()
    lines = [text[i : i + 28] for i in range(0, min(len(text), 140), 28)]
    y = h - h // 6 + 4
    for ln in lines:
        d.text((8, y), ln, fill=(255, 255, 255), font=font)
        y += 12
    return im


class MockProvider:
    async def generate_image(self, req: ImageRequest) -> GenAsset:
        await asyncio.sleep(0.05)
        seed = req.seed if req.seed is not None else random.randint(0, 2**31)
        bg = _color_from(f"{req.prompt}:{seed}")
        im = _card(f"IMG seed={seed} :: {req.prompt}", req.width, req.height, bg)
        buf = io.BytesIO()
        im.save(buf, format="PNG")
        return GenAsset(
            data=buf.getvalue(),
            ext="png",
            mime="image/png",
            width=req.width,
            height=req.height,
            params={"seed": seed, "model": "mock", "prompt": req.prompt},
            cost=0.0,
        )

    async def generate_video(self, req: VideoRequest) -> GenAsset:
        await asyncio.sleep(0.1)
        seed = req.seed if req.seed is not None else random.randint(0, 2**31)
        w, h = req.width, req.height
        start = self._load(req.start_image) or _card("A", w, h, _color_from(f"a{seed}"))
        if req.kind == "transition" and req.end_image is not None:
            end = self._load(req.end_image) or _card("B", w, h, _color_from(f"b{seed}"))
        else:
            end = start  # loop: same node
        start = start.resize((w, h)).convert("RGB")
        end = end.resize((w, h)).convert("RGB")

        n = max(2, min(req.frames, 48))
        frames: list[Image.Image] = []
        for i in range(n):
            t = i / (n - 1)
            if req.kind == "loop" or req.closed_loop:
                # ping-pong so first == last (seamless)
                t = 1 - abs(2 * t - 1)
                t *= req.motion_scale  # subtler idle motion
            frame = Image.blend(start, end, t)
            d = ImageDraw.Draw(frame)
            d.text((6, 6), f"{req.kind} f{i+1}/{n}", fill=(255, 255, 0), font=_font())
            frames.append(frame)

        buf = io.BytesIO()
        frames[0].save(
            buf,
            format="GIF",
            save_all=True,
            append_images=frames[1:],
            duration=int(1000 / max(req.fps, 1)),
            loop=0,
        )
        return GenAsset(
            data=buf.getvalue(),
            ext="gif",
            mime="image/gif",
            width=w,
            height=h,
            frames=n,
            fps=req.fps,
            params={"seed": seed, "model": "mock", "kind": req.kind},
            cost=0.0,
        )

    async def upscale(self, req: UpscaleRequest) -> GenAsset:
        await asyncio.sleep(0.05)
        if req.image is not None:
            im = Image.open(io.BytesIO(req.image)).convert("RGB")
            im = im.resize((im.width * req.scale, im.height * req.scale))
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            return GenAsset(
                data=buf.getvalue(),
                ext="png",
                mime="image/png",
                width=im.width,
                height=im.height,
                params={"model": "mock-upscale", "scale": req.scale},
            )
        raise ValueError("mock upscale: no image provided")

    @staticmethod
    def _load(data: bytes | None) -> Image.Image | None:
        if not data:
            return None
        try:
            im = Image.open(io.BytesIO(data))
            im.seek(0)
            return im.convert("RGB")
        except Exception:
            return None


class MockLLM:
    async def expand_prompt(self, brief: str, context: str = "") -> str:
        return f"{brief}, detailed, dynamic lighting, expressive pose"

    async def score_candidate(self, image: bytes, intent: str, kind: str) -> TriageScore:
        # Deterministic pseudo-score so triage UI is exercisable.
        h = hashlib.sha256(image).digest()
        base = 0.5 + (h[0] % 50) / 100
        return TriageScore(
            overall=base,
            character_consistency=0.4 + (h[1] % 60) / 100,
            motion_quality=0.4 + (h[2] % 60) / 100,
            loop_seamlessness=0.4 + (h[3] % 60) / 100,
            artifacts=0.4 + (h[4] % 60) / 100,
            verdict="keep" if base > 0.6 else "borderline",
            notes="mock score",
        )

    async def scenario_to_graph(self, scenario: str) -> dict:
        # Naive: one node per non-empty line, loop edge on each.
        nodes, edges = [], []
        for i, line in enumerate([l.strip() for l in scenario.splitlines() if l.strip()]):
            key = f"n{i+1}"
            nodes.append({"key": key, "title": line[:40], "prompt": line})
            edges.append({"source": key, "target": key, "kind": "loop", "label": "idle"})
            if i > 0:
                edges.append(
                    {"source": f"n{i}", "target": key, "kind": "transition", "label": "->"}
                )
        return {"nodes": nodes, "edges": edges}
