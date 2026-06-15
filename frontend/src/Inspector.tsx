import { useEffect, useState } from "react";
import { api } from "./api";
import { useStore } from "./store";
import type { ComfyModels, GEdge, GNode, Job } from "./types";

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
  const [comfy, setComfy] = useState<ComfyModels | null>(null);
  const [imageProvider, setImageProvider] = useState("mock");
  const [gp, setGp] = useState<GenParams>(DEFAULT_PARAMS);

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
  }, [character?.id]);

  // Refresh provider + ComfyUI model list when the panel is shown / selection changes.
  useEffect(() => {
    api.providers().then((p) => setImageProvider(p.image)).catch(() => {});
    api.comfyModels().then(setComfy).catch(() => setComfy(null));
  }, [selection?.id]);

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

  const saveCharacter = async () => {
    if (!character) return;
    await api.updateCharacter(character.id, {
      name: charName,
      description: charDesc,
      ref_image_ids: character.ref_image_ids,
      lora_name: character.lora_name,
      lora_weight: character.lora_weight,
      ip_adapter_weight: character.ip_adapter_weight,
    });
    await refresh();
    setCharSaved(true);
    setTimeout(() => setCharSaved(false), 1200);
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

  const isComfy = imageProvider === "comfyui";

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
              <button style={{ marginTop: 6 }} onClick={saveCharacter}>
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
    </div>
  );
}
