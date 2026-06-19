/* Unified scene graph — one renderer, two modes.

   mode="editor"  → interactive: drag nodes, drag-connect edges, click to select,
                    double-click empty canvas to add a node at the cursor.
   mode="player"  → read-only live map: the active edge is highlighted and a dot
                    rides along it by `progress` (0..1); other edges dim. Reuses
                    the exact node layout (x/y) authored in the editor.

   Self-loops render as real loop arcs sitting ABOVE the node card (never behind
   it); multiple loops on one node stack into taller/wider tiers. */
import { useCallback, useEffect, useRef, useState } from "react";
import ReactFlow, {
  Background, BaseEdge, Controls, EdgeLabelRenderer, Handle, MarkerType, Position,
  ReactFlowProvider, getSmoothStepPath, useEdgesState, useNodesState, useReactFlow,
  useStore as useRFStore,
  type Connection, type Edge, type EdgeProps, type Node, type NodeProps,
} from "reactflow";
import { api, fileUrl } from "./api";
import { dialog } from "./dialogs";
import { useStore } from "./store";
import type { GEdge, GNode } from "./types";

const LOOP = "#f0a64a";
const FLOW = "#6ea8ff";

/* ---------- custom node: keyframe thumbnail (whole image, not cropped) ------ */
function KeyframeNode({ data, selected }: NodeProps) {
  const n: GNode = data.node;
  const ready = !!n.selected_asset_id;
  return (
    <div className={`gnode ${selected ? "sel" : ""} ${data.active ? "active" : ""}`}>
      <Handle type="target" position={Position.Left} />
      <div className="gbadges">
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
): Node[] {
  return (graph?.nodes || []).map((n) => ({
    id: n.id,
    type: "keyframe",
    position: { x: n.x, y: n.y },
    data: { node: n, active: isPlayer && n.id === activeNodeId },
    selected: !isPlayer && selection?.type === "node" && selection.id === n.id,
    draggable: !isPlayer,
  }));
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
    return {
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      type: "graph",
      data: {
        isLoop,
        loopIndex,
        label: `${isLoop ? "↻ " : ""}${e.label || e.kind}`,
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
  const didFit = useRef(false);

  // Rebuild from the store on data/selection/active changes. onNodesChange (from
  // useNodesState) handles live drag; this just re-asserts authoritative state.
  useEffect(() => {
    setNodes(buildNodes(graph, selection, isPlayer, activeNodeId));
  }, [graph, selection, isPlayer, activeNodeId, setNodes]);

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
    <div style={{ width: "100%", height: "100%" }} onDoubleClick={onDoubleClick}>
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
