import type {
  Asset, Character, ComfyModels, GEdge, GNode, Graph, GraphInfo, GraphMeta, Job,
  JobEvent, Project, ProviderStatus, Settings, TestLLMResult, WorkflowInfo,
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

/* --- SSE job events (one shared connection, /api/events) ---------------- */
let eventSource: EventSource | null = null;
const jobListeners = new Set<(e: JobEvent) => void>();

function ensureEvents() {
  if (eventSource) return;
  eventSource = new EventSource(`${BASE}/events`);
  eventSource.onmessage = (m) => {
    try {
      const d = JSON.parse(m.data);
      if (d.type === "job") jobListeners.forEach((fn) => fn(d as JobEvent));
    } catch {
      /* ignore malformed frames */
    }
  };
}

/** Subscribe to pushed job snapshots. Returns an unsubscribe function. */
export function onJobEvent(fn: (e: JobEvent) => void): () => void {
  ensureEvents();
  jobListeners.add(fn);
  return () => jobListeners.delete(fn);
}

/** Resolve when a job finishes, streaming progress via SSE (with a slow
    polling safety net in case the stream drops mid-job). */
export function waitJob(jobId: string, onProgress?: (p: number) => void): Promise<Job> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (j: Job) => {
      if (settled) return;
      settled = true;
      off();
      window.clearInterval(iv);
      resolve(j);
    };
    const off = onJobEvent((e) => {
      if (e.id !== jobId) return;
      onProgress?.(e.progress);
      if (e.status === "done" || e.status === "error") {
        api.job(jobId).then(finish).catch(() => {});
      }
    });
    const iv = window.setInterval(async () => {
      const j = await api.job(jobId).catch(() => null);
      if (j && (j.status === "done" || j.status === "error")) finish(j);
    }, 5000);
  });
}

export const api = {
  providers: () => j<ProviderStatus>("/providers"),
  listProjects: () => j<Project[]>("/projects"),
  createProject: (name: string, scenario = "") =>
    j<Project>("/projects", { method: "POST", body: JSON.stringify({ name, scenario }) }),
  updateProject: (pid: string, body: { name?: string; scenario?: string }) =>
    j<Project>(`/projects/${pid}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteProject: (pid: string) => j(`/projects/${pid}`, { method: "DELETE" }),

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
  deleteCharacter: (cid: string) => j(`/characters/${cid}`, { method: "DELETE" }),

  generateNode: (id: string, n: number, params = {}) =>
    j<Job>(`/nodes/${id}/generate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  // Instruction-edit derive: new keyframe candidates from an existing image.
  deriveNode: (id: string, sourceAssetId: string, instruction: string, n: number, params = {}) =>
    j<Job>(`/nodes/${id}/derive`, {
      method: "POST",
      body: JSON.stringify({ source_asset_id: sourceAssetId, instruction, n, params }),
    }),
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
  // Attach a lightweight copy of an asset to another node/edge (shares the file).
  copyAsset: (aid: string, ownerType: "node" | "edge", ownerId: string) =>
    j<Asset>(`/assets/${aid}/copy`, {
      method: "POST", body: JSON.stringify({ owner_type: ownerType, owner_id: ownerId }),
    }),
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
  workflows: () => j<WorkflowInfo[]>("/workflows"),
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
