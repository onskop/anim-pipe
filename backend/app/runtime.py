"""Runtime-editable settings overlay.

The base :class:`Settings` come from ``.env`` / environment (process start).
This module layers a small JSON file (``data/runtime.json``) on top so a few
fields can be changed live from the UI — swap providers, point at a different
OpenRouter model, set the ComfyUI URL — *without* editing files or restarting.

We mutate the cached ``Settings`` singleton in place (it's a plain pydantic
model), so every ``get_settings()`` caller and freshly-built provider sees the
change immediately. Changes are persisted to ``runtime.json`` and re-applied on
the next startup.
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from .config import get_settings

# Only these fields may be changed at runtime from the UI.
OVERRIDABLE: tuple[str, ...] = (
    "image_provider",
    "video_provider",
    "upscale_provider",
    "llm_provider",
    "comfyui_url",
    "upscale_model",
    "workflow_image",
    "workflow_loop",
    "workflow_transition",
    "openrouter_api_key",
    "openrouter_base_url",
    "llm_text_model",
    "llm_vision_model",
    "llm_expand_prompt",
    "llm_triage_prompt",
    "default_candidates",
)


def _path() -> Path:
    s = get_settings()
    s.data_dir.mkdir(parents=True, exist_ok=True)
    return s.data_dir / "runtime.json"


def load() -> dict[str, Any]:
    p = _path()
    if not p.exists():
        return {}
    try:
        data = json.loads(p.read_text())
        return {k: v for k, v in data.items() if k in OVERRIDABLE}
    except Exception:
        return {}


def save(overrides: dict[str, Any]) -> None:
    _path().write_text(json.dumps(overrides, indent=2))


def apply_to_settings() -> None:
    """Apply persisted overrides onto the live Settings singleton (startup)."""
    s = get_settings()
    for k, v in load().items():
        setattr(s, k, v)


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply + persist a partial settings change. Returns merged overrides."""
    s = get_settings()
    overrides = load()
    for k, v in patch.items():
        if k not in OVERRIDABLE:
            continue
        setattr(s, k, v)
        overrides[k] = v
    save(overrides)
    return overrides
