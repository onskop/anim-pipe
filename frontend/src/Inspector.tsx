import { useEffect, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import type { GEdge, GNode, Job } from "./types";

async function pollJob(id: string, onDone: () => void) {
  const tick = async () => {
    const j: Job = await api.job(id);
    if (j.status === "done" || j.status === "error") return onDone();
    setTimeout(tick, 600);
  };
  setTimeout(tick, 600);
}

export default function Inspector() {
  const { graph, selection, refresh, openTriage } = useStore();
  const [n, setN] = useState(4);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");

  const node: GNode | undefined =
    selection?.type === "node" ? graph?.nodes.find((x) => x.id === selection.id) : undefined;
  const edge: GEdge | undefined =
    selection?.type === "edge" ? graph?.edges.find((x) => x.id === selection.id) : undefined;

  useEffect(() => {
    setDraft(node?.prompt ?? edge?.prompt ?? "");
  }, [selection?.id]);

  if (!graph) return <div className="inspector muted">No project loaded.</div>;
  if (!node && !edge)
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <p className="muted">
          Select a node (keyframe) or edge (clip). Drag from a node's right handle to
          another node to create a transition; drag back to itself for an idle loop.
        </p>
      </div>
    );

  const savePrompt = async () => {
    if (node) await api.updateNode(node.id, { prompt: draft });
    if (edge) await api.updateEdge(edge.id, { prompt: draft });
    await refresh();
  };

  const generate = async () => {
    setBusy(true);
    const job = node
      ? await api.generateNode(node.id, n)
      : await api.generateEdge(edge!.id, n);
    pollJob(job.id, async () => {
      setBusy(false);
      await refresh();
      openTriage(selection);
    });
  };

  return (
    <div className="inspector">
      {node ? (
        <>
          <h2>Node · keyframe</h2>
          <div className="stack">
            <label className="muted">key</label>
            <input value={node.key} onChange={(e) => api.updateNode(node.id, { key: e.target.value }).then(refresh)} />
            <label className="muted">character</label>
            <select
              value={node.character_id ?? ""}
              onChange={(e) => api.updateNode(node.id, { character_id: e.target.value || null }).then(refresh)}
            >
              <option value="">— none —</option>
              {graph.characters.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </>
      ) : (
        <>
          <h2>Edge · {edge!.kind === "loop" ? "idle loop ↻" : "transition →"}</h2>
          <p className="muted">
            {edge!.kind === "loop"
              ? "Seamless loop: start frame = end frame (breathing/scratching)."
              : "First→last frame clip between the two keyframes."}
          </p>
        </>
      )}

      <h2>Prompt</h2>
      <textarea rows={4} value={draft} onChange={(e) => setDraft(e.target.value)} />
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={savePrompt}>Save</button>
        <button
          onClick={async () => {
            const { prompt } = await api.expand(draft, node?.key || edge?.kind || "");
            setDraft(prompt);
          }}
        >
          ✨ Expand (LLM)
        </button>
      </div>

      <h2>Generate candidates</h2>
      <div className="row">
        <label className="muted" style={{ flex: 0.5 }}>count</label>
        <input type="number" min={1} max={16} value={n} onChange={(e) => setN(+e.target.value)} />
      </div>
      <div className="stack" style={{ marginTop: 8 }}>
        <button className="primary" disabled={busy} onClick={generate}>
          {busy ? "Generating…" : `Generate ${n}`}
        </button>
        <button onClick={() => openTriage(selection)}>Open triage gallery</button>
      </div>

      {node && (
        <button
          className="danger"
          style={{ marginTop: 16 }}
          onClick={() => api.deleteNode(node.id).then(() => useStore.getState().select(null)).then(refresh)}
        >
          Delete node
        </button>
      )}
      {edge && (
        <button
          className="danger"
          style={{ marginTop: 16 }}
          onClick={() => api.deleteEdge(edge.id).then(() => useStore.getState().select(null)).then(refresh)}
        >
          Delete edge
        </button>
      )}
    </div>
  );
}
