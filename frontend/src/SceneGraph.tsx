/* Unified scene graph — one renderer, two modes.

   mode="editor"  → interactive: drag nodes, drag-connect edges, click to select,
                    double-click empty canvas to add a node at the cursor.
   mode="player"  → read-only live map: the active edge is highlighted and a dot
                    rides along it by `progress` (0..1); other edges dim. Reuses
                    the exact node layout (x/y) authored in the editor.

   Self-loops render as real loop arcs sitting ABOVE the node card (never behind
   it); multiple loops on one node stack into taller/wider tiers. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, MiniMap,
  Position, ReactFlowProvider, getSmoothStepPath, useEdgesState, useNodesState,
  useReactFlow, useStore as useRFStore,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from "reactflow";
import { api, fileUrl } from "./api";
import { dialog } from "./dialogs";
import { useStore } from "./store";
import type { EdgeLogic, GEdge, GNode, Graph } from "./types";

const LOOP = "#f0a64a";
const FLOW = "#6ea8ff";

/* ---------- custom node: keyframe thumbnail (whole image, not cropped) ------ */
function KeyframeNode({ data, selected }: NodeProps) {
  const n: GNode = data.node;
  const ready = !!n.selected_asset_id;
  const issue = data.issueLevel ? ` issue-${data.issueLevel}` : "";
  return (
    <div className={`gnode ${selected ? "sel" : ""} ${data.active ? "active" : ""}${issue}`}>
      <Handle type="target" position={Position.Left} />
      <div className="gbadges">
        {data.isStart && <span className="gbadge start" title="scene start">⚑</span>}
        {n.asset_count > 0 && <span className="gbadge" title="resources">▦ {n.asset_count}</span>}
        <span
          className={`gstatus ${ready ? "ok" : "todo"}`}
          title={ready ? "keyframe selected" : "no keyframe yet"}
        >
          {ready ? "✓" : "!"}
        </span>
      </div>
      {n.selected_thumb ? (
        <img className="thumb" src={fileUrl(n.selected_thumb)} alt={n.key} />
      ) : (
        <div className="thumb empty">no keyframe</div>
      )}
      <div className="label">{n.title || n.key}</div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

/* ---------- progress marker: a dot at fraction t along the edge path -------- */
function ProgressDot({ path, t, color }: { path: string; t: number; color: string }) {
  const ref = useRef<SVGPathElement>(null);
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const len = el.getTotalLength();
    const p = el.getPointAtLength(len * Math.min(1, Math.max(0, t)));
    setPt({ x: p.x, y: p.y });
  }, [path, t]);
  return (
    <>
      <path ref={ref} d={path} fill="none" stroke="none" />
      {pt && <circle cx={pt.x} cy={pt.y} r={5.5} fill={color} stroke="#0b1220" strokeWidth={1.5} />}
    </>
  );
}

