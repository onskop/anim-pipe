import { useEffect, useState } from "react";
import { api, fileUrl } from "./api";
import { useStore } from "./store";
import type { Asset } from "./types";

export default function TriageGallery() {
  const { triage, openTriage, refresh } = useStore();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    if (!triage) return;
    setLoading(true);
    setAssets(await api.assets(triage.type, triage.id));
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [triage?.id]);

  if (!triage) return null;

  const set = (a: Asset, status: Asset["status"]) =>
    api.triage(a.id, status).then(load);

  const choose = async (a: Asset) => {
    if (triage.type === "node") await api.selectNodeAsset(triage.id, a.id);
    else await api.selectEdgeAsset(triage.id, a.id);
    await refresh();
    await load();
  };

  const score = (a: Asset) => api.score(a.id).then(load);
  const upscale = (a: Asset) => api.upscale(a.id, 2).then(() => alert("Upscale queued"));

  return (
    <div className="overlay" onClick={() => openTriage(null)}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Triage · {triage.type} candidates</h2>
          <button onClick={() => openTriage(null)}>Close ✕</button>
        </div>
        {loading && <p className="muted">Loading…</p>}
        {!loading && assets.length === 0 && (
          <p className="muted">No candidates yet — generate some from the inspector.</p>
        )}
        <div className="grid" style={{ marginTop: 12 }}>
          {assets.map((a) => {
            const overall = a.ai_score?.overall as number | undefined;
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
                      <div className="bar"><span style={{ width: `${overall * 100}%` }} /></div>
                    </div>
                  )}
                </div>
                <div className="actions">
                  <button onClick={() => choose(a)} title="Set as selected">✓ Use</button>
                  <button onClick={() => set(a, "starred")} title="Star">★</button>
                  <button onClick={() => set(a, "rejected")} title="Reject">✕</button>
                </div>
                <div className="actions">
                  <button onClick={() => score(a)} title="AI score">AI score</button>
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
