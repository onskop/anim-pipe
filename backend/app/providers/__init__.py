"""Provider registry — the swappable backend line.

Capabilities are resolved by name from config so any adapter can be hot-swapped
without touching the pipeline. Add a new backend by registering it here.
"""
from __future__ import annotations

from ..config import get_settings
from .base import ImageProvider, LLMProvider, UpscaleProvider, VideoProvider


def get_image_provider() -> ImageProvider:
    name = get_settings().image_provider
    if name == "comfyui":
        from .comfyui import ComfyUIProvider

        return ComfyUIProvider()
    from .mock import MockProvider

    return MockProvider()


def get_video_provider() -> VideoProvider:
    name = get_settings().video_provider
    if name == "comfyui":
        from .comfyui import ComfyUIProvider

        return ComfyUIProvider()
    from .mock import MockProvider

    return MockProvider()


def get_upscale_provider() -> UpscaleProvider:
    name = get_settings().upscale_provider
    if name == "comfyui":
        from .comfyui import ComfyUIProvider

        return ComfyUIProvider()
    from .mock import MockProvider

    return MockProvider()


def get_llm_provider() -> LLMProvider:
    name = get_settings().llm_provider
    if name == "openrouter":
        from .openrouter import OpenRouterProvider

        return OpenRouterProvider()
    from .mock import MockLLM

    return MockLLM()
