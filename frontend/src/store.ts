import { create } from "zustand";
import { api } from "./api";
import type { Graph } from "./types";

type Selection = { type: "node" | "edge"; id: string } | null;

interface State {
  projectId: string | null;
  graph: Graph | null;
  selection: Selection;
  triage: Selection; // which owner's candidates the gallery shows
  setProject: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  select: (sel: Selection) => void;
  openTriage: (sel: Selection) => void;
}

export const useStore = create<State>((set, get) => ({
  projectId: null,
  graph: null,
  selection: null,
  triage: null,
  setProject: async (id) => {
    set({ projectId: id, selection: null, triage: null });
    await get().refresh();
  },
  refresh: async () => {
    const pid = get().projectId;
    if (!pid) return;
    set({ graph: await api.graph(pid) });
  },
  select: (sel) => set({ selection: sel }),
  openTriage: (sel) => set({ triage: sel }),
}));
