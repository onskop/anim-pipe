import { useEffect, useState } from "react";
import { api, fileUrl } from "./api";
import { useStore } from "./store";
import type { Asset } from "./types";

const scoreOf = (a: Asset) =>
  typeof a.ai_score?.overall === "number" ? (a.ai_score.overall as number) : -1;

export default function TriageGallery() {
  const { triage, openTriage, refresh } = useStore();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [scoring, setScoring] = useState<string | null>(null);
  const [sorted, setSorted] = useState(false);

  const load = async () => {
    if (!triage) return;
    setLoading(true);
    setAssets(await api.assets(triage.type, triage.id));
    setLoading(false);
  };

  useEffect(() => {
    load();
    setSorted(false);
  }, [triage?.id]);

  if (!triage) return null;

  const set = (a: Asset, status: Asset["status"]) =>
    api.triage(a.id, status).then(load);

  const remove = (a: Asset) => api.deleteAsset(a.id).then(load);

  const choose = async (a: Asset) => {
    if (triage.type === "node") await api.selectNodeAsset(triage.id, a.id);
    else await api.selectEdgeAsset(triage.id, a.id);
    await refresh();
    await load();
  };

  const score = (a: Asset) => api.score(a.id).then(load);

  const scoreAll = async () => {
    let i = 0;
    for (const a of assets) {
      i++;
      setScoring(`Scoring ${i}/${assets.length}…`);
      try {
        await api.score(a.id);
      } catch {
        /* skip a failed candidate, keep going */
      }
    }
    setScoring(null);
    setSorted(true); // surface the best ones immediately
    await load();
  };

  const pollThenLoad = (jobId: string, label: string) => {
    setLoading(true);
    const tick = async () => {
      const j = await api.job(jobId);
      if (j.status === "done") { await load(); }
      else if (j.status === "error") { setLoading(false); alert(`${label} failed: ${j.error}`); }
      else { setTimeout(tick, 800); }
    };
    setTimeout(tick, 800);
  };

  const upscale = async (a: Asset) => pollThenLoad((await api.upscale(a.id, { scale: 2 })).id, "Upscale");

  // "More like this": new candidates reusing this one's params (fresh seeds).
  const regen = async (a: Asset) => pollThenLoad((await api.regenerate(a.id, 4)).id, "Regenerate");

  const view = sorted ? [...assets].sort((x, y) => scoreOf(y) - scoreOf(x)) : assets;
  const scoredCount = assets.filter((a) => scoreOf(a) >= 0).length;

  return (
    <div className="overlay" onClick={() => openTriage(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Triage · {triage.type} candidates</h2>
          <button onClick={() => openTriage(null)}>Close ✕</button>
        </div>

        <div className="row" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
          <button onClick={scoreAll} disabled={!!scoring || assets.length === 0}>
            {scoring ?? `AI score all (${assets.length})`}
          </button>
          <button
            className={sorted ? "primary" : ""}
            onClick={() => setSorted((s) => !s)}
            disabled={scoredCount === 0}
            title={scoredCount === 0 ? "Score candidates first" : "Toggle sort by AI score"}
          >
            {sorted ? "Sorted by score ▾" : "Sort by score"}
          </button>
          <span className="muted" style={{ flex: 2, textAlign: "right" }}>
            {scoredCount}/{assets.length} scored
          </span>
        </div>

        {loading && <p className="muted">Loading…</p>}
        {!loading && assets.length === 0 && (
          <p className="muted">No candidates yet — generate some from the inspector.</p>
        )}
        <div className="grid" style={{ marginTop: 12 }}>
          {view.map((a) => {
            const overall = scoreOf(a) >= 0 ? scoreOf(a) : undefined;
            return (
              <div key={a.id} className={`cand ${a.status}`}>
                {a.kind === "video" && a.path.endsWith(".mp4") ? (
                  <video src={fileUrl(a.path)} autoPlay loop muted playsInline />
                ) : (
                  <img src={fileUrl(a.path)} alt={a.id} />
                )}
                <div className="meta">
                  <div>{a.role} · {a.width}×{a.height}{a.frames ? ` · ${a.frames}f` : ""}</div>
                  <div className="muted">seed {String(a.params.seed ?? "—")}</div>
                  {overall !== undefined && (
                    <div className="score">
                      AI {Math.round(overall * 100)}%
                      {a.ai_score?.verdict ? ` · ${a.ai_score.verdict}` : ""}
                      <div className="bar"><span style={{ width: `${overall * 100}%` }} /></div>
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button onClick={() => choose(a)} title="Set as selected">✓ Use</button>
                  <button onClick={() => set(a, "starred")} title="Star">★</button>
                  <button className="danger" onClick={() => remove(a)} title="Delete candidate">🗑</button>
                </div>
                <div className="actions">
                  <button onClick={() => score(a)} title="AI score">AI score</button>
                  <button onClick={() => regen(a)} title="Generate 4 more like this (fresh seeds)">♻ More</button>
                  {a.kind === "image" && <button onClick={() => upscale(a)}>Upscale</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
