"""Pydantic request/response schemas for the REST API."""
from __future__ import annotations

import datetime as dt
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Projects ----------------------------------------------------------
class ProjectCreate(BaseModel):
    name: str
    scenario: str = ""


class ProjectOut(ORM):
    id: str
    name: str
    scenario: str
    meta: dict[str, Any]
    created_at: dt.datetime


# --- Characters --------------------------------------------------------
class CharacterIn(BaseModel):
    name: str
    description: str = ""
    ref_image_ids: list[str] = Field(default_factory=list)
    lora_name: str | None = None
    lora_weight: float = 0.8
    ip_adapter_weight: float = 0.6


class CharacterOut(ORM):
    id: str
    project_id: str
    name: str
    description: str
    ref_image_ids: list[str]
    lora_name: str | None
    lora_weight: float
    ip_adapter_weight: float


# --- Nodes / Edges -----------------------------------------------------
class NodeIn(BaseModel):
    key: str
    title: str = ""
    prompt: str = ""
    negative_prompt: str = ""
    character_id: str | None = None
    x: float = 0.0
    y: float = 0.0


class NodeOut(ORM):
    id: str
    project_id: str
    key: str
    title: str
    prompt: str
    negative_prompt: str
    character_id: str | None
    selected_asset_id: str | None
    selected_thumb: str | None = None
    x: float
    y: float


class EdgeIn(BaseModel):
    source_node_id: str
    target_node_id: str
    kind: str = "transition"  # loop|transition
    label: str = ""
    prompt: str = ""


class EdgeOut(ORM):
    id: str
    project_id: str
    source_node_id: str
    target_node_id: str
    kind: str
    label: str
    prompt: str
    motion_mask_id: str | None
    selected_asset_id: str | None
    selected_thumb: str | None = None


class GraphOut(BaseModel):
    project: ProjectOut
    characters: list[CharacterOut]
    nodes: list[NodeOut]
    edges: list[EdgeOut]


# --- Generation / jobs / assets ---------------------------------------
class GenerateRequest(BaseModel):
    n: int | None = None  # defaults to settings.default_candidates
    params: dict[str, Any] = Field(default_factory=dict)


class JobOut(ORM):
    id: str
    project_id: str
    target_type: str
    target_id: str
    kind: str
    provider: str
    n: int
    status: str
    progress: float
    cost: float
    error: str | None
    created_at: dt.datetime


class AssetOut(ORM):
    id: str
    project_id: str
    job_id: str | None
    owner_type: str | None
    owner_id: str | None
    kind: str
    role: str
    status: str
    path: str
    thumb_path: str | None
    width: int | None
    height: int | None
    frames: int | None
    fps: int | None
    params: dict[str, Any]
    parent_asset_id: str | None
    ai_score: dict[str, Any] | None
    cost: float
    created_at: dt.datetime


class TriageUpdate(BaseModel):
    status: str  # candidate|accepted|rejected|starred


# --- LLM ---------------------------------------------------------------
class ExpandRequest(BaseModel):
    brief: str
    context: str = ""


class ScenarioRequest(BaseModel):
    scenario: str
    apply: bool = True  # build the graph in the project


class ProviderStatus(BaseModel):
    image: str
    video: str
    upscale: str
    llm: str
    comfyui_url: str
    openrouter_configured: bool


# --- Settings (runtime-editable) --------------------------------------
class SettingsOut(BaseModel):
    image_provider: str
    video_provider: str
    upscale_provider: str
    llm_provider: str
    comfyui_url: str
    upscale_model: str
    openrouter_base_url: str
    openrouter_api_key: str  # local single-user tool; shown so it's editable
    llm_text_model: str
    llm_vision_model: str
    default_candidates: int


class SettingsPatch(BaseModel):
    image_provider: str | None = None
    video_provider: str | None = None
    upscale_provider: str | None = None
    llm_provider: str | None = None
    comfyui_url: str | None = None
    upscale_model: str | None = None
    openrouter_base_url: str | None = None
    openrouter_api_key: str | None = None
    llm_text_model: str | None = None
    llm_vision_model: str | None = None
    default_candidates: int | None = None


class TestLLMResult(BaseModel):
    ok: bool
    provider: str
    model: str
    sample: str = ""
    error: str = ""


class ComfyModels(BaseModel):
    online: bool
    error: str | None = None
    checkpoints: list[str] = Field(default_factory=list)
    upscale_models: list[str] = Field(default_factory=list)
    samplers: list[str] = Field(default_factory=list)
    schedulers: list[str] = Field(default_factory=list)
