"""Runtime configuration.

All settings can be overridden via environment variables (prefix ANIMPIPE_) or a
.env file. Defaults are chosen so the app runs end-to-end with zero setup using
the built-in Mock provider — no GPU, no API keys required.
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ANIMPIPE_", env_file=".env", extra="ignore"
    )

    # --- Storage ---------------------------------------------------------
    data_dir: Path = Field(default=Path("data"))
    db_url: str = Field(default="")  # derived from data_dir if empty

    # --- Provider selection ---------------------------------------------
    # Which adapter backs each capability. "mock" works anywhere.
    image_provider: str = Field(default="mock")  # mock | comfyui
    video_provider: str = Field(default="mock")  # mock | comfyui
    upscale_provider: str = Field(default="mock")  # mock | comfyui
    llm_provider: str = Field(default="mock")  # mock | openrouter

    # --- Local tools ----------------------------------------------------
    # ffmpeg binary for video frame extraction. Empty -> auto-discover on PATH,
    # else fall back to the one bundled by the imageio-ffmpeg package.
    ffmpeg_path: str = Field(default="")

    # --- ComfyUI (local GPU) --------------------------------------------
    comfyui_url: str = Field(default="http://127.0.0.1:8188")
    # Default ESRGAN model name for upscaling (must exist in ComfyUI
    # models/upscale_models). Empty -> the upscale workflow's own default.
    upscale_model: str = Field(default="")
    # Which workflow template (file in providers/workflows/) backs each ComfyUI
    # job. Swap from the Settings picker without touching code.
    workflow_image: str = Field(default="txt2img_anime.json")
    workflow_loop: str = Field(default="video_loop.json")
    workflow_transition: str = Field(default="video_flf2v.json")

    # --- OpenRouter (swappable "intelligence" line) ---------------------
    openrouter_api_key: str = Field(default="")
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1")
    # Default text + vision models; override per request from the UI.
    llm_text_model: str = Field(default="anthropic/claude-3.5-sonnet")
    llm_vision_model: str = Field(default="anthropic/claude-3.5-sonnet")
    # System prompts for the two LLM jobs — editable live from the UI so the
    # scoring rubric and prompt-expansion style can be tuned per model.
    llm_expand_prompt: str = Field(
        default=(
            "You write concise, vivid image-generation prompts for an anime/cartoon "
            "game character. Keep character identity consistent. Return ONLY the prompt."
        )
    )
    llm_triage_prompt: str = Field(
        default=(
            "You are a strict art director triaging generated game assets. "
            "Score 0..1 and return ONLY JSON with keys: overall, character_consistency, "
            "motion_quality, loop_seamlessness, artifacts, verdict (keep|reject|borderline), notes."
        )
    )

    # --- Generation defaults --------------------------------------------
    default_candidates: int = Field(default=4)  # how many to fan out per request
    max_concurrent_jobs: int = Field(default=2)

    @property
    def resolved_db_url(self) -> str:
        if self.db_url:
            return self.db_url
        self.data_dir.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{(self.data_dir / 'animpipe.sqlite').resolve()}"

    @property
    def assets_dir(self) -> Path:
        d = self.data_dir / "assets"
        d.mkdir(parents=True, exist_ok=True)
        return d


@lru_cache
def get_settings() -> Settings:
    return Settings()
