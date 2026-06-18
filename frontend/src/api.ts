import type {
  Asset, Character, ComfyModels, GEdge, GNode, Graph, GraphInfo, GraphMeta, Job,
  Project, ProviderStatus, Settings, TestLLMResult,
} from "./types";

const BASE = "/api";

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(BASE + url, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
}

export const fileUrl = (path: string) => `${BASE}/files/${path}`;

export const api = {
  providers: () => j<ProviderStatus>("/providers"),
  listProjects: () => j<Project[]>("/projects"),
  createProject: (name: string, scenario = "") =>
    j<Project>("/projects", { method: "POST", body: JSON.stringify({ name, scenario }) }),

  // graphs (scenes)
  graphs: (pid: string) => j<GraphInfo[]>(`/projects/${pid}/graphs`),
  createGraph: (pid: string, name: string) =>
    j<GraphMeta>(`/projects/${pid}/graphs`, { method: "POST", body: JSON.stringify({ name }) }),
  renameGraph: (gid: string, body: { name?: string; start_node_id?: string }) =>
    j<GraphMeta>(`/graphs/${gid}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteGraph: (gid: string) => j(`/graphs/${gid}`, { method: "DELETE" }),
  graphContents: (gid: string) => j<Graph>(`/graphs/${gid}`),

  scenario: (gid: string, scenario: string) =>
    j<Graph>(`/graphs/${gid}/scenario`, {
      method: "POST", body: JSON.stringify({ scenario, apply: true }),
    }),

  createNode: (gid: string, body: Partial<GNode>) =>
    j<GNode>(`/graphs/${gid}/nodes`, { method: "POST", body: JSON.stringify(body) }),
  updateNode: (id: string, body: Partial<GNode>) =>
    j<GNode>(`/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteNode: (id: string) => j(`/nodes/${id}`, { method: "DELETE" }),

  createEdge: (gid: string, body: Partial<GEdge>) =>
    j<GEdge>(`/graphs/${gid}/edges`, { method: "POST", body: JSON.stringify(body) }),
  updateEdge: (id: string, body: Partial<GEdge>) =>
    j<GEdge>(`/edges/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEdge: (id: string) => j(`/edges/${id}`, { method: "DELETE" }),

  createCharacter: (pid: string, body: Partial<Character>) =>
    j<Character>(`/projects/${pid}/characters`, { method: "POST", body: JSON.stringify(body) }),
  updateCharacter: (cid: string, body: Partial<Character>) =>
    j<Character>(`/characters/${cid}`, { method: "PUT", body: JSON.stringify(body) }),

  generateNode: (id: string, n: number, params = {}) =>
    j<Job>(`/nodes/${id}/generate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  generateEdge: (id: string, n: number, params = {}) =>
    j<Job>(`/edges/${id}/generate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  job: (id: string) => j<Job>(`/jobs/${id}`),

  assets: (ownerType: "node" | "edge", id: string) =>
    j<Asset[]>(`/${ownerType}/${id}/assets`),
  asset: (aid: string) => j<Asset>(`/assets/${aid}`),
  uploadAsset: async (pid: string, file: File, kind = "image"): Promise<Asset> => {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${BASE}/projects/${pid}/upload?kind=${kind}`, {
      method: "POST",
      body: form,
    });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    return r.json() as Promise<Asset>;
  },
  triage: (id: string, status: Asset["status"]) =>
    j<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  selectNodeAsset: (nid: string, aid: string) =>
    j<GNode>(`/nodes/${nid}/select/${aid}`, { method: "POST" }),
  selectEdgeAsset: (eid: string, aid: string) =>
    j<GEdge>(`/edges/${eid}/select/${aid}`, { method: "POST" }),
  upscale: (aid: string, params: Record<string, unknown> = { scale: 2 }) =>
    j<Job>(`/assets/${aid}/upscale`, { method: "POST", body: JSON.stringify({ params }) }),
  regenerate: (aid: string, n: number, params: Record<string, unknown> = {}) =>
    j<Job>(`/assets/${aid}/regenerate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  editAsset: (aid: string, op: string, args: Record<string, unknown> = {}) =>
    j<Asset>(`/assets/${aid}/edit`, { method: "POST", body: JSON.stringify({ op, args }) }),
  score: (aid: string) => j<Asset>(`/assets/${aid}/score`, { method: "POST" }),
  deleteAsset: (aid: string) => j(`/assets/${aid}`, { method: "DELETE" }),

  expand: (brief: string, context = "") =>
    j<{ prompt: string }>("/llm/expand", { method: "POST", body: JSON.stringify({ brief, context }) }),

  // settings / control
  settings: () => j<Settings>("/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    j<Settings>("/settings", { method: "PATCH", body: JSON.stringify(patch) }),
  testLLM: () => j<TestLLMResult>("/settings/test-llm", { method: "POST" }),
  comfyModels: () => j<ComfyModels>("/comfyui/models"),
  restart: () => j<{ ok: boolean }>("/restart", { method: "POST" }),
  health: async () => {
    try {
      const r = await fetch(BASE + "/health");
      return r.ok;
    } catch {
      return false;
    }
  },
};
