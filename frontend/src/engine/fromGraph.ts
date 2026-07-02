/* ============================================================
   Map the editor's Graph (from the backend) into the headless
   EngineGraph the walker/stage consume.

   Edges carry their gameplay logic in params.logic (declarative:
   type / trigger / weight / condition / effects / once); an edge
   without logic is a plain ambient `idle` edge, so a fresh graph
   roams exactly like Phase 0. Variables come from the project's
   declared bag; the walker starts from the scene's start node.
   ============================================================ */
import type { EdgeLogic, GameVar, Graph, VarValue } from "../types";
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
    .map((e) => {
      const logic = (e.params?.logic ?? {}) as EdgeLogic;
      const type =
        logic.type === "choice" ? "interaction" : logic.type === "auto" ? "auto" : "idle";
      return {
        id: e.id,
        from: e.source_node_id,
        to: e.target_node_id,
        type,
        trigger: type === "interaction" ? logic.trigger || e.label || e.kind : null,
        weight: logic.weight ?? 1,
        condition: logic.condition ?? [],
        effects: logic.effects ?? [],
        once: !!logic.once,
        clip: e.selected_path || null,
        clipKind: e.selected_kind || null,
        label: e.label || e.kind,
      } satisfies EngineEdge;
    });

  const declared = (graph.project.meta?.variables as GameVar[] | undefined) ?? [];
  const variables: Record<string, VarValue> = Object.fromEntries(
    declared.map((v) => [v.name, v.default]),
  );

  const startId = graph.graph.start_node_id;
  const start = startId && nodes[startId] ? startId : graph.nodes[0]?.id ?? null;
  return { nodes, edges, start, variables };
}
