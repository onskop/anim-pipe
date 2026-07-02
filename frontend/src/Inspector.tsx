/* Right panel = a light summary + quick actions. The heavy lifting (prompt,
   generation, variant management) lives in the editor modal, opened with
   "Edit & generate". Characters are edited from the left library, not here —
   the node only *assigns* one. */
import { useCallback, useEffect, useState } from "react";
import { api, fileUrl } from "./api";
import CharacterEditor from "./CharacterEditor";
import { dialog } from "./dialogs";
import { EdgeLogicEditor, VariablesPanel } from "./LogicEditor";
import MaskPainter from "./MaskPainter";
import { useStore } from "./store";
import type { Asset, GEdge, GNode, GameVar } from "./types";

export default function Inspector() {
  const { graph, selection, refresh, openTriage, select } = useStore();
  const [variants, setVariants] = useState<Asset[]>([]);
  const [maskOpen, setMaskOpen] = useState(false);
  const [maskPath, setMaskPath] = useState<string | null>(null);

  const node: GNode | undefined =
    selection?.type === "node" ? graph?.nodes.find((x) => x.id === selection.id) : undefined;
  const edge: GEdge | undefined =
    selection?.type === "edge" ? graph?.edges.find((x) => x.id === selection.id) : undefined;
  const selChar =
    selection?.type === "character" ? graph?.characters.find((c) => c.id === selection.id) : undefined;
  const nodeChar = node?.character_id
    ? graph?.characters.find((c) => c.id === node.character_id)
    : undefined;

  const loadVariants = useCallback(async () => {
    if (!selection || selection.type === "character") { setVariants([]); return; }
    try { setVariants(await api.assets(selection.type, selection.id)); }
    catch { setVariants([]); }
  }, [selection?.type, selection?.id]);

  useEffect(() => {
    loadVariants();
  }, [loadVariants, node?.selected_asset_id, edge?.selected_asset_id, node?.asset_count, edge?.asset_count]);

  useEffect(() => {
    setMaskPath(null);
    if (edge?.motion_mask_id) {
      api.asset(edge.motion_mask_id).then((a) => setMaskPath(a.path)).catch(() => {});
    }
  }, [edge?.id, edge?.motion_mask_id]);

  if (!graph) return <div className="inspector muted">No project loaded.</div>;

  // --- character library selection → definition editor ----------------------
  if (selChar) {
    const removeChar = async () => {
      const ok = await dialog.confirm({
        title: `Delete character “${selChar.name}”?`,
        message: "Nodes using it keep their images but lose the character link.",
        danger: true, confirmText: "Delete",
      });
      if (!ok) return;
      await api.deleteCharacter(selChar.id);
      select(null);
      await refresh();
      dialog.toast("Character deleted");
    };
    return (
      <div className="inspector">
        <h2>Character · definition</h2>
        <CharacterEditor character={selChar} projectId={graph.project.id} refresh={refresh} />
        <button className="danger" style={{ marginTop: 16 }} onClick={removeChar}>
          Delete character
        </button>
      </div>
    );
  }

  if (!node && !edge)
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <p className="muted">
          <strong>Double-click the canvas</strong> to add a node (keyframe), or click one to select
          it. Drag from a node's right handle to another node for a transition; drag back to itself
          for an idle loop. Select a node/edge, then <strong>Edit &amp; generate</strong> to make
          images.
        </p>
        <VariablesPanel graph={graph} refresh={refresh} />
      </div>
    );

  const selectedId = node?.selected_asset_id ?? edge?.selected_asset_id ?? null;
  const setActive = async (a: Asset) => {
    if (!selection || selection.type === "character") return;
    if (selection.type === "node") await api.selectNodeAsset(selection.id, a.id);
    else await api.selectEdgeAsset(selection.id, a.id);
    await refresh();
    await loadVariants();
  };

  const keptVariants = variants
    .filter((a) => a.status === "accepted" || a.status === "starred" || a.id === selectedId)
    .sort(
      (a, b) =>
        (b.id === selectedId ? 1 : 0) - (a.id === selectedId ? 1 : 0) ||
        (b.status === "starred" ? 1 : 0) - (a.status === "starred" ? 1 : 0),
    )
    .slice(0, 8);

  const srcNode = edge ? graph.nodes.find((nn) => nn.id === edge.source_node_id) : undefined;
  const srcImg = srcNode?.selected_path || srcNode?.selected_thumb || null;
  const count = node?.asset_count ?? edge?.asset_count ?? 0;

  const renameEdge = async () => {
    if (!edge) return;
    const name = await dialog.prompt({ title: "Rename edge", label: "Label", defaultValue: edge.label });
    if (name === null) return;
    await api.updateEdge(edge.id, { label: name });
    await refresh();
  };

  return (
    <div className="inspector">
      {node ? (
        <>
          <h2>Node · keyframe</h2>
          <div className="stack">
            <label className="muted">key (game id)</label>
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
            {nodeChar && (
              <button onClick={() => select({ type: "character", id: nodeChar.id })}>
                ✎ Edit “{nodeChar.name}” in library
              </button>
            )}
          </div>
        </>
      ) : (
        <>
          <h2>Edge · {edge!.kind === "loop" ? "idle loop ↻" : "transition →"}</h2>
          <div className="row">
            <input value={edge!.label || edge!.kind} readOnly style={{ flex: 1 }} />
            <button style={{ flex: "0 0 auto" }} onClick={renameEdge}>Rename</button>
          </div>

          <h2>Logic (gameplay)</h2>
          <EdgeLogicEditor
            edge={edge!}
            vars={(graph.project.meta?.variables as GameVar[] | undefined) ?? []}
            refresh={refresh}
          />

          <h2>Motion mask (cinemagraph)</h2>
          {srcImg ? (
            <>
              {maskPath && (
                <img src={fileUrl(maskPath)} alt="motion mask"
                  style={{ width: "100%", borderRadius: 6, marginBottom: 6, background: "#000" }} />
              )}
              <div className="row">
                <button onClick={() => setMaskOpen(true)}>
                  {edge!.motion_mask_id ? "Repaint mask" : "Paint motion mask"}
                </button>
                {edge!.motion_mask_id && (
                  <button className="danger"
                    onClick={async () => { await api.updateEdge(edge!.id, { motion_mask_id: null }); await refresh(); }}>
                    Remove
                  </button>
                )}
              </div>
              <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
                Limits where this clip animates — fed to the video generator.
              </div>
            </>
          ) : (
            <p className="muted">
              Generate the source keyframe (<strong>{srcNode?.title || srcNode?.key}</strong>) first
              to paint a mask over it.
            </p>
          )}
        </>
      )}

      <h2>Resources · {count}</h2>
      {keptVariants.length > 0 ? (
        <div className="variants">
          {keptVariants.map((a) => (
            <button
              key={a.id}
              className={`variant ${a.id === selectedId ? "active" : ""}`}
              onClick={() => setActive(a)}
              title={a.id === selectedId ? "active keyframe/clip" : "click to make active"}
            >
              {a.kind === "video" && a.path.endsWith(".mp4") ? (
                <video src={fileUrl(a.path)} muted playsInline />
              ) : (
                <img src={fileUrl(a.thumb_path || a.path)} alt={a.role} />
              )}
              {a.status === "starred" && <span className="vstar">★</span>}
              {a.id === selectedId && <span className="vbadge">active</span>}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted" style={{ fontSize: 12 }}>
          {count > 0 ? "Candidates waiting in the editor." : "Nothing generated yet."}
        </p>
      )}

      <button className="primary" style={{ marginTop: 12, width: "100%" }} onClick={() => openTriage(selection)}>
        ✎ Edit &amp; generate…
      </button>

      <button
        className="danger"
        style={{ marginTop: 16 }}
        onClick={() =>
          (node ? api.deleteNode(node.id) : api.deleteEdge(edge!.id))
            .then(() => select(null))
            .then(refresh)
        }
      >
        Delete {node ? "node" : "edge"}
      </button>

      {maskOpen && edge && srcImg && (
        <MaskPainter
          srcUrl={fileUrl(srcImg)}
          projectId={graph.project.id}
          edgeId={edge.id}
          onClose={() => setMaskOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
