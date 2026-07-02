"""fal.ai adapter unit tests — payload mapping + result parsing, no network.

``_run``/``_download`` are monkeypatched so these verify the neutral-request →
fal-payload translation (including the per-model-family field-name differences)
without keys or HTTP.
"""
from __future__ import annotations

import asyncio
import os
import tempfile

import pytest

os.environ.setdefault("ANIMPIPE_DATA_DIR", tempfile.mkdtemp(prefix="animpipe-test-"))

from app.config import get_settings  # noqa: E402
from app.providers import fal  # noqa: E402
from app.providers.base import ImageEditRequest, ImageRequest, VideoRequest  # noqa: E402


class _CaptureRun:
    def __init__(self, result):
        self.calls: list[tuple[str, dict]] = []
        self.result = result

    async def __call__(self, model, payload, timeout=600.0):
        self.calls.append((model, payload))
        return self.result

    @property
    def last(self):
        return self.calls[-1]


@pytest.fixture
def run(monkeypatch):
    cap = _CaptureRun({"images": [{"url": "http://x/i.png", "width": 8, "height": 8}],
                       "seed": 42})
    monkeypatch.setattr(fal, "_run", cap)

    async def fake_download(url):
        return b"png-bytes", "image/png"

    monkeypatch.setattr(fal, "_download", fake_download)
    return cap


def test_image_payload_and_result(run):
    req = ImageRequest(prompt="hero", negative="blurry", width=512, height=768,
                       seed=7, steps=20, cfg=5.0)
    gen = asyncio.run(fal.FalProvider().generate_image(req))
    model, payload = run.last
    assert model == get_settings().fal_model_image
    assert payload["prompt"] == "hero"
    assert payload["negative_prompt"] == "blurry"
    assert payload["image_size"] == {"width": 512, "height": 768}
    assert payload["seed"] == 7
    assert gen.ext == "png" and gen.mime == "image/png"
    assert gen.params["seed"] == 42  # provider-echoed seed wins
    assert gen.params["provider"] == "fal"


def test_edit_field_shape_kontext_vs_nanobanana(run, monkeypatch):
    s = get_settings()
    req = ImageEditRequest(image=b"src", instruction="eyes closed")

    monkeypatch.setattr(s, "fal_model_edit", "fal-ai/flux-kontext/dev")
    asyncio.run(fal.FalProvider().edit_image(req))
    _, payload = run.last
    assert payload["prompt"] == "eyes closed"
    assert payload["image_url"].startswith("data:image/png;base64,")
    assert "image_urls" not in payload

    monkeypatch.setattr(s, "fal_model_edit", "fal-ai/nano-banana/edit")
    asyncio.run(fal.FalProvider().edit_image(req))
    _, payload = run.last
    assert isinstance(payload["image_urls"], list) and len(payload["image_urls"]) == 1
    assert "image_url" not in payload


def test_video_loop_first_equals_last(run, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "fal_model_video", "fal-ai/wan-flf2v")
    req = VideoRequest(kind="loop", prompt="breathing", start_image=b"key")
    asyncio.run(fal.FalProvider().generate_video(req))
    _, payload = run.last
    assert payload["start_image_url"] == payload["end_image_url"]  # seamless loop


def test_video_kling_field_names(run, monkeypatch):
    s = get_settings()
    monkeypatch.setattr(s, "fal_model_video", "fal-ai/kling-video/v2.5/pro")
    req = VideoRequest(kind="transition", prompt="walk", start_image=b"a", end_image=b"b")
    asyncio.run(fal.FalProvider().generate_video(req))
    _, payload = run.last
    assert "image_url" in payload and "tail_image_url" in payload
    assert "start_image_url" not in payload


def test_video_requires_keyframes():
    req = VideoRequest(kind="transition", prompt="walk", start_image=None)
    with pytest.raises(fal.FalError, match="start keyframe"):
        asyncio.run(fal.FalProvider().generate_video(req))


def test_extra_fal_overrides_win(run):
    req = ImageRequest(prompt="p", extra={"fal": {"num_inference_steps": 4,
                                                  "enable_safety_checker": False}})
    asyncio.run(fal.FalProvider().generate_image(req))
    _, payload = run.last
    assert payload["num_inference_steps"] == 4
    assert payload["enable_safety_checker"] is False
