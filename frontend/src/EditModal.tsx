/* Deterministic edit modal: crop/resize for images, extract-frame/trim for
   clips. Each Apply posts to /assets/{id}/edit and yields a new lineage-linked
   candidate, then reloads the gallery. */
import { useRef, useState } from "react";
import { api, fileUrl } from "./api";
import { dialog } from "./dialogs";
import type { Asset } from "./types";

type Box = { x: number; y: number; w: number; h: number };

export default function EditModal({
  asset,
  onClose,
  onApplied,
}: {
  asset: Asset;
  onClose: () => void;
  onApplied: () => void;
}) {
  const isVideo = asset.kind === "video";
  const isMp4 = asset.path.endsWith(".mp4") || asset.path.endsWith(".webm");
  const [busy, setBusy] = useState(false);
  const [w, setW] = useState(asset.width ?? 512);
  const [h, setH] = useState(asset.height ?? 512);
  const [frameIdx, setFrameIdx] = useState(0);
  const [trimStart, setTrimStart] = useState(0);
  const [trimEnd, setTrimEnd] = useState(asset.frames ?? 1);
  const [box, setBox] = useState<Box | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  const run = async (op: string, args: Record<string, unknown>) => {
    setBusy(true);
    try {
      await api.editAsset(asset.id, op, args);
      onApplied();
      onClose();
    } catch (e) {
      dialog.toast(`Edit failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const rel = (e: React.MouseEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const onDown = (e: React.MouseEvent) => {
    drag.current = rel(e);
    setBox({ ...drag.current, w: 0, h: 0 });
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drag.current) return;
    const p = rel(e);
    const a = drag.current;
    setBox({ x: Math.min(a.x, p.x), y: Math.min(a.y, p.y), w: Math.abs(p.x - a.x), h: Math.abs(p.y - a.y) });
  };
  const onUp = () => {
    drag.current = null;
  };
  const hasBox = !!box && box.w > 0.01 && box.h > 0.01;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(680px, 92vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Edit · {asset.kind} · {asset.role}</h2>
          <button onClick={onClose}>Close ✕</button>
        </div>

        {!isVideo && (
          <>
            <div className="plabel" style={{ marginTop: 12 }}>crop — drag a box</div>
            <div
              style={{ position: "relative", display: "inline-block", maxWidth: "100%", cursor: "crosshair" }}
              onMouseDown={onDown}
              onMouseMove={onMove}
              onMouseUp={onUp}
              onMouseLeave={onUp}
            >
              <img ref={imgRef} src={fileUrl(asset.path)} alt="" draggable={false}
                style={{ maxWidth: "100%", display: "block", userSelect: "none" }} />
              {hasBox && (
                <div style={{
                  position: "absolute", border: "2px solid var(--accent)",
                  background: "rgba(110,168,255,.15)", pointerEvents: "none",
                  left: `${box!.x * 100}%`, top: `${box!.y * 100}%`,
                  width: `${box!.w * 100}%`, height: `${box!.h * 100}%`,
                }} />
              )}
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button disabled={!hasBox || busy} onClick={() => run("crop", { box })}>Apply crop</button>
              <button disabled={busy} onClick={() => setBox(null)}>Clear</button>
            </div>

            <div className="plabel" style={{ marginTop: 14 }}>resize</div>
            <div className="row">
              <input type="number" value={w} onChange={(e) => setW(+e.target.value)} />
              <span className="muted" style={{ flex: 0 }}>×</span>
              <input type="number" value={h} onChange={(e) => setH(+e.target.value)} />
              <button disabled={busy} onClick={() => run("resize", { width: w, height: h })}>Apply resize</button>
            </div>
          </>
        )}

        {isVideo && (
          <>
            {isMp4 ? (
              <video src={fileUrl(asset.path)} autoPlay loop muted playsInline
                style={{ maxWidth: "100%", display: "block", marginTop: 12, borderRadius: 6 }} />
            ) : (
              <img src={fileUrl(asset.path)} alt="" style={{ maxWidth: "100%", display: "block", marginTop: 12, borderRadius: 6 }} />
            )}
            {isMp4 && (
              <div className="muted" style={{ fontSize: 11, marginTop: 6 }}>
                Frame extraction works on mp4/webm (via ffmpeg). Trim still supports GIF clips only.
              </div>
            )}

            <div className="plabel" style={{ marginTop: 14 }}>extract frame → keyframe</div>
            <div className="row">
              <label className="muted" style={{ flex: 0 }}>frame</label>
              <input type="number" min={0} max={(asset.frames ?? 1) - 1} value={frameIdx}
                onChange={(e) => setFrameIdx(+e.target.value)} />
              <button disabled={busy} onClick={() => run("extract_frame", { index: frameIdx })}>
                Extract → keyframe
              </button>
            </div>
            <div className="muted" style={{ fontSize: 11 }}>Lands as a candidate on this edge's target node.</div>

            <div className="plabel" style={{ marginTop: 14 }}>trim (frame range){isMp4 ? " · GIF only" : ""}</div>
            <div className="row">
              <input type="number" min={0} value={trimStart} disabled={isMp4} onChange={(e) => setTrimStart(+e.target.value)} />
              <span className="muted" style={{ flex: 0 }}>→</span>
              <input type="number" min={1} value={trimEnd} disabled={isMp4} onChange={(e) => setTrimEnd(+e.target.value)} />
              <button disabled={busy || isMp4} onClick={() => run("trim", { start: trimStart, end: trimEnd })}>Apply trim</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
