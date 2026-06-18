/* Motion-mask painter (cinemagraph): paint the region of an edge's source
   keyframe that should ANIMATE; everything unpainted stays frozen. Exports a
   white-on-black PNG, uploads it as a mask asset, and sets edge.motion_mask_id
   — which the video pipeline already feeds to the provider. */
import { useEffect, useRef, useState } from "react";
import { api } from "./api";

const MAX_W = 520;

export default function MaskPainter({
  srcUrl,
  projectId,
  edgeId,
  onClose,
  onSaved,
}: {
  srcUrl: string;
  projectId: string;
  edgeId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [dims, setDims] = useState<{ w: number; h: number; nw: number; nh: number } | null>(null);
  const [brush, setBrush] = useState(40);
  const [erase, setErase] = useState(false);
  const [busy, setBusy] = useState(false);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // size the canvas to the (scaled) source image
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const scale = Math.min(1, MAX_W / img.naturalWidth);
      setDims({
        w: Math.round(img.naturalWidth * scale),
        h: Math.round(img.naturalHeight * scale),
        nw: img.naturalWidth,
        nh: img.naturalHeight,
      });
    };
    img.src = srcUrl;
  }, [srcUrl]);

  const pos = (e: React.MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const stroke = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.globalCompositeOperation = erase ? "destination-out" : "source-over";
    ctx.strokeStyle = "#fff";
    ctx.fillStyle = "#fff";
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(b.x, b.y, brush / 2, 0, Math.PI * 2);
    ctx.fill();
  };

  const onDown = (e: React.MouseEvent) => {
    drawing.current = true;
    const p = pos(e);
    last.current = p;
    stroke(p, p);
  };
  const onMove = (e: React.MouseEvent) => {
    if (!drawing.current) return;
    const p = pos(e);
    stroke(last.current ?? p, p);
    last.current = p;
  };
  const onUp = () => {
    drawing.current = false;
    last.current = null;
  };
  const clear = () => {
    const c = canvasRef.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
  };

  const save = async () => {
    if (!dims) return;
    setBusy(true);
    try {
      // composite white strokes onto black at the image's natural resolution
      const out = document.createElement("canvas");
      out.width = dims.nw;
      out.height = dims.nh;
      const octx = out.getContext("2d")!;
      octx.fillStyle = "#000";
      octx.fillRect(0, 0, dims.nw, dims.nh);
      octx.drawImage(canvasRef.current!, 0, 0, dims.nw, dims.nh);
      const blob: Blob = await new Promise((res) => out.toBlob((b) => res(b!), "image/png"));
      const file = new File([blob], `motion_mask_${edgeId}.png`, { type: "image/png" });
      const asset = await api.uploadAsset(projectId, file, "mask");
      await api.updateEdge(edgeId, { motion_mask_id: asset.id });
      onSaved();
      onClose();
    } catch (e) {
      alert(`Saving mask failed: ${e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(620px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Motion mask — paint what moves</h2>
          <button onClick={onClose}>Close ✕</button>
        </div>
        <p className="muted" style={{ fontSize: 11 }}>
          Paint white over the region that should animate (eyes, chest, hair). The rest stays frozen.
        </p>

        <div style={{ position: "relative", width: dims?.w, margin: "0 auto" }}>
          {dims ? (
            <>
              <img src={srcUrl} alt="" draggable={false}
                style={{ width: dims.w, height: dims.h, display: "block", borderRadius: 6 }} />
              <canvas
                ref={canvasRef}
                width={dims.w}
                height={dims.h}
                onMouseDown={onDown}
                onMouseMove={onMove}
                onMouseUp={onUp}
                onMouseLeave={onUp}
                style={{
                  position: "absolute", inset: 0, opacity: 0.5, cursor: "crosshair",
                  borderRadius: 6,
                }}
              />
            </>
          ) : (
            <p className="muted">Loading keyframe…</p>
          )}
        </div>

        <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
          <label className="muted" style={{ flex: 0, whiteSpace: "nowrap" }}>brush {brush}</label>
          <input type="range" min={6} max={120} value={brush} onChange={(e) => setBrush(+e.target.value)} />
          <button className={erase ? "on" : ""} style={{ flex: 0 }} onClick={() => setErase((v) => !v)}>
            {erase ? "erasing" : "erase"}
          </button>
          <button style={{ flex: 0 }} onClick={clear}>clear</button>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy || !dims} onClick={save}>
            {busy ? "Saving…" : "Save mask"}
          </button>
        </div>
      </div>
    </div>
  );
}
