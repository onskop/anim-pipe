import { create } from "zustand";
import { api } from "./api";
import type { Graph, GraphInfo, Project } from "./types";

type Selection = { type: "node" | "edge" | "character"; id: string } | null;

interface State {
  projects: Project[];
  projectId: string | null;
  graphId: string | null;
  graphs: GraphInfo[];
  graph: Graph | null; // contents of the active graph
  selection: Selection;
  triage: Selection; // which owner's candidates the gallery shows
  loadProjects: () => Promise<void>;
  setProject: (id: string) => Promise<void>;
  setGraph: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  select: (sel: Selection) => void;
  openTriage: (sel: Selection) => void;
}

export const useStore = create<State>((set, get) => ({
  projects: [],
  projectId: null,
  graphId: null,
  graphs: [],
  graph: null,
  selection: null,
  triage: null,
  loadProjects: async () => set({ projects: await api.listProjects() }),
  setProject: async (id) => {
    set({ projectId: id, graphId: null, graph: null, graphs: [], selection: null, triage: null });
    const graphs = await api.graphs(id);
    set({ graphs });
    const first = graphs[0]?.id;
    if (first) await get().setGraph(first);
  },
  setGraph: async (gid) => {
    set({ graphId: gid, selection: null, triage: null });
    set({ graph: await api.graphContents(gid) });
  },
  refresh: async () => {
    const { projectId, graphId } = get();
    if (projectId) set({ graphs: await api.graphs(projectId) });
    if (graphId) set({ graph: await api.graphContents(graphId) });
  },
  select: (sel) => set({ selection: sel }),
  openTriage: (sel) => set({ triage: sel }),
}));
