"""Deterministic, model-free edit operations on stored assets.

Each op takes raw bytes and returns an EditResult the API layer stores as a new
lineage-linked Asset (parent = the source asset). Crop/resize/trim are Pillow-
only (no GPU). Frame extraction works on stills/animated GIF via Pillow and on
real video (mp4/webm/mov/...) via ffmpeg — resolved from PATH or the binary
bundled by the imageio-ffmpeg package, so no manual install is required.
"""
from __future__ import annotations

import io
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image

# Containers Pillow cannot decode frame-by-frame — route these through ffmpeg.
VIDEO_EXTS = {"mp4", "webm", "mov", "m4v", "mkv", "avi", "ogv"}


def _ffmpeg_exe() -> str:
    """Locate an ffmpeg binary: settings override -> PATH -> imageio-ffmpeg
    bundle. Raises a clear error (no silent fake) when none is available."""
    from .config import get_settings

    configured = get_settings().ffmpeg_path
    if configured:
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(
            "ffmpeg not found — install it on PATH, set ANIMPIPE_FFMPEG_PATH, "
            "or `pip install imageio-ffmpeg`"
        ) from exc


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


def extract_frame(data: bytes, index: int = 0, ext: str | None = None) -> EditResult:
    """Pull one frame out of a clip (or the still itself) as a PNG keyframe.

    GIF/PNG/WebP go through Pillow; real video containers (mp4/webm/...) go
    through ffmpeg, selected by ``ext`` (the source asset's file extension).
    """
    if ext and ext.lower().lstrip(".") in VIDEO_EXTS:
        return _extract_frame_video(data, int(index), ext.lower().lstrip("."))
    im = _open(data)
    n = getattr(im, "n_frames", 1)
    im.seek(max(0, min(int(index), n - 1)))
    return _png(im)


def _extract_frame_video(data: bytes, index: int, ext: str) -> EditResult:
    """Decode frame ``index`` from a video container via ffmpeg → PNG bytes."""
    exe = _ffmpeg_exe()
    idx = max(0, index)
    with tempfile.TemporaryDirectory() as td:
        src = Path(td) / f"in.{ext}"
        out = Path(td) / "frame.png"
        src.write_bytes(data)
        # select=eq(n,idx) grabs exactly that frame index; -frames:v 1 stops
        # after the first match. The comma in the filter must be backslash-
        # escaped even as a single argv token (ffmpeg filtergraph syntax).
        proc = subprocess.run(
            [exe, "-nostdin", "-y", "-i", str(src),
             "-vf", f"select=eq(n\\,{idx})", "-frames:v", "1", "-vsync", "0",
             str(out)],
            capture_output=True,
        )
        if not out.exists() or out.stat().st_size == 0:
            tail = proc.stderr.decode("utf-8", "replace")[-400:]
            raise ValueError(
                f"could not extract frame {idx} (clip may have fewer frames). {tail}"
            )
        png = out.read_bytes()
    im = Image.open(io.BytesIO(png)).convert("RGB")
    return EditResult(png, "png", "image/png", im.width, im.height)


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
