export interface Project {
  id: string;
  name: string;
  scenario: string;
  meta: Record<string, unknown>;
  created_at: string;
}

export interface Character {
  id: string;
  project_id: string;
  name: string;
  description: string;
  ref_image_ids: string[];
  lora_name: string | null;
  lora_weight: number;
  ip_adapter_weight: number;
}

export interface GraphMeta {
  id: string;
  project_id: string;
  name: string;
  start_node_id: string | null;
  created_at: string;
}

export interface GraphInfo extends GraphMeta {
  node_count: number;
  edge_count: number;
}

export interface GNode {
  id: string;
  project_id: string;
  graph_id: string | null;
  key: string;
  title: string;
  prompt: string;
  negative_prompt: string;
  character_id: string | null;
  selected_asset_id: string | null;
  selected_thumb: string | null;
  selected_path: string | null;
  selected_kind: string | null;
  asset_count: number;
  x: number;
  y: number;
}

export interface GEdge {
  id: string;
  project_id: string;
  graph_id: string | null;
  source_node_id: string;
  target_node_id: string;
  kind: "loop" | "transition";
  label: string;
  prompt: string;
  motion_mask_id: string | null;
  selected_asset_id: string | null;
  selected_thumb: string | null;
  selected_path: string | null;
  selected_kind: string | null;
  asset_count: number;
}

export interface Graph {
  project: Project;
  graph: GraphMeta;
  characters: Character[];
  nodes: GNode[];
  edges: GEdge[];
}

export interface Job {
  id: string;
  status: "queued" | "running" | "done" | "error";
  progress: number;
  cost: number;
  error: string | null;
  kind: string;
  target_type?: string;
  target_id?: string;
  provider?: string;
  created_at?: string;
}

export interface Asset {
  id: string;
  kind: "image" | "video" | "mask";
  role: string;
  status: "candidate" | "accepted" | "rejected" | "starred";
  path: string;
  thumb_path: string | null;
  width: number | null;
  height: number | null;
  frames: number | null;
  fps: number | null;
  params: Record<string, unknown>;
  parent_asset_id: string | null;
  ai_score: Record<string, number | string> | null;
  cost: number;
}

export interface ProviderStatus {
  image: string;
  video: string;
  upscale: string;
  edit: string;
  llm: string;
  comfyui_url: string;
  openrouter_configured: boolean;
  fal_configured: boolean;
}

/** One job snapshot pushed over the SSE stream (/api/events). */
export interface JobEvent {
  type: "job";
  id: string;
  project_id: string;
  target_type: string;
  target_id: string;
  kind: string;
  status: Job["status"];
  progress: number;
  error: string | null;
  cost: number;
}

export interface Settings {
  image_provider: string;
  video_provider: string;
  upscale_provider: string;
  edit_provider: string;
  llm_provider: string;
  fal_api_key: string;
  fal_model_image: string;
  fal_model_edit: string;
  fal_model_video: string;
  fal_model_upscale: string;
  comfyui_url: string;
  upscale_model: string;
  workflow_image: string;
  workflow_loop: string;
  workflow_transition: string;
  openrouter_base_url: string;
  openrouter_api_key: string;
  llm_text_model: string;
  llm_vision_model: string;
  llm_expand_prompt: string;
  llm_triage_prompt: string;
  default_candidates: number;
}

export interface WorkflowInfo {
  name: string;
  role: "image" | "video";
  fields: string[];
  models: string[];
}

export interface ComfyModels {
  online: boolean;
  error: string | null;
  checkpoints: string[];
  loras: string[];
  upscale_models: string[];
  samplers: string[];
  schedulers: string[];
}

export interface TestLLMResult {
  ok: boolean;
  provider: string;
  model: string;
  sample: string;
  error: string;
}
