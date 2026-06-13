import type {
  Asset, Character, GEdge, GNode, Graph, Job, Project, ProviderStatus,
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
  graph: (pid: string) => j<Graph>(`/projects/${pid}/graph`),

  scenario: (pid: string, scenario: string) =>
    j<Graph>(`/projects/${pid}/scenario`, {
      method: "POST", body: JSON.stringify({ scenario, apply: true }),
    }),

  createNode: (pid: string, body: Partial<GNode>) =>
    j<GNode>(`/projects/${pid}/nodes`, { method: "POST", body: JSON.stringify(body) }),
  updateNode: (id: string, body: Partial<GNode>) =>
    j<GNode>(`/nodes/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteNode: (id: string) => j(`/nodes/${id}`, { method: "DELETE" }),

  createEdge: (pid: string, body: Partial<GEdge>) =>
    j<GEdge>(`/projects/${pid}/edges`, { method: "POST", body: JSON.stringify(body) }),
  updateEdge: (id: string, body: Partial<GEdge>) =>
    j<GEdge>(`/edges/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteEdge: (id: string) => j(`/edges/${id}`, { method: "DELETE" }),

  createCharacter: (pid: string, body: Partial<Character>) =>
    j<Character>(`/projects/${pid}/characters`, { method: "POST", body: JSON.stringify(body) }),

  generateNode: (id: string, n: number, params = {}) =>
    j<Job>(`/nodes/${id}/generate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  generateEdge: (id: string, n: number, params = {}) =>
    j<Job>(`/edges/${id}/generate`, { method: "POST", body: JSON.stringify({ n, params }) }),
  job: (id: string) => j<Job>(`/jobs/${id}`),

  assets: (ownerType: "node" | "edge", id: string) =>
    j<Asset[]>(`/${ownerType}/${id}/assets`),
  triage: (id: string, status: Asset["status"]) =>
    j<Asset>(`/assets/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  selectNodeAsset: (nid: string, aid: string) =>
    j<GNode>(`/nodes/${nid}/select/${aid}`, { method: "POST" }),
  selectEdgeAsset: (eid: string, aid: string) =>
    j<GEdge>(`/edges/${eid}/select/${aid}`, { method: "POST" }),
  upscale: (aid: string, scale = 2) =>
    j<Job>(`/assets/${aid}/upscale`, { method: "POST", body: JSON.stringify({ params: { scale } }) }),
  score: (aid: string) => j<Asset>(`/assets/${aid}/score`, { method: "POST" }),

  expand: (brief: string, context = "") =>
    j<{ prompt: string }>("/llm/expand", { method: "POST", body: JSON.stringify({ brief, context }) }),
};
