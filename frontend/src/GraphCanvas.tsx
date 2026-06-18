import { useCallback, useMemo } from "react";
import ReactFlow, {
  Background, Controls, MarkerType, type Connection, type Edge, type Node,
  type NodeProps, Handle, Position,
} from "reactflow";
import { api, fileUrl } from "./api";
import { useStore } from "./store";
import type { GEdge, GNode } from "./types";

/** Custom node: thumbnail of the selected keyframe + key label. */
function KeyframeNode({ data, selected }: NodeProps) {
  const n: GNode = data.node;
  return (
    <div className={`gnode ${selected ? "sel" : ""}`}>
      <Handle type="target" position={Position.Left} />
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

const nodeTypes = { keyframe: KeyframeNode };

export default function GraphCanvas() {
  const { graph, selection, select, refresh, graphId } = useStore();

  const rfNodes: Node[] = useMemo(
    () =>
      (graph?.nodes || []).map((n) => ({
        id: n.id,
        type: "keyframe",
        position: { x: n.x, y: n.y },
        data: { node: n },
        selected: selection?.type === "node" && selection.id === n.id,
      })),
    [graph, selection],
  );

  const rfEdges: Edge[] = useMemo(
    () =>
      (graph?.edges || []).map((e: GEdge) => ({
        id: e.id,
        source: e.source_node_id,
        target: e.target_node_id,
        label: `${e.kind === "loop" ? "↻ " : ""}${e.label || e.kind}`,
        animated: !!e.selected_asset_id,
        style: { stroke: e.kind === "loop" ? "#f0a64a" : "#6ea8ff", strokeWidth: 2 },
        labelStyle: { fill: "#e6e8ee", fontSize: 11 },
        labelBgStyle: { fill: "#1c1f29" },
        markerEnd: { type: MarkerType.ArrowClosed },
        selected: selection?.type === "edge" && selection.id === e.id,
      })),
    [graph, selection],
  );

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

  const onNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      api.updateNode(node.id, { x: node.position.x, y: node.position.y });
    },
    [],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      onConnect={onConnect}
      onNodeDragStop={onNodeDragStop}
      onNodeClick={(_, n) => select({ type: "node", id: n.id })}
      onEdgeClick={(_, e) => select({ type: "edge", id: e.id })}
      onPaneClick={() => select(null)}
      fitView
    >
      <Background color="#2a2f3d" gap={20} />
      <Controls />
    </ReactFlow>
  );
}
