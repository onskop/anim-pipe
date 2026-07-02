/* Editor modal — the main place to write prompts, generate, and manage the
   candidate resources for a node or edge. Opened from the inspector's
   "Edit & generate". (Internally still the `triage` selection in the store.)

   Layout goals: leanest path is prompt → Generate. Generation settings are
   tucked behind a ⚙ disclosure. Each candidate gets one compact icon row;
   "Use" only appears on non-active cards (the active one wears a badge). The
   old per-card "More" is folded into the top Generate control as an *anchor*:
   anchoring a card seeds the generator with that image's recipe and produces
   fresh variations. */
import { useEffect, useState } from "react";
import { api, fileUrl, waitJob } from "./api";
import { dialog } from "./dialogs";
import EditModal from "./EditModal";
import { useStore } from "./store";
import type { Asset, ComfyModels } from "./types";

const scoreOf = (a: Asset) =>
  typeof a.ai_score?.overall === "number" ? (a.ai_score.overall as number) : -1;
const numParam = (p: Record<string, unknown>, k: string, fallback: number) =>
  typeof p[k] === "number" ? (p[k] as number) : fallback;

interface GenParams {
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  seed: string;
  // video (edge) only
  frames: number;
  fps: number;
  motion: number;
}
const IMAGE_PARAMS: GenParams = {
  checkpoint: "", width: 512, height: 512, steps: 20, cfg: 7, seed: "",
  frames: 81, fps: 16, motion: 0.6,
};
// Wan2.2-friendly defaults for edge clips (~5 s @ 16 fps, 720p).
const VIDEO_PARAMS: GenParams = { ...IMAGE_PARAMS, width: 720, height: 720 };

