/* ============================================================
   Map the editor's Graph (from the backend) into the headless
   EngineGraph the walker/stage consume.

   Phase 0: every editor edge becomes an `idle` edge so the
   walker roams and we can watch whatever clips exist. Triggers
   / weights / guards / effects are added to the editor model
   in later phases and will flow through here.
   ============================================================ */
import type { Graph } from "../types";
import type { EngineEdge, EngineGraph, EngineNode } from "./types";

export function graphToEngine(graph: Graph): EngineGraph {
  const nodes: Record<string, EngineNode> = {};
  for (const n of graph.nodes) {
    nodes[n.id] = {
      id: n.id,
      label: n.title || n.key,
      image: n.selected_path || n.selected_thumb || null,
    };
  }

  const edges: EngineEdge[] = graph.edges
    // drop edges whose endpoints are missing (defensive)
    .filter((e) => nodes[e.source_node_id] && nodes[e.target_node_id])
    .map((e) => ({
      id: e.id,
      from: e.source_node_id,
      to: e.target_node_id,
      type: "idle",
      trigger: null,
      weight: 1,
      clip: e.selected_path || null,
      clipKind: e.selected_kind || null,
      label: e.label || e.kind,
    }));

  const start = graph.nodes[0]?.id ?? null;
  return { nodes, edges, start };
}
