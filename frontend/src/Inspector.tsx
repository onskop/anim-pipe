import { useCallback, useEffect, useRef, useState } from "react";
import { api, fileUrl } from "./api";
import MaskPainter from "./MaskPainter";
import { useStore } from "./store";
import type { Asset, ComfyModels, GEdge, GNode, Job } from "./types";

async function pollJob(id: string, onDone: () => void) {
  const tick = async () => {
    const j: Job = await api.job(id);
    if (j.status === "done" || j.status === "error") return onDone();
    setTimeout(tick, 600);
  };
  setTimeout(tick, 600);
}

interface GenParams {
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: string;
}
const DEFAULT_PARAMS: GenParams = {
  checkpoint: "", width: 512, height: 512, steps: 20, cfg: 7, seed: "",
};

export default function Inspector() {
  const { graph, selection, refresh, openTriage } = useStore();
  const [n, setN] = useState(4);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [neg, setNeg] = useState("");
  const [savedFlag, setSavedFlag] = useState(false);
  const [charName, setCharName] = useState("");
  const [charDesc, setCharDesc] = useState("");
  const [charSaved, setCharSaved] = useState(false);
  // Consistency stack: LoRA + IP-Adapter reference images.
  const [loraName, setLoraName] = useState("");
  const [loraWeight, setLoraWeight] = useState(0.8);
  const [ipWeight, setIpWeight] = useState(0.6);
  const [refIds, setRefIds] = useState<string[]>([]);
  const [refThumbs, setRefThumbs] = useState<Record<string, string>>({});
  const [uploadingRef, setUploadingRef] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);
  const [comfy, setComfy] = useState<ComfyModels | null>(null);
  const [imageProvider, setImageProvider] = useState("mock");
  const [gp, setGp] = useState<GenParams>(DEFAULT_PARAMS);
  const [variants, setVariants] = useState<Asset[]>([]);
  const [maskOpen, setMaskOpen] = useState(false);
  const [maskPath, setMaskPath] = useState<string | null>(null);

  const node: GNode | undefined =
    selection?.type === "node" ? graph?.nodes.find((x) => x.id === selection.id) : undefined;
  const edge: GEdge | undefined =
    selection?.type === "edge" ? graph?.edges.find((x) => x.id === selection.id) : undefined;
  const character = node?.character_id
    ? graph?.characters.find((c) => c.id === node.character_id)
    : undefined;

  useEffect(() => {
    setDraft(node?.prompt ?? edge?.prompt ?? "");
    setNeg(node?.negative_prompt ?? "");
  }, [selection?.id]);

  useEffect(() => {
    setCharName(character?.name ?? "");
    setCharDesc(character?.description ?? "");
    setLoraName(character?.lora_name ?? "");
    setLoraWeight(character?.lora_weight ?? 0.8);
    setIpWeight(character?.ip_adapter_weight ?? 0.6);
    const ids = character?.ref_image_ids ?? [];
    setRefIds(ids);
    // Resolve each reference id to a thumbnail URL for preview.
    setRefThumbs({});
    ids.forEach((id) =>
      api.asset(id)
        .then((a) => setRefThumbs((m) => ({ ...m, [id]: fileUrl(a.thumb_path || a.path) })))
        .catch(() => {})
    );
  }, [character?.id]);

  // Refresh provider + ComfyUI model list when the panel is shown / selection changes.
  useEffect(() => {
    api.providers().then((p) => setImageProvider(p.image)).catch(() => {});
    api.comfyModels().then(setComfy).catch(() => setComfy(null));
  }, [selection?.id]);

  // Variants tray: all assets for the selected node/edge.
  const loadVariants = useCallback(async () => {
    if (!selection) { setVariants([]); return; }
    try { setVariants(await api.assets(selection.type, selection.id)); }
    catch { setVariants([]); }
  }, [selection?.type, selection?.id]);

  useEffect(() => {
    loadVariants();
    // reload when the active pick changes or after a generation refreshes the graph
  }, [loadVariants, node?.selected_asset_id, edge?.selected_asset_id]);

  // Resolve the current motion-mask asset for preview.
  useEffect(() => {
    setMaskPath(null);
    if (edge?.motion_mask_id) {
      api.asset(edge.motion_mask_id).then((a) => setMaskPath(a.path)).catch(() => {});
    }
  }, [edge?.id, edge?.motion_mask_id]);

  if (!graph) return <div className="inspector muted">No project loaded.</div>;
  if (!node && !edge)
    return (
      <div className="inspector">
        <h2>Inspector</h2>
        <p className="muted">
          <strong>Click a node</strong> (a keyframe) to edit its prompt and generate images.
          Drag from a node's right handle to another node for a transition; drag back to
          itself for an idle loop, then click the edge to generate a clip.
        </p>
      </div>
    );

  const setP = <K extends keyof GenParams>(k: K, v: GenParams[K]) =>
    setGp((c) => ({ ...c, [k]: v }));

  const savePrompt = async () => {
    if (node) await api.updateNode(node.id, { prompt: draft, negative_prompt: neg });
    if (edge) await api.updateEdge(edge.id, { prompt: draft });
    await refresh();
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 1200);
  };

  const saveCharacter = async (overrides: Partial<{ ref_image_ids: string[] }> = {}) => {
    if (!character) return;
    await api.updateCharacter(character.id, {
      name: charName,
      description: charDesc,
      ref_image_ids: overrides.ref_image_ids ?? refIds,
      lora_name: loraName || null,
      lora_weight: loraWeight,
      ip_adapter_weight: ipWeight,
    });
    await refresh();
    setCharSaved(true);
    setTimeout(() => setCharSaved(false), 1200);
  };

  const addRefImage = async (file: File) => {
    if (!character || !graph) return;
    setUploadingRef(true);
    try {
      const asset = await api.uploadAsset(graph.project.id, file);
      const next = [...refIds, asset.id];
      setRefIds(next);
      setRefThumbs((m) => ({ ...m, [asset.id]: fileUrl(asset.thumb_path || asset.path) }));
      await saveCharacter({ ref_image_ids: next });
    } finally {
      setUploadingRef(false);
      if (refInputRef.current) refInputRef.current.value = "";
    }
  };

  const removeRefImage = async (id: string) => {
    const next = refIds.filter((x) => x !== id);
    setRefIds(next);
    await saveCharacter({ ref_image_ids: next });
  };

  const generate = async () => {
    // Persist the prompt first so what you see is what gets generated.
    await savePrompt();
    setBusy(true);
    const params: Record<string, unknown> = {
      width: gp.width, height: gp.height, steps: gp.steps, cfg: gp.cfg,
    };
    if (gp.checkpoint) params.checkpoint = gp.checkpoint;
    if (gp.seed.trim() !== "") params.seed = Number(gp.seed);
    const job = node
      ? await api.generateNode(node.id, n, params)
      : await api.generateEdge(edge!.id, n, params);
    pollJob(job.id, async () => {
      setBusy(false);
      await refresh();
      openTriage(selection);
    });
  };

  const setActive = async (a: Asset) => {
    if (!selection) return;
    if (selection.type === "node") await api.selectNodeAsset(selection.id, a.id);
    else await api.selectEdgeAsset(selection.id, a.id);
    await refresh();
    await loadVariants();
  };

  const isComfy = imageProvider === "comfyui";
  const selectedId = node?.selected_asset_id ?? edge?.selected_asset_id ?? null;
  // Source keyframe of the selected edge (what a motion mask is painted over).
  const srcNode = edge ? graph.nodes.find((nn) => nn.id === edge.source_node_id) : undefined;
  const srcImg = srcNode?.selected_path || srcNode?.selected_thumb || null;
  // Kept variants = the keepers (accepted/starred) plus whatever is currently active.
  const keptVariants = variants
    .filter((a) => a.status === "accepted" || a.status === "starred" || a.id === selectedId)
    .sort(
      (a, b) =>
        (b.id === selectedId ? 1 : 0) - (a.id === selectedId ? 1 : 0) ||
        (b.status === "starred" ? 1 : 0) - (a.status === "starred" ? 1 : 0),
    );

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
          </div>

          {character && (
            <div className="charbox">
              <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
                This description is prepended to <strong>every</strong> node using “{character.name}”
                — the consistency anchor.
              </div>
              <label className="muted">character name</label>
              <input value={charName} onChange={(e) => setCharName(e.target.value)} />
              <label className="muted" style={{ display: "block", marginTop: 6 }}>
                appearance description
              </label>
              <textarea rows={3} value={charDesc} placeholder="green cloak, short brown hair…"
                onChange={(e) => setCharDesc(e.target.value)} />

              <div className="muted" style={{ fontSize: 11, margin: "10px 0 4px" }}>
                <strong>Consistency stack</strong> (ComfyUI) — pin identity beyond
                the text anchor.
              </div>

              <label className="muted">character LoRA</label>
              {isComfy && comfy?.online && comfy.loras.length > 0 ? (
                <select value={loraName} onChange={(e) => setLoraName(e.target.value)}>
                  <option value="">— none —</option>
                  {comfy.loras.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={loraName}
                  placeholder={isComfy ? "no LoRAs found in ComfyUI" : "switch image provider to ComfyUI"}
                  onChange={(e) => setLoraName(e.target.value)}
                />
              )}
              {loraName && (
                <>
                  <label className="muted" style={{ display: "block", marginTop: 6 }}>
                    LoRA weight · {loraWeight.toFixed(2)}
                  </label>
                  <input type="range" min={0} max={1.5} step={0.05} value={loraWeight}
                    onChange={(e) => setLoraWeight(+e.target.value)} />
                </>
              )}

              <label className="muted" style={{ display: "block", marginTop: 8 }}>
                reference images (IP-Adapter)
              </label>
              <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                {refIds.map((id) => (
                  <div key={id} style={{ position: "relative" }}>
                    {refThumbs[id] ? (
                      <img src={refThumbs[id]} alt="ref"
                        style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 4 }} />
                    ) : (
                      <div style={{ width: 52, height: 52, borderRadius: 4, background: "#0003" }} />
                    )}
                    <button
                      title="remove"
                      onClick={() => removeRefImage(id)}
                      style={{
                        position: "absolute", top: -6, right: -6, width: 18, height: 18,
                        padding: 0, lineHeight: "16px", borderRadius: 9, fontSize: 11,
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button disabled={uploadingRef} onClick={() => refInputRef.current?.click()}
                  style={{ width: 52, height: 52, fontSize: 20 }}>
                  {uploadingRef ? "…" : "+"}
                </button>
              </div>
              <input
                ref={refInputRef}
                type="file"
                accept="image/*"
                style={{ display: "none" }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) addRefImage(f);
                }}
              />
              {refIds.length > 0 && (
                <>
                  <label className="muted" style={{ display: "block", marginTop: 6 }}>
                    IP-Adapter weight · {ipWeight.toFixed(2)}
                  </label>
                  <input type="range" min={0} max={1} step={0.05} value={ipWeight}
                    onChange={(e) => setIpWeight(+e.target.value)} />
                </>
              )}

              <button style={{ marginTop: 8 }} onClick={() => saveCharacter()}>
                {charSaved ? "Saved ✓" : "Save character"}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          <h2>Edge · {edge!.kind === "loop" ? "idle loop ↻" : "transition →"}</h2>
          <p className="muted">
            {edge!.kind === "loop"
              ? "Seamless loop: start frame = end frame (breathing/scratching)."
              : "First→last frame clip between the two keyframes."}
          </p>

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

      {keptVariants.length > 0 && (
        <>
          <h2>Variants — active vs held</h2>
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
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            Click a held variant to make it the active one. Use the triage gallery to add or cull.
          </div>
        </>
      )}

      <h2>✎ Prompt — what gets generated</h2>
      <textarea rows={5} value={draft} placeholder="Describe this keyframe…"
        onChange={(e) => setDraft(e.target.value)} />
      {node && (
        <>
          <label className="muted" style={{ display: "block", marginTop: 8 }}>negative prompt</label>
          <textarea rows={2} value={neg} placeholder="low quality, blurry, extra limbs…"
            onChange={(e) => setNeg(e.target.value)} />
        </>
      )}
      <div className="row" style={{ marginTop: 6 }}>
        <button onClick={savePrompt}>{savedFlag ? "Saved ✓" : "Save"}</button>
        <button
          onClick={async () => {
            const { prompt } = await api.expand(draft, node?.key || edge?.kind || "");
            setDraft(prompt);
          }}
        >
          ✨ Expand (LLM)
        </button>
      </div>

      {node && (
        <>
          <h2>Generation {isComfy ? "· ComfyUI" : "· mock"}</h2>
          {isComfy ? (
            <div className="stack">
              <label className="muted">checkpoint</label>
              {comfy?.online && comfy.checkpoints.length > 0 ? (
                <select value={gp.checkpoint} onChange={(e) => setP("checkpoint", e.target.value)}>
                  <option value="">— workflow default —</option>
                  {comfy.checkpoints.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <span className="muted">{comfy ? "ComfyUI not reachable" : "loading…"}</span>
              )}
              <div className="grid2">
                <div className="stack" style={{ gap: 3 }}>
                  <label className="muted">width</label>
                  <input type="number" step={64} value={gp.width} onChange={(e) => setP("width", +e.target.value)} />
                </div>
                <div className="stack" style={{ gap: 3 }}>
                  <label className="muted">height</label>
                  <input type="number" step={64} value={gp.height} onChange={(e) => setP("height", +e.target.value)} />
                </div>
                <div className="stack" style={{ gap: 3 }}>
                  <label className="muted">steps</label>
                  <input type="number" value={gp.steps} onChange={(e) => setP("steps", +e.target.value)} />
                </div>
                <div className="stack" style={{ gap: 3 }}>
                  <label className="muted">cfg</label>
                  <input type="number" step={0.5} value={gp.cfg} onChange={(e) => setP("cfg", +e.target.value)} />
                </div>
              </div>
              <label className="muted">seed (blank = random per candidate)</label>
              <input value={gp.seed} placeholder="random" onChange={(e) => setP("seed", e.target.value)} />
            </div>
          ) : (
            <p className="muted">Mock provider — switch image provider to ComfyUI in ⚙ Settings to use your models.</p>
          )}
        </>
      )}

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
