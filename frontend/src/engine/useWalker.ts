/* ============================================================
   useWalker — React binding around the headless graph engine.

   The hook owns *what* edge is traversed next (the graph
   decision); the stage owns *when* to advance (a clip ending
   or a still hold elapsing) and calls advance(). This split
   keeps the engine framework-agnostic and lets real clips drive
   their own natural length.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildNextHop, chooseNext } from "./graph";
import type { EngineEdge, EngineEvent, EngineGraph, Traversal } from "./types";

interface WalkerState {
  node: string | null;
  edge: EngineEdge | null;
  queue: EngineEdge[];
}

export function useWalker(graph: EngineGraph, onEvent?: (e: EngineEvent) => void) {
  const nextHop = useMemo(() => buildNextHop(graph), [graph]);
  const ref = useRef<WalkerState>({ node: graph.start, edge: null, queue: [] });
  const [snap, setSnap] = useState<Traversal>({
    node: graph.start,
    edge: null,
    queueIds: [],
  });

  const sync = useCallback(() => {
    const s = ref.current;
    setSnap({ node: s.node, edge: s.edge, queueIds: s.queue.map((q) => q.id) });
  }, []);

  /** Arrive at the current edge's destination and pick the next edge. */
  const advance = useCallback(() => {
    const s = ref.current;
    if (s.edge) s.node = s.edge.to;
    if (!s.node) return;
    const choice = chooseNext(graph, nextHop, s.node, s.queue);
    if (!choice) {
      // dead end: hold on the current node still
      s.edge = null;
      onEvent?.({ kind: "hold", node: s.node });
      sync();
      return;
    }
    if (choice.kind === "interaction" && choice.consumeIdx !== undefined) {
      s.queue.splice(choice.consumeIdx, 1);
    }
    s.edge = choice.edge;
    onEvent?.({ kind: choice.kind, edge: choice.edge.id, node: s.node });
    sync();
  }, [graph, nextHop, onEvent, sync]);

  /** Queue an interaction edge by its trigger name (manual progression). */
  const trigger = useCallback(
    (name: string) => {
      const s = ref.current;
      const edge = graph.edges.find((e) => e.type === "interaction" && e.trigger === name);
      if (!edge || s.queue.some((q) => q.id === edge.id)) return;
      s.queue.push(edge);
      onEvent?.({ kind: "queued", edge: edge.id, node: s.node ?? "" });
      sync();
    },
    [graph, onEvent, sync],
  );

  // (Re)start whenever the graph identity changes, then kick off the first edge.
  useEffect(() => {
    ref.current = { node: graph.start, edge: null, queue: [] };
    sync();
    advance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  return { snap, advance, trigger };
}
