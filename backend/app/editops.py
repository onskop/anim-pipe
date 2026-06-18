"""Deterministic, model-free edit operations on stored assets.

Pillow-only so they run anywhere (no GPU, no ffmpeg) against the formats this
app produces today: PNG stills and (animated) GIF clips from the mock/ComfyUI
video path. mp4/webm trimming/frame-extraction needs ffmpeg and raises a clear
error until that's wired.

Each op takes raw bytes and returns an EditResult the API layer stores as a new
lineage-linked Asset (parent = the source asset).
"""
from __future__ import annotations

import io
from dataclasses import dataclass

from PIL import Image


@dataclass
class EditResult:
    data: bytes
    ext: str
    mime: str
    width: int | None = None
    height: int | None = None
    frames: int | None = None
    fps: int | None = None


def _open(data: bytes) -> Image.Image:
    return Image.open(io.BytesIO(data))


def _png(im: Image.Image) -> EditResult:
    im = im.convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return EditResult(buf.getvalue(), "png", "image/png", im.width, im.height)


def crop(data: bytes, box: dict) -> EditResult:
    """box = fractional {x, y, w, h} in 0..1 (resolution-independent)."""
    im = _open(data).convert("RGB")
    W, H = im.size
    x = int(float(box.get("x", 0)) * W)
    y = int(float(box.get("y", 0)) * H)
    w = int(float(box.get("w", 1)) * W)
    h = int(float(box.get("h", 1)) * H)
    x = max(0, min(x, W - 1))
    y = max(0, min(y, H - 1))
    w = max(1, min(w, W - x))
    h = max(1, min(h, H - y))
    return _png(im.crop((x, y, x + w, y + h)))


def resize(data: bytes, width: int, height: int) -> EditResult:
    im = _open(data).convert("RGB").resize(
        (max(1, int(width)), max(1, int(height))), Image.LANCZOS
    )
    return _png(im)


def extract_frame(data: bytes, index: int = 0) -> EditResult:
    """Pull one frame out of a clip (or the still itself) as a PNG keyframe."""
    im = _open(data)
    n = getattr(im, "n_frames", 1)
    im.seek(max(0, min(int(index), n - 1)))
    return _png(im)


def trim(data: bytes, start: int = 0, end: int | None = None) -> EditResult:
    """Keep frames [start, end) of an animated GIF; re-encode as GIF."""
    im = _open(data)
    n = getattr(im, "n_frames", 1)
    if n <= 1:
        raise ValueError("asset is not an animated clip")
    s = max(0, int(start))
    e = n if end is None else min(n, int(end))
    if e <= s:
        raise ValueError("empty frame range")
    frames: list[Image.Image] = []
    durations: list[int] = []
    for i in range(s, e):
        im.seek(i)
        frames.append(im.convert("RGB").copy())
        durations.append(int(im.info.get("duration", 83)))
    buf = io.BytesIO()
    frames[0].save(
        buf, format="GIF", save_all=True, append_images=frames[1:],
        duration=durations, loop=0, disposal=2,
    )
    avg = sum(durations) / len(durations) if durations else 83
    fps = int(round(1000 / avg)) if avg else 12
    return EditResult(buf.getvalue(), "gif", "image/gif",
                      frames[0].width, frames[0].height, len(frames), fps)