export default function TriageGallery() {
  const { triage, graph, openTriage, refresh } = useStore();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoreProg, setScoreProg] = useState<{ done: number; total: number } | null>(null);
  const [sorted, setSorted] = useState(false);
  const [editing, setEditing] = useState<Asset | null>(null);
  const [copyFor, setCopyFor] = useState<Asset | null>(null);
  const [copyMsg, setCopyMsg] = useState<string | null>(null);
  // editor state
  const [draft, setDraft] = useState("");
  const [neg, setNeg] = useState("");
  const [savedFlag, setSavedFlag] = useState(false);
  const [expanding, setExpanding] = useState(false);
  const [genBusy, setGenBusy] = useState(false);
  const [count, setCount] = useState(4);
  const [comfy, setComfy] = useState<ComfyModels | null>(null);
  const [imageProvider, setImageProvider] = useState("mock");
  const [videoProvider, setVideoProvider] = useState("mock");
  const [gp, setGp] = useState<GenParams>(IMAGE_PARAMS);
  const [showSettings, setShowSettings] = useState(false);
  const [anchor, setAnchor] = useState<Asset | null>(null);
  const [prog, setProg] = useState<number | null>(null);
  // derive-from-image (instruction edit) state
  const [deriveFrom, setDeriveFrom] = useState<Asset | null>(null);
  const [instruction, setInstruction] = useState("");
  const [preview, setPreview] = useState<{ positive: string; negative: string } | null>(null);

  const node = triage?.type === "node" ? graph?.nodes.find((n) => n.id === triage.id) : undefined;
  const edge = triage?.type === "edge" ? graph?.edges.find((e) => e.id === triage.id) : undefined;

  const load = async () => {
    if (!triage || triage.type === "character") return;
    setLoading(true);
    setAssets(await api.assets(triage.type, triage.id));
    setLoading(false);
  };

  useEffect(() => {
    if (!triage || triage.type === "character") return;
    setDraft(node?.prompt ?? edge?.prompt ?? "");
    setNeg(node?.negative_prompt ?? "");
    setSorted(false);
    setCopyFor(null);
    setAnchor(null);
    setDeriveFrom(null);
    setInstruction("");
    setPreview(null);
    setGp(triage.type === "edge" ? VIDEO_PARAMS : IMAGE_PARAMS);
    load();
    api.providers().then((p) => { setImageProvider(p.image); setVideoProvider(p.video); }).catch(() => {});
    api.comfyModels().then(setComfy).catch(() => setComfy(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [triage?.id]);

  if (!triage || triage.type === "character") return null;

  const setP = <K extends keyof GenParams>(k: K, v: GenParams[K]) =>
    setGp((c) => ({ ...c, [k]: v }));

  const remove = (a: Asset) => api.deleteAsset(a.id).then(load).then(refresh);

  const choose = async (a: Asset) => {
    if (triage.type === "node") await api.selectNodeAsset(triage.id, a.id);
    else await api.selectEdgeAsset(triage.id, a.id);
    await refresh();
    await load();
    dialog.toast("Set as active");
  };

  const score = (a: Asset) => api.score(a.id).then(load);

  // Score only the candidates that have no score yet. Runs a bounded worker
  // pool (parallel, but throttled so we don't flood the local scoring model)
  // and updates the progress bar as each one lands.
  const SCORE_CONCURRENCY = 4;
  const scoreRemaining = async () => {
    const todo = assets.filter((a) => scoreOf(a) < 0);
    if (todo.length === 0) return;
    const total = todo.length;
    let done = 0;
    let next = 0;
    setScoreProg({ done: 0, total });
    const worker = async () => {
      while (next < todo.length) {
        const a = todo[next++];
        try { await api.score(a.id); } catch { /* keep going */ }
        setScoreProg({ done: ++done, total });
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(SCORE_CONCURRENCY, total) }, worker),
    );
    setScoreProg(null);
    setSorted(true);
    await load();
  };

  // Shortlist: star the best-scored candidates so the keepers stand out.
  const starTop = async () => {
    const top = assets
      .filter((a) => scoreOf(a) >= 0)
      .sort((x, y) => scoreOf(y) - scoreOf(x))
      .slice(0, 3);
    await Promise.all(top.map((a) => api.triage(a.id, "starred")));
    await load();
    setSorted(true);
    dialog.toast(`Starred top ${top.length} ★`, "success");
  };

  // Wait on a job via the SSE stream (live progress), then reload the gallery.
  const runJob = async (jobId: string, label: string, onDone?: () => void) => {
    setLoading(true);
    setProg(0);
    const j = await waitJob(jobId, setProg);
    setProg(null);
    if (j.status === "error") {
      setLoading(false);
      onDone?.();
      dialog.toast(`${label} failed: ${j.error}`, "error");
      return;
    }
    await load();
    await refresh();
    onDone?.();
  };

  const upscale = async (a: Asset) => runJob((await api.upscale(a.id, { scale: 2 })).id, "Upscale");

  // Anchor a candidate: prime the generator with its recipe so the next
  // Generate yields fresh variations of that image (toggles off if re-picked).
  const toggleAnchor = (a: Asset) =>
    setAnchor((prev) => {
      if (prev?.id === a.id) return null;
      const p = a.params || {};
      setGp((c) => ({
        ...c,
        width: numParam(p, "width", c.width),
        height: numParam(p, "height", c.height),
        steps: numParam(p, "steps", c.steps),
        cfg: numParam(p, "cfg", c.cfg),
        checkpoint: typeof p.checkpoint === "string" ? (p.checkpoint as string) : c.checkpoint,
      }));
      return a;
    });

  // --- prompt + generation (the modal is the editor) ---------------------
  const savePrompt = async () => {
    if (node) await api.updateNode(node.id, { prompt: draft, negative_prompt: neg });
    if (edge) await api.updateEdge(edge.id, { prompt: draft });
    await refresh();
    setSavedFlag(true);
    setTimeout(() => setSavedFlag(false), 1200);
  };

  // Show the exact assembled prompts generation will send (anchor + prompt +
  // style). Saves first so the preview reflects the current draft.
  const togglePreview = async () => {
    if (preview) {
      setPreview(null);
      return;
    }
    await savePrompt();
    try {
      setPreview(await api.promptPreview(triage.type as "node" | "edge", triage.id));
    } catch (e) {
      dialog.toast(`Preview failed: ${e}`, "error");
    }
  };

  const expand = async () => {
    setExpanding(true);
    try {
      const { prompt } = await api.expand(draft, node?.key || edge?.kind || "");
      setDraft(prompt);
      dialog.toast("Prompt expanded ✓", "success");
    } catch (e) {
      dialog.toast(`Expand failed: ${e}`, "error");
    } finally {
      setExpanding(false);
    }
  };

  const generate = async () => {
    await savePrompt();
    setGenBusy(true);
    const params: Record<string, unknown> = node
      ? { width: gp.width, height: gp.height, steps: gp.steps, cfg: gp.cfg }
      : { width: gp.width, height: gp.height, frames: gp.frames, fps: gp.fps, motion_scale: gp.motion };
    if (node && gp.checkpoint) params.checkpoint = gp.checkpoint;
    if (gp.seed.trim() !== "") params.seed = Number(gp.seed);
    dialog.toast(
      anchor
        ? `Generating ${count} variation${count > 1 ? "s" : ""}…`
        : `Generating ${count} candidate${count > 1 ? "s" : ""}…`,
    );
    try {
      const job = anchor
        ? await api.regenerate(anchor.id, count, params)
        : node
          ? await api.generateNode(node.id, count, params)
          : await api.generateEdge(edge!.id, count, params);
      runJob(job.id, "Generation", () => {
        setGenBusy(false);
        dialog.toast("Candidates ready ✓", "success");
      });
    } catch (e) {
      setGenBusy(false);
      dialog.toast(`Generation failed: ${e}`, "error");
    }
  };

  // Instruction-edit derive: turn an existing image into fresh candidates
  // ("same framing, but eyes closed") — lineage-linked to the source.
  const derive = async () => {
    if (!node || !deriveFrom || !instruction.trim()) return;
    setGenBusy(true);
    dialog.toast(`Deriving ${count} candidate${count > 1 ? "s" : ""}…`);
    try {
      const job = await api.deriveNode(node.id, deriveFrom.id, instruction, count);
      runJob(job.id, "Derive", () => {
        setGenBusy(false);
        dialog.toast("Derived candidates ready ✓", "success");
      });
    } catch (e) {
      setGenBusy(false);
      dialog.toast(`Derive failed: ${e}`, "error");
    }
  };

  // --- copy-to targets ---------------------------------------------------
  const copyTargets = graph
    ? [
        ...graph.nodes
          .filter((nd) => !(triage.type === "node" && nd.id === triage.id))
          .map((nd) => ({ type: "node" as const, id: nd.id, label: `▢ ${nd.title || nd.key}` })),
        ...graph.edges
          .filter((ed) => !(triage.type === "edge" && ed.id === triage.id))
          .map((ed) => ({ type: "edge" as const, id: ed.id, label: `↦ ${ed.label || ed.kind}` })),
      ]
    : [];
  const copyTo = async (a: Asset, t: { type: "node" | "edge"; id: string; label: string }) => {
    await api.copyAsset(a.id, t.type, t.id);
    setCopyFor(null);
    setCopyMsg(`Copied to ${t.label}`);
    setTimeout(() => setCopyMsg(null), 1800);
    await refresh();
  };

  const view = sorted ? [...assets].sort((x, y) => scoreOf(y) - scoreOf(x)) : assets;
  const scoredCount = assets.filter((a) => scoreOf(a) >= 0).length;
  const unscored = assets.length - scoredCount;
  const isComfy = (edge ? videoProvider : imageProvider) === "comfyui";
  const title = node ? node.title || node.key : edge ? edge.label || edge.kind : "";
  const activeId = node?.selected_asset_id ?? edge?.selected_asset_id ?? null;
  const busy = genBusy || loading;
  const isClip = (a: Asset) => a.kind === "video" && a.path.endsWith(".mp4");

  return (
    <div className="overlay" onClick={() => openTriage(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modalHead">
          <h2 style={{ margin: 0 }}>
            Edit · {triage.type} · <span className="muted">{title}</span>
          </h2>
          <button className="xbtn" onClick={() => openTriage(null)} title="Close">✕</button>
        </div>

        {/* prompt */}
        <div className="sectionLabel">Prompt — what gets generated</div>
        <textarea rows={4} value={draft} placeholder="Describe this keyframe / motion…"
          onChange={(e) => setDraft(e.target.value)} />
        {node && (
          <>
            <label className="muted" style={{ display: "block", marginTop: 6 }}>negative prompt</label>
            <textarea rows={2} value={neg} placeholder="low quality, blurry, extra limbs…"
              onChange={(e) => setNeg(e.target.value)} />
          </>
        )}
        <div className="endRow">
          <button className={preview ? "on" : ""} onClick={togglePreview}
            title="Show the final assembled prompt (character anchor + prompt + style)">
            👁 Final
          </button>
          <button onClick={savePrompt}>{savedFlag ? "Saved ✓" : "Save"}</button>
          <button onClick={expand} disabled={expanding}>
            {expanding ? "✨ Expanding…" : "✨ Expand"}
          </button>
        </div>
        {preview && (
          <div className="promptPreview">
            <div><b>positive</b>{preview.positive}</div>
            <div className="neg"><b>negative</b>{preview.negative}</div>
          </div>
        )}

        {/* generation */}
        <div className="sectionLabel">Generate · {edge ? videoProvider : imageProvider}</div>
        {(edge ? videoProvider : imageProvider) === "mock" && (
          <p className="muted" style={{ marginTop: 0 }}>
            Mock provider — switch the {edge ? "video" : "image"} provider to ComfyUI or fal.ai in ⚙ Settings to use real models.
          </p>
        )}

        {anchor && (
          <div className="anchorSlot">
            {isClip(anchor)
              ? <video src={fileUrl(anchor.path)} muted playsInline />
              : <img src={fileUrl(anchor.path)} alt="anchor" />}
            <div className="txt">
              <b>Anchored</b> — Generate makes fresh variations reusing this candidate's
              saved settings{anchor.params.checkpoint ? " & model" : ""}.
            </div>
            <button className="xbtn" onClick={() => setAnchor(null)} title="Clear anchor">✕</button>
          </div>
        )}

        {node && !deriveFrom && (() => {
          const keepers = (graph?.nodes ?? []).filter(
            (nd) => nd.id !== node.id && nd.selected_asset_id && nd.selected_path && nd.selected_kind === "image",
          );
          if (keepers.length === 0) return null;
          return (
            <div className="row" style={{ marginTop: 8 }}>
              <label className="muted" style={{ flex: "0 0 auto" }}>🪄 derive from</label>
              <select
                value=""
                onChange={(e) => {
                  const nd = keepers.find((x) => x.id === e.target.value);
                  if (nd?.selected_asset_id && nd.selected_path) {
                    setDeriveFrom({ id: nd.selected_asset_id, path: nd.selected_path, kind: "image" } as Asset);
                  }
                }}
              >
                <option value="" disabled>another node's locked keyframe…</option>
                {keepers.map((nd) => (
                  <option key={nd.id} value={nd.id}>{nd.title || nd.key}</option>
                ))}
              </select>
            </div>
          );
        })()}

        {node && deriveFrom && (
          <div className="anchorSlot">
            <img src={fileUrl(deriveFrom.path)} alt="derive source" />
            <div className="txt" style={{ flex: 1 }}>
              <b>Derive</b> — instruction-edit this image into new candidates
              (keeps framing &amp; identity; describe only the change).
              <input
                style={{ width: "100%", marginTop: 6 }}
                value={instruction}
                placeholder='e.g. "same framing, but eyes closed and head tilted"'
                onChange={(e) => setInstruction(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") derive(); }}
              />
            </div>
            <button className="primary" disabled={genBusy || !instruction.trim()} onClick={derive}>
              Derive {count}
            </button>
            <button className="xbtn" onClick={() => setDeriveFrom(null)} title="Clear derive source">✕</button>
          </div>
        )}

        <div className="genRow">
          <label className="muted">count</label>
          <input type="number" min={1} max={16} value={count}
            onChange={(e) => setCount(+e.target.value)} />
          <button className="primary grow" disabled={genBusy} onClick={generate}>
            {genBusy ? "Generating…" : anchor ? `Generate ${count} variations` : `Generate ${count}`}
          </button>
          {(edge ? videoProvider : imageProvider) !== "mock" && (
            <button onClick={() => setShowSettings((s) => !s)} title="Generation settings">
              ⚙ {showSettings ? "▴" : "▾"}
            </button>
          )}
        </div>

        {showSettings && (edge ? videoProvider : imageProvider) !== "mock" && (
          <div className="stack" style={{ marginTop: 8 }}>
            {node && isComfy && (
              <>
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
              </>
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
              {node ? (
                <>
                  <div className="stack" style={{ gap: 3 }}>
                    <label className="muted">steps</label>
                    <input type="number" value={gp.steps} onChange={(e) => setP("steps", +e.target.value)} />
                  </div>
                  <div className="stack" style={{ gap: 3 }}>
                    <label className="muted">cfg</label>
                    <input type="number" step={0.5} value={gp.cfg} onChange={(e) => setP("cfg", +e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div className="stack" style={{ gap: 3 }}>
                    <label className="muted">frames</label>
                    <input type="number" step={1} value={gp.frames} onChange={(e) => setP("frames", +e.target.value)} />
                  </div>
                  <div className="stack" style={{ gap: 3 }}>
                    <label className="muted">fps</label>
                    <input type="number" step={1} value={gp.fps} onChange={(e) => setP("fps", +e.target.value)} />
                  </div>
                </>
              )}
            </div>
            {edge && (
              <>
                <label className="muted">motion scale — lower = subtler idle ({gp.motion})</label>
                <input type="range" min={0} max={1} step={0.05} value={gp.motion}
                  onChange={(e) => setP("motion", +e.target.value)} />
                <span className="muted" style={{ fontSize: 11 }}>
                  ≈ {gp.fps ? (gp.frames / gp.fps).toFixed(1) : "?"}s clip · start = source frame
                  {edge.kind === "loop" ? " (looped back to itself)" : ", end = target frame"}.
                </span>
              </>
            )}
            <label className="muted">seed (blank = random per candidate)</label>
            <input value={gp.seed} placeholder="random" onChange={(e) => setP("seed", e.target.value)} />
          </div>
        )}

        {/* candidates / management */}
        <div className="row resHead">
          <div className="sectionLabel" style={{ flex: 1, margin: 0 }}>Resources · {assets.length}</div>
          <button onClick={scoreRemaining} disabled={!!scoreProg || unscored === 0}
            title="AI-score every candidate that has no score yet">
            {scoreProg
              ? `Scoring ${scoreProg.done}/${scoreProg.total}…`
              : unscored
                ? `Score ${unscored} unscored`
                : "All scored ✓"}
          </button>
          <button
            className={sorted ? "primary" : ""}
            onClick={() => setSorted((s) => !s)}
            disabled={scoredCount === 0}
            title={scoredCount === 0 ? "Score candidates first" : "Toggle sort by AI score"}
          >
            {sorted ? "Sorted ▾" : "Sort by score"}
          </button>
          {scoredCount >= 2 && (
            <button onClick={starTop} title="Star the top 3 by AI score (shortlist)">★ Top 3</button>
          )}
        </div>
        {scoreProg && (
          <div className="scoreProg">
            <span style={{ width: `${scoreProg.total ? (scoreProg.done / scoreProg.total) * 100 : 0}%` }} />
          </div>
        )}
        {copyMsg && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>{copyMsg}</div>}

        {busy && (
          <div className="genBanner">
            <span className="spinner" />{" "}
            {genBusy ? "Generating candidates…" : "Working…"}
            {prog !== null && prog > 0 && ` ${Math.round(prog * 100)}%`}
          </div>
        )}
        {!loading && assets.length === 0 && !genBusy && (
          <p className="muted">No candidates yet — set a prompt and hit Generate.</p>
        )}

        <div className="grid" style={{ marginTop: 12 }}>
          {view.map((a) => {
            const active = a.id === activeId;
            const isAnchor = anchor?.id === a.id;
            const overall = scoreOf(a) >= 0 ? scoreOf(a) : undefined;
            return (
              <div key={a.id} className={`cand ${active ? "accepted" : ""}`}>
                <div className="thumbWrap">
                  {isClip(a) ? (
                    <video src={fileUrl(a.path)} autoPlay loop muted playsInline />
                  ) : (
                    <img src={fileUrl(a.path)} alt={a.id} />
                  )}
                  <div className="candTop">
                    <span className="candBadges">
                      {active && <span className="activeBadge">✓ Active</span>}
                      {isAnchor && <span className="anchorBadge">⚓ Anchor</span>}
                      {a.status === "starred" && <span className="anchorBadge">★</span>}
                    </span>
                    {overall !== undefined && (
                      <span className={`scorePill ${overall >= 0.7 ? "good" : overall < 0.5 ? "bad" : ""}`}>
                        {Math.round(overall * 100)}%
                      </span>
                    )}
                  </div>
                </div>
                <div className="meta">
                  {a.role} · {a.width}×{a.height}{a.frames ? ` · ${a.frames}f` : ""} · seed {String(a.params.seed ?? "—")}
                </div>
                <div className="candBar">
                  {active ? (
                    <span className="useActive">✓ active</span>
                  ) : (
                    <button className="use" onClick={() => choose(a)} title="Set as the active asset for this node">✓ Use</button>
                  )}
                  <button className={isAnchor ? "anchorOn" : ""} onClick={() => toggleAnchor(a)}
                    title="Anchor — Generate variations from this image's recipe">⚓</button>
                  {node && a.kind === "image" && (
                    <button className={deriveFrom?.id === a.id ? "on" : ""}
                      onClick={() => setDeriveFrom((d) => (d?.id === a.id ? null : a))}
                      title="Derive — instruction-edit this image into new candidates">🪄</button>
                  )}
                  {overall === undefined && (
                    <button className="ai" onClick={() => score(a)} title="AI score this candidate">AI</button>
                  )}
                  <button onClick={() => setEditing(a)} title="Crop / resize / trim / extract frame">✂</button>
                  {a.kind === "image" && (
                    <button onClick={() => upscale(a)} title="Upscale ×2">⤢</button>
                  )}
                  <button className={copyFor?.id === a.id ? "on" : ""} disabled={copyTargets.length === 0}
                    onClick={() => setCopyFor((c) => (c?.id === a.id ? null : a))}
                    title="Copy to another node / edge (shares the file)">⧉</button>
                  <button className="danger del" onClick={() => remove(a)} title="Delete candidate">🗑</button>
                </div>
                {copyFor?.id === a.id && (
                  <select
                    defaultValue=""
                    style={{ width: "calc(100% - 12px)", margin: "0 6px 6px" }}
                    onChange={(e) => {
                      const t = copyTargets.find((x) => `${x.type}:${x.id}` === e.target.value);
                      if (t) copyTo(a, t);
                    }}
                  >
                    <option value="" disabled>copy to…</option>
                    {copyTargets.map((t) => (
                      <option key={`${t.type}:${t.id}`} value={`${t.type}:${t.id}`}>{t.label}</option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        {editing && (
          <EditModal
            asset={editing}
            onClose={() => setEditing(null)}
            onApplied={() => { refresh(); load(); }}
          />
        )}
      </div>
    </div>
  );
}
