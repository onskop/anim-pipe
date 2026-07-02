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


class ProjectPatch(BaseModel):
    name: str | None = None
    scenario: str | None = None


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
    graph_id: str | None
    key: str
    title: str
    prompt: str
    negative_prompt: str
    character_id: str | None
    selected_asset_id: str | None
    selected_thumb: str | None = None
    selected_path: str | None = None  # full asset file (still) for the player
    selected_kind: str | None = None  # image|video
    asset_count: int = 0  # candidate resources attached to this node
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
    graph_id: str | None
    source_node_id: str
    target_node_id: str
    kind: str
    label: str
    prompt: str
    motion_mask_id: str | None
    selected_asset_id: str | None
    selected_thumb: str | None = None
    selected_path: str | None = None  # full clip/still file for the player
    selected_kind: str | None = None  # image|video
    asset_count: int = 0  # candidate resources attached to this edge


# --- Graphs (scenes) ---------------------------------------------------
class GraphMeta(ORM):
    id: str
    project_id: str
    name: str
    start_node_id: str | None
    created_at: dt.datetime


class GraphInfo(GraphMeta):
    """Graph metadata + counts for the switcher list."""
    node_count: int = 0
    edge_count: int = 0


class GraphCreate(BaseModel):
    name: str = "Scene"


class GraphRename(BaseModel):
    name: str | None = None
    start_node_id: str | None = None


class GraphOut(BaseModel):
    project: ProjectOut
    graph: GraphMeta
    characters: list[CharacterOut]
    nodes: list[NodeOut]
    edges: list[EdgeOut]


# --- Generation / jobs / assets ---------------------------------------
class GenerateRequest(BaseModel):
    n: int | None = None  # defaults to settings.default_candidates
    params: dict[str, Any] = Field(default_factory=dict)


class PromptPreview(BaseModel):
    """The final assembled prompts generation would send to the provider."""
    positive: str
    negative: str


class DeriveRequest(BaseModel):
    """Instruction-edit derive: keyframe candidates from an existing image."""
    source_asset_id: str
    instruction: str
    n: int | None = None
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


class EditRequest(BaseModel):
    op: str  # crop|resize|trim|extract_frame
    args: dict[str, Any] = Field(default_factory=dict)


class AssetCopyRequest(BaseModel):
    """Attach a copy of an asset to another node/edge."""
    owner_type: str  # node|edge
    owner_id: str


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
    edit: str
    llm: str
    comfyui_url: str
    openrouter_configured: bool
    fal_configured: bool = False


# --- Settings (runtime-editable) --------------------------------------
class SettingsOut(BaseModel):
    image_provider: str
    video_provider: str
    upscale_provider: str
    edit_provider: str
    llm_provider: str
    fal_api_key: str  # local single-user tool; shown so it's editable
    fal_model_image: str
    fal_model_edit: str
    fal_model_video: str
    fal_model_upscale: str
    comfyui_url: str
    upscale_model: str
    workflow_image: str
    workflow_loop: str
    workflow_transition: str
    openrouter_base_url: str
    openrouter_api_key: str  # local single-user tool; shown so it's editable
    llm_text_model: str
    llm_vision_model: str
    llm_expand_prompt: str
    llm_triage_prompt: str
    default_candidates: int


class SettingsPatch(BaseModel):
    image_provider: str | None = None
    video_provider: str | None = None
    upscale_provider: str | None = None
    edit_provider: str | None = None
    llm_provider: str | None = None
    fal_api_key: str | None = None
    fal_model_image: str | None = None
    fal_model_edit: str | None = None
    fal_model_video: str | None = None
    fal_model_upscale: str | None = None
    comfyui_url: str | None = None
    upscale_model: str | None = None
    workflow_image: str | None = None
    workflow_loop: str | None = None
    workflow_transition: str | None = None
    openrouter_base_url: str | None = None
    openrouter_api_key: str | None = None
    llm_text_model: str | None = None
    llm_vision_model: str | None = None
    llm_expand_prompt: str | None = None
    llm_triage_prompt: str | None = None
    default_candidates: int | None = None


class TestLLMResult(BaseModel):
    ok: bool
    provider: str
    model: str
    sample: str = ""
    error: str = ""


class WorkflowInfo(BaseModel):
    """A workflow template the app can run, with the logical fields it can drive
    (auto-detected from titles/inputs/types) and the model files it references."""
    name: str
    role: str  # image | video
    fields: list[str] = Field(default_factory=list)
    models: list[str] = Field(default_factory=list)


class ComfyModels(BaseModel):
    online: bool
    error: str | None = None
    checkpoints: list[str] = Field(default_factory=list)
    loras: list[str] = Field(default_factory=list)
    upscale_models: list[str] = Field(default_factory=list)
    samplers: list[str] = Field(default_factory=list)
    schedulers: list[str] = Field(default_factory=list)