/* ---------- custom edge: transition (smoothstep) or real self-loop arc ------ */
function GraphEdge(props: EdgeProps) {
  const {
    id, source, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, data,
    selected,
  } = props;
  const isLoop = !!data?.isLoop;
  const active = !!data?.active;
  const dim = !!data?.dim;
  const interactive = !!data?.interactive;
  const color = isLoop ? LOOP : FLOW;
  const select = useStore((s) => s.select);
  const refresh = useStore((s) => s.refresh);

  // Live node geometry so loops anchor to the node TOP and follow it on drag.
  const srcNode = useRFStore((s) => s.nodeInternals.get(source));

  let path: string;
  let labelX: number;
  let labelY: number;
  if (isLoop) {
    const tier = (data?.loopIndex as number) ?? 0;
    const w = srcNode?.width ?? 150;
    const x = srcNode?.positionAbsolute?.x ?? Math.min(sourceX, targetX);
    const y = srcNode?.positionAbsolute?.y ?? sourceY - 64;
    const cx = x + w / 2;
    const topY = y; // node's top edge — the loop lives entirely above this
    const mouth = 16 + tier * 12; // gap between the two anchor points on the top edge
    const rise = 48 + tier * 40; // how high the arc rises; higher tiers stack well clear
    const bulge = 60 + tier * 24; // how wide it bows out
    const apexY = topY - rise;
    path = `M ${cx - mouth},${topY} C ${cx - bulge},${apexY} ${cx + bulge},${apexY} ${cx + mouth},${topY}`;
    labelX = cx;
    labelY = apexY - 10;
  } else {
    const [p, lx, ly] = getSmoothStepPath({
      sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, borderRadius: 14,
    });
    path = p;
    labelX = lx;
    labelY = ly;
  }

  const onLabelClick = (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    select({ type: "edge", id });
  };
  const onLabelDouble = async (e: React.MouseEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    const name = await dialog.prompt({
      title: "Rename edge", label: "Label", defaultValue: (data?.rawLabel as string) || "",
    });
    if (name === null) return;
    await api.updateEdge(id, { label: name });
    await refresh();
  };

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        interactionWidth={26}
        style={{
          stroke: color,
          strokeWidth: active || selected ? 3 : 2,
          opacity: dim ? 0.28 : 1,
          ...(data?.isAuto ? { strokeDasharray: "7 5" } : {}),
          ...(active ? { filter: `drop-shadow(0 0 4px ${color})` } : {}),
        }}
      />
      {active && <ProgressDot path={path} t={(data?.progress as number) ?? 0} color={color} />}
      <EdgeLabelRenderer>
        <div
          className={`edgeLabel ${isLoop ? "loop" : ""} ${active ? "active" : ""} ${selected ? "sel" : ""} ${interactive ? "clickable" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            opacity: dim ? 0.4 : 1,
          }}
          onClick={onLabelClick}
          onDoubleClick={onLabelDouble}
          title={interactive ? "click to select · double-click to rename" : undefined}
        >
          {data?.label as string}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

const nodeTypes = { keyframe: KeyframeNode };
const edgeTypes = { graph: GraphEdge };

export interface SceneGraphProps {
  mode: "editor" | "player";
  activeEdgeId?: string | null;
  activeNodeId?: string | null;
  progress?: number;
}

function buildNodes(
  graph: ReturnType<typeof useStore.getState>["graph"],
  selection: ReturnType<typeof useStore.getState>["selection"],
  isPlayer: boolean,
  activeNodeId: string | null | undefined,
  issueLevels?: Record<string, "error" | "warn">,
): Node[] {
  const startId = graph?.graph.start_node_id;
  return (graph?.nodes || []).map((n) => ({
    id: n.id,
    type: "keyframe",
    position: { x: n.x, y: n.y },
    data: {
      node: n,
      active: isPlayer && n.id === activeNodeId,
      isStart: n.id === startId,
      issueLevel: issueLevels?.[n.id],
    },
    selected: !isPlayer && selection?.type === "node" && selection.id === n.id,
    draggable: !isPlayer,
  }));
}

/* ---------- validation: the graph as a production checklist ---------------- */
interface Issue {
  level: "error" | "warn";
  text: string;
  sel: { type: "node" | "edge"; id: string } | null;
}

function computeIssues(g: Graph): Issue[] {
  const issues: Issue[] = [];
  for (const n of g.nodes) {
    if (!n.selected_asset_id) {
      issues.push({
        level: "error",
        text: `“${n.title || n.key}” has no keyframe locked`,
        sel: { type: "node", id: n.id },
      });
    }
  }
  for (const e of g.edges) {
    if (!e.selected_asset_id) {
      const src = g.nodes.find((n) => n.id === e.source_node_id);
      issues.push({
        level: "warn",
        text: `edge “${e.label || e.kind}” from “${src?.title || src?.key || "?"}” has no clip locked`,
        sel: { type: "edge", id: e.id },
      });
    }
  }
  if (g.nodes.length > 1) {
    // Dead ends: the walker holds forever on a node with no way out.
    for (const n of g.nodes) {
      if (!g.edges.some((e) => e.source_node_id === n.id)) {
        issues.push({
          level: "warn",
          text: `“${n.title || n.key}” is a dead end (no outgoing edges)`,
          sel: { type: "node", id: n.id },
        });
      }
    }
    // Reachability from the start node (transitions only; loops don't travel).
    const start = g.graph.start_node_id;
    if (!start) {
      issues.push({
        level: "warn",
        text: "no start node set — select a node and press ⚑ Start",
        sel: null,
      });
    } else {
      const seen = new Set<string>([start]);
      const q = [start];
      while (q.length) {
        const id = q.shift()!;
        for (const e of g.edges) {
          if (e.source_node_id === id && !seen.has(e.target_node_id)) {
            seen.add(e.target_node_id);
            q.push(e.target_node_id);
          }
        }
      }
      for (const n of g.nodes) {
        if (!seen.has(n.id)) {
          issues.push({
            level: "warn",
            text: `“${n.title || n.key}” is unreachable from the start node`,
            sel: { type: "node", id: n.id },
          });
        }
      }
    }
  }
  return issues;
}

function buildEdges(
  graph: ReturnType<typeof useStore.getState>["graph"],
  selection: ReturnType<typeof useStore.getState>["selection"],
  isPlayer: boolean,
  activeEdgeId: string | null | undefined,
  progress: number,
): Edge[] {
  const loopSeen: Record<string, number> = {};
  return (graph?.edges || []).map((e: GEdge) => {
    const isLoop = e.source_node_id === e.target_node_id || e.kind === "loop";
    let loopIndex = 0;
    if (isLoop) {
      loopIndex = loopSeen[e.source_node_id] ?? 0;
      loopSeen[e.source_node_id] = loopIndex + 1;
    }
    const active = isPlayer && e.id === activeEdgeId;
    const color = isLoop ? LOOP : FLOW;
    const logic = (e.params?.logic ?? {}) as EdgeLogic;
    const glyph =
      logic.type === "choice" ? "🔘 " : logic.type === "auto" ? "⚡ " : isLoop ? "↻ " : "";
    const gate = (logic.condition?.length ?? 0) > 0 ? " ‹if›" : "";
    return {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: "graph",
      data: {
        isLoop,
        loopIndex,
        isAuto: logic.type === "auto",
        label: `${glyph}${e.label || e.kind}${gate}`,
        rawLabel: e.label || e.kind,
        interactive: !isPlayer,
        active,
        progress: active ? progress : 0,
        dim: isPlayer && !!activeEdgeId && !active,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      animated: isPlayer ? active : !!e.selected_asset_id,
      selected: !isPlayer && selection?.type === "edge" && selection.id === e.id,
    };
  });
}

function SceneGraphInner({ mode, activeEdgeId, activeNodeId, progress = 0 }: SceneGraphProps) {
  const { graph, selection, select, refresh, graphId } = useStore();
  const isPlayer = mode === "player";
  const rf = useReactFlow();
  const [nodes, setNodes, onNodesChange] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [showIssues, setShowIssues] = useState(false);
  const didFit = useRef(false);

  const issues = useMemo(
    () => (graph && !isPlayer ? computeIssues(graph) : []),
    [graph, isPlayer],
  );
  const issueLevels = useMemo(() => {
    if (!showIssues) return undefined;
    const map: Record<string, "error" | "warn"> = {};
    for (const i of issues) {
      if (i.sel?.type !== "node") continue;
      if (map[i.sel.id] !== "error") map[i.sel.id] = i.level;
    }
    return map;
  }, [issues, showIssues]);

  // Rebuild from the store on data/selection/active changes. onNodesChange (from
  // useNodesState) handles live drag; this just re-asserts authoritative state.
  useEffect(() => {
    setNodes(buildNodes(graph, selection, isPlayer, activeNodeId, issueLevels));
  }, [graph, selection, isPlayer, activeNodeId, issueLevels, setNodes]);

  useEffect(() => {
    setEdges(buildEdges(graph, selection, isPlayer, activeEdgeId, progress));
  }, [graph, selection, isPlayer, activeEdgeId, progress, setEdges]);

  // Fit once when nodes first appear, and again when the scene changes.
  useEffect(() => { didFit.current = false; }, [graphId]);
  useEffect(() => {
    if (!didFit.current && nodes.length > 0) {
      didFit.current = true;
      setTimeout(() => rf.fitView({ padding: 0.2 }), 0);
    }
  }, [nodes, rf]);

  const onConnect = useCallback(
    async (c: Connection) => {
      if (!graphId || !c.source || !c.target) return;
      await api.createEdge(graphId, {
        source_node_id: c.source,
        target_node_id: c.target,
        kind: c.source === c.target ? "loop" : "transition",
      });
      await refresh();
    },
    [graphId, refresh],
  );

  // Persist a drag and keep the store in sync so re-renders don't snap it back.
  const onNodeDragStop = useCallback((_: unknown, node: Node) => {
    api.updateNode(node.id, { x: node.position.x, y: node.position.y });
    useStore.setState((st) =>
      st.graph
        ? {
            graph: {
              ...st.graph,
              nodes: st.graph.nodes.map((nn) =>
                nn.id === node.id ? { ...nn, x: node.position.x, y: node.position.y } : nn,
              ),
            },
          }
        : {},
    );
  }, []);

  // Double-click a node → rename its display title (mirrors edge rename).
  const onNodeDoubleClick = useCallback(
    async (_: React.MouseEvent, n: Node) => {
      if (isPlayer) return;
      const gn = n.data?.node as GNode | undefined;
      const name = await dialog.prompt({
        title: "Rename node",
        label: "Title (display name)",
        defaultValue: gn?.title || gn?.key || "",
      });
      if (name === null) return;
      await api.updateNode(n.id, { title: name });
      await refresh();
    },
    [isPlayer, refresh],
  );

  // Mark the selected node as the scene's entry point (player + validation).
  const setStart = useCallback(async () => {
    if (selection?.type !== "node" || !graphId) return;
    await api.renameGraph(graphId, { start_node_id: selection.id });
    await refresh();
    dialog.toast("Start node set ⚑", "success");
  }, [selection, graphId, refresh]);

  // Auto-layout: BFS layers from the start node (or in-degree-0 roots) become
  // columns; unreachable nodes land in a trailing column. Positions persist.
  const autoLayout = useCallback(async () => {
    if (!graph || graph.nodes.length === 0) return;
    const flow = graph.edges.filter((e) => e.source_node_id !== e.target_node_id);
    const indeg = new Map<string, number>(graph.nodes.map((n) => [n.id, 0]));
    for (const e of flow) indeg.set(e.target_node_id, (indeg.get(e.target_node_id) ?? 0) + 1);
    let roots = graph.graph.start_node_id
      ? [graph.graph.start_node_id]
      : graph.nodes.filter((n) => (indeg.get(n.id) ?? 0) === 0).map((n) => n.id);
    if (roots.length === 0) roots = [graph.nodes[0].id];

    const depth = new Map<string, number>();
    const q = [...roots];
    roots.forEach((r) => depth.set(r, 0));
    while (q.length) {
      const id = q.shift()!;
      for (const e of flow) {
        if (e.source_node_id === id && !depth.has(e.target_node_id)) {
          depth.set(e.target_node_id, (depth.get(id) ?? 0) + 1);
          q.push(e.target_node_id);
        }
      }
    }
    const maxDepth = Math.max(0, ...depth.values());
    for (const n of graph.nodes) if (!depth.has(n.id)) depth.set(n.id, maxDepth + 1);

    const rowInCol: Record<number, number> = {};
    await Promise.all(
      graph.nodes.map((n) => {
        const d = depth.get(n.id)!;
        const row = rowInCol[d] ?? 0;
        rowInCol[d] = row + 1;
        // generous row spacing so stacked self-loop arcs stay clear of neighbors
        return api.updateNode(n.id, { x: 80 + d * 250, y: 140 + row * 230 });
      }),
    );
    await refresh();
    setTimeout(() => rf.fitView({ padding: 0.2 }), 50);
  }, [graph, refresh, rf]);

  // Double-click empty canvas → create a node at the cursor (position for free).
  const onDoubleClick = useCallback(
    async (evt: React.MouseEvent) => {
      if (isPlayer || !graphId) return;
      const target = evt.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return; // only on empty canvas
      const pos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      const key = await dialog.prompt({
        title: "New node (keyframe)",
        label: "Node key — the stable game id",
        placeholder: "idle_campfire",
      });
      if (!key) return;
      await api.createNode(graphId, { key, title: key, x: pos.x, y: pos.y, prompt: key });
      await refresh();
    },
    [isPlayer, graphId, rf, refresh],
  );

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }} onDoubleClick={onDoubleClick}>
      {!isPlayer && graph && (
        <div className="canvasToolbar">
          <button onClick={() => rf.fitView({ padding: 0.2 })} title="Zoom to fit">⛶ Fit</button>
          <button onClick={autoLayout} title="Auto-layout (layered by story flow)">⚡ Layout</button>
          <button
            disabled={selection?.type !== "node"}
            onClick={setStart}
            title="Set the selected node as the scene start"
          >
            ⚑ Start
          </button>
          <button
            className={showIssues ? "on" : ""}
            onClick={() => setShowIssues((s) => !s)}
            title="Validation — missing keyframes/clips, dead ends, unreachable nodes"
          >
            {issues.length > 0 ? `⚠ ${issues.length}` : "✓ OK"}
          </button>
        </div>
      )}
      {!isPlayer && showIssues && (
        <div className="issuesPanel panel">
          <div className="plabel">Validation · {issues.length} issue{issues.length === 1 ? "" : "s"}</div>
          {issues.length === 0 && (
            <div className="muted">All good — every node has a keyframe and every edge a clip.</div>
          )}
          {issues.map((i, k) => (
            <div
              key={k}
              className={`issueRow ${i.level}`}
              onClick={() => i.sel && select(i.sel)}
              title={i.sel ? "click to select" : undefined}
            >
              {i.level === "error" ? "●" : "○"} {i.text}
            </div>
          ))}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onConnect={isPlayer ? undefined : onConnect}
        onNodeDragStop={isPlayer ? undefined : onNodeDragStop}
        onNodeClick={isPlayer ? undefined : (_, n) => select({ type: "node", id: n.id })}
        onNodeDoubleClick={isPlayer ? undefined : onNodeDoubleClick}
        onEdgeClick={isPlayer ? undefined : (_, e) => select({ type: "edge", id: e.id })}
        onPaneClick={isPlayer ? undefined : () => select(null)}
        nodesDraggable={!isPlayer}
        nodesConnectable={!isPlayer}
        elementsSelectable={!isPlayer}
        zoomOnDoubleClick={false}
        proOptions={{ hideAttribution: true }}
        fitView
      >
        <Background color="#2a2f3d" gap={20} />
        {!isPlayer && <Controls />}
        {!isPlayer && (
          <MiniMap
            pannable
            zoomable
            nodeColor={() => "#3a4152"}
            maskColor="rgba(12, 14, 19, 0.72)"
          />
        )}
      </ReactFlow>
    </div>
  );
}

export default function SceneGraph(props: SceneGraphProps) {
  return (
    <ReactFlowProvider>
      <div className={`rf-wrap ${props.mode === "player" ? "rf-player" : "rf-editor"}`}>
        <SceneGraphInner {...props} />
      </div>
    </ReactFlowProvider>
  );
}
