/* ============================================================
   Pure graph helpers (headless, framework-agnostic, testable).
   Ported from anna's frame_graph_player, parameterized over the
   graph instead of importing a fixed scene.
   ============================================================ */
import type { EdgeType, EngineEdge, EngineGraph } from "./types";

export const edgesFrom = (
  g: EngineGraph,
  node: string,
  type?: EdgeType,
): EngineEdge[] => g.edges.filter((e) => e.from === node && (!type || e.type === type));

/** Weighted-random pick; null when there are no candidates. */
export function pickWeighted(edges: EngineEdge[]): EngineEdge | null {
  if (edges.length === 0) return null;
  const total = edges.reduce((s, e) => s + (e.weight || 1), 0);
  let r = Math.random() * total;
  for (const e of edges) {
    r -= e.weight || 1;
    if (r <= 0) return e;
  }
  return edges[edges.length - 1];
}

/** Shortest-path next-hop table over idle edges:
    NEXT_HOP[from][target] = the idle edge to take next. */
export type NextHop = Record<string, Record<string, EngineEdge>>;

export function buildNextHop(g: EngineGraph): NextHop {
  const idle = g.edges.filter((e) => e.type === "idle");
  const table: NextHop = {};
  for (const target of Object.keys(g.nodes)) {
    const dist: Record<string, number> = { [target]: 0 };
    const q: string[] = [target];
    while (q.length) {
      const n = q.shift()!;
      for (const e of idle) {
        if (e.to === n && dist[e.from] === undefined) {
          dist[e.from] = dist[n] + 1;
          q.push(e.from);
        }
      }
    }
    for (const from of Object.keys(g.nodes)) {
      if (from === target) continue;
      const best = idle
        .filter((e) => e.from === from && dist[e.to] === dist[from] - 1)
        .sort((x, y) => (y.weight || 1) - (x.weight || 1))[0];
      if (best) (table[from] = table[from] || {})[target] = best;
    }
  }
  return table;
}

export interface Choice {
  edge: EngineEdge;
  kind: "idle" | "interaction" | "route";
  /** Index into the queue to consume (interaction edges only). */
  consumeIdx?: number;
}

/** The advance decision (pure): given the current node + the pending
    interaction queue, pick the next edge to traverse. Null = dead end. */
export function chooseNext(
  g: EngineGraph,
  nextHop: NextHop,
  node: string,
  queue: EngineEdge[],
): Choice | null {
  // 1. a queued interaction is available right here → play it
  const qi = queue.findIndex((e) => e.from === node);
  if (qi >= 0) return { edge: queue[qi], kind: "interaction", consumeIdx: qi };

  // 2. walk the shortest idle path toward the head interaction's from-node
  if (queue.length > 0) {
    const hop = nextHop[node]?.[queue[0].from];
    const edge = hop || pickWeighted(edgesFrom(g, node, "idle"));
    if (edge) return { edge, kind: "route" };
  }

  // 3. weighted-random idle
  const edge = pickWeighted(edgesFrom(g, node, "idle"));
  if (edge) return { edge, kind: "idle" };

  return null;
}
