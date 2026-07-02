/* ============================================================
   useWalker — React binding around the headless graph engine.

   The hook owns *what* edge is traversed next (the graph
   decision); the stage owns *when* to advance (a clip ending
   or a still hold elapsing) and calls advance(). This split
   keeps the engine framework-agnostic and lets real clips drive
   their own natural length.

   Phase 3: the walker also owns the run state — the variable
   bag (effects apply when an edge finishes), the once-set, and
   choice availability. setVar() is the debug hook; reset()
   restarts the run from the start node with default variables.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { VarValue } from "../types";
import { applyEffects, buildNextHop, chooseNext, edgeAvailable } from "./graph";
import type { EngineEdge, EngineEvent, EngineGraph, Traversal } from "./types";

interface WalkerState {
  node: string | null;
  edge: EngineEdge | null;
  queue: EngineEdge[];
  vars: Record<string, VarValue>;
  used: Set<string>;
}

const freshState = (graph: EngineGraph): WalkerState => ({
  node: graph.start,
  edge: null,
  queue: [],
  vars: { ...graph.variables },
  used: new Set(),
});

export function useWalker(graph: EngineGraph, onEvent?: (e: EngineEvent) => void) {
  const nextHop = useMemo(() => buildNextHop(graph), [graph]);
  const ref = useRef<WalkerState>(freshState(graph));
  const [snap, setSnap] = useState<Traversal>({
    node: graph.start,
    edge: null,
    queueIds: [],
    vars: { ...graph.variables },
    usedIds: [],
  });

  const sync = useCallback(() => {
    const s = ref.current;
    setSnap({
      node: s.node,
      edge: s.edge,
      queueIds: s.queue.map((q) => q.id),
      vars: { ...s.vars },
      usedIds: [...s.used],
    });
  }, []);

  /** Arrive at the current edge's destination, apply its effects, pick next. */
  const advance = useCallback(() => {
    const s = ref.current;
    if (s.edge) {
      s.node = s.edge.to;
      s.vars = applyEffects(s.edge.effects, s.vars);
      if (s.edge.once) s.used.add(s.edge.id);
    }
    if (!s.node) return;
    // Drop queued interactions at this node that are no longer available
    // (their condition lapsed or they were consumed elsewhere).
    const here = s.node;
    s.queue = s.queue.filter((e) => e.from !== here || edgeAvailable(e, s.vars, s.used));
    const choice = chooseNext(graph, nextHop, s.node, s.queue, s.vars, s.used);
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

  /** Queue an interaction edge by its trigger name (player choice). */
  const trigger = useCallback(
    (name: string) => {
      const s = ref.current;
      const edge = graph.edges.find(
        (e) => e.type === "interaction" && e.trigger === name && edgeAvailable(e, s.vars, s.used),
      );
      if (!edge || s.queue.some((q) => q.id === edge.id)) return;
      s.queue.push(edge);
      onEvent?.({ kind: "queued", edge: edge.id, node: s.node ?? "" });
      sync();
      // If the walker is holding on a dead end (no active edge), a new choice
      // must wake it — nothing else will call advance().
      if (!s.edge) advance();
    },
    [graph, onEvent, sync, advance],
  );

  /** Debug: poke a variable live (the HUD's editable bag). */
  const setVar = useCallback(
    (name: string, value: VarValue) => {
      ref.current.vars = { ...ref.current.vars, [name]: value };
      sync();
    },
    [sync],
  );

  /** Restart the run: start node, default variables, empty queue/once-set. */
  const reset = useCallback(() => {
    ref.current = freshState(graph);
    sync();
    advance();
  }, [graph, sync, advance]);

  // (Re)start whenever the graph identity changes, then kick off the first edge.
  useEffect(() => {
    reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph]);

  return { snap, advance, trigger, setVar, reset };
}
