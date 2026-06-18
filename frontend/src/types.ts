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

export interface GNode {
  id: string;
  project_id: string;
  key: string;
  title: string;
  prompt: string;
  negative_prompt: string;
  character_id: string | null;
  selected_asset_id: string | null;
  selected_thumb: string | null;
  selected_path: string | null;
  selected_kind: string | null;
  x: number;
  y: number;
}

export interface GEdge {
  id: string;
  project_id: string;
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
}

export interface Graph {
  project: Project;
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
  llm: string;
  comfyui_url: string;
  openrouter_configured: boolean;
}

export interface Settings {
  image_provider: string;
  video_provider: string;
  upscale_provider: string;
  llm_provider: string;
  comfyui_url: string;
  upscale_model: string;
  openrouter_base_url: string;
  openrouter_api_key: string;
  llm_text_model: string;
  llm_vision_model: string;
  default_candidates: number;
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
