"""Content-addressed asset store.

Bytes are written once under data/assets/<ab>/<cd>/<sha256>.<ext>. The DB Asset
row points at the relative path. Identical generations dedupe naturally.
"""
from __future__ import annotations

import hashlib
import io
from pathlib import Path

from PIL import Image

from .config import get_settings


def _settings():
    return get_settings()


def store_bytes(data: bytes, ext: str) -> tuple[str, str]:
    """Return (relative_path, sha256)."""
    digest = hashlib.sha256(data).hexdigest()
    rel = Path(digest[:2]) / digest[2:4] / f"{digest}.{ext.lstrip('.')}"
    dest = _settings().assets_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        dest.write_bytes(data)
    return str(rel), digest


def abs_path(rel: str) -> Path:
    return _settings().assets_dir / rel


def read_bytes(rel: str) -> bytes:
    return abs_path(rel).read_bytes()


def remove_file(rel: str | None) -> None:
    """Best-effort unlink of a stored file. Caller must ensure it's unreferenced
    (content-addressed paths can be shared by dedup'd assets)."""
    if not rel:
        return
    try:
        abs_path(rel).unlink(missing_ok=True)
    except Exception:
        pass


def make_thumb(rel_source: str, max_px: int = 256) -> str | None:
    """Create a PNG thumbnail for an image or the first frame of a GIF."""
    src = abs_path(rel_source)
    try:
        with Image.open(src) as im:
            im.seek(0)
            im = im.convert("RGB")
            im.thumbnail((max_px, max_px))
            buf = io.BytesIO()
            im.save(buf, format="PNG")
            rel, _ = store_bytes(buf.getvalue(), "png")
            return rel
    except Exception:
        return None
