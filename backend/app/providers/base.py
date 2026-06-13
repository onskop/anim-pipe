"""Provider interfaces + shared request/result types.

Adapters translate these neutral requests into backend-specific calls (ComfyUI
graphs, REST APIs, etc.) and return raw bytes + metadata. The pipeline layer
handles storage, DB rows, triage and cost — adapters stay thin.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, runtime_checkable


@dataclass
class ImageRequest:
    prompt: str
    negative: str = ""
    width: int = 768
    height: int = 768
    seed: int | None = None  # None -> random per candidate
    steps: int = 28
    cfg: float = 6.5
    checkpoint: str | None = None
    # Consistency knobs.
    lora_name: str | None = None
    lora_weight: float = 0.8
    ref_images: list[bytes] = field(default_factory=list)  # IP-Adapter refs
    ip_adapter_weight: float = 0.6
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class VideoRequest:
    kind: str  # "loop" | "transition"
    prompt: str
    negative: str = ""
    start_image: bytes | None = None  # frame 0 condition
    end_image: bytes | None = None  # final frame condition (FLF2V / loop)
    motion_mask: bytes | None = None  # cinemagraph: animate only this region
    frames: int = 25
    fps: int = 12
    motion_scale: float = 0.6  # lower = subtler (idle loops)
    seed: int | None = None
    closed_loop: bool = False  # enforce first==last for seamless looping
    width: int = 768
    height: int = 768
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class UpscaleRequest:
    image: bytes | None = None
    video_frames: list[bytes] = field(default_factory=list)
    scale: int = 2
    model: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


@dataclass
class GenAsset:
    data: bytes
    ext: str  # "png" | "gif" | "mp4" | "webp"
    mime: str
    width: int | None = None
    height: int | None = None
    frames: int | None = None
    fps: int | None = None
    params: dict[str, Any] = field(default_factory=dict)  # seed, model, etc.
    cost: float = 0.0


@dataclass
class TriageScore:
    """AI triage verdict for one candidate (0..1 unless noted)."""

    overall: float
    character_consistency: float = 0.0
    motion_quality: float = 0.0
    loop_seamlessness: float = 0.0
    artifacts: float = 0.0  # higher = fewer artifacts
    verdict: str = "keep"  # keep | reject | borderline
    notes: str = ""


@runtime_checkable
class ImageProvider(Protocol):
    async def generate_image(self, req: ImageRequest) -> GenAsset: ...


@runtime_checkable
class VideoProvider(Protocol):
    async def generate_video(self, req: VideoRequest) -> GenAsset: ...


@runtime_checkable
class UpscaleProvider(Protocol):
    async def upscale(self, req: UpscaleRequest) -> GenAsset: ...


@runtime_checkable
class LLMProvider(Protocol):
    async def expand_prompt(self, brief: str, context: str = "") -> str: ...

    async def score_candidate(
        self, image: bytes, intent: str, kind: str
    ) -> TriageScore: ...

    async def scenario_to_graph(self, scenario: str) -> dict[str, Any]: ...
