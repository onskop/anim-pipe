/* ============================================================
   PLAYER ENGINE — graph types (ported from anna, generalized)
   ------------------------------------------------------------
   nodes = canonical keyframes (a selected still image)
   edges = clips between them. An edge plays its `clip` when one
           is selected; otherwise the stage falls back to the
           destination node's still. The engine itself is
           headless — it only decides which edge to traverse
           next. Timing/rendering lives in the stage.

   Phase 0: every editor edge maps to an `idle` edge, so the
   walker roams the graph. `interaction`/`auto` + triggers,
   weights, guards and effects arrive in later phases — the
   shape is already here so they light up without an engine
   rewrite.
   ============================================================ */

import type { Clause, Effect, VarValue } from "../types";

export type EdgeType = "idle" | "interaction" | "auto";

export interface EngineNode {
  id: string;
  label: string;
  /** Selected keyframe still (file path under /api/files), or null. */
  image: string | null;
}

export interface EngineEdge {
  id: string;
  from: string;
  to: string;
  type: EdgeType;
  /** For interaction edges: the button/event name that queues it. */
  trigger: string | null;
  /** Idle-scheduler weight (defaults to 1). */
  weight: number;
  /** Guard: AND of clauses over the variable bag; empty = always available. */
  condition: Clause[];
  /** Applied to the variable bag when the edge finishes traversing. */
  effects: Effect[];
  /** Traversable only once per run. */
  once: boolean;
  /** Selected clip (file path), or null → stage uses the still fallback. */
  clip: string | null;
  /** Asset kind of the clip: "video" (mp4/webm) | "image" (gif/still) | null. */
  clipKind: string | null;
  label: string;
}

export interface EngineGraph {
  nodes: Record<string, EngineNode>;
  edges: EngineEdge[];
  /** Entry node for the walker; null when the graph has no nodes. */
  start: string | null;
  /** Variable defaults (from the project's declared variables). */
  variables: Record<string, VarValue>;
}

export type EngineEventKind =
  | "idle"
  | "interaction"
  | "auto"
  | "route"
  | "queued"
  | "hold";

export interface EngineEvent {
  kind: EngineEventKind;
  edge?: string;
  node: string;
}

/** Snapshot the stage/HUD render from. */
export interface Traversal {
  node: string | null;
  edge: EngineEdge | null;
  queueIds: string[];
  vars: Record<string, VarValue>;
  usedIds: string[];
}
