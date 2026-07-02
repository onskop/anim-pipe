/* ============================================================
   PLAYER — "test & see" mode.

   Drives the headless walker (engine/) over the live editor
   graph and renders the selected media:
     • mp4/webm clip  → <video>, advances when it ends
     • gif clip       → <img> (animates), advances after a hold
     • no clip yet    → crossfades the from→to node stills
   So an un-generated graph plays as a slideshow and a generated
   one comes alive — same engine either way.
   ============================================================ */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fileUrl } from "./api";
import SceneGraph from "./SceneGraph";
import { graphToEngine } from "./engine/fromGraph";
import { evalClauses } from "./engine/graph";
import type { EngineEdge, EngineEvent, EngineGraph } from "./engine/types";
import { useWalker } from "./engine/useWalker";
import type { Graph } from "./types";

const HOLD_MS = 2500; // still/gif dwell before advancing (scaled by speed)
const VIDEO_EXT = /\.(mp4|webm|mov|ogg|m4v)$/i;
const IMAGE_EXT = /\.(gif|png|jpe?g|webp|avif)$/i;

function isVideoClip(path: string, kind: string | null): boolean {
  if (VIDEO_EXT.test(path)) return true;
  if (IMAGE_EXT.test(path)) return false; // gif animates as <img>
  return kind === "video";
}

/* ---------- stage: renders media + owns advance timing ---------- */
function Stage({
  graph,
  edge,
  node,
  paused,
  speed,
  onAdvance,
  onProgress,
}: {
  graph: EngineGraph;
  edge: EngineEdge | null;
  node: string | null;
  paused: boolean;
  speed: number;
  onAdvance: () => void;
  onProgress: (t: number) => void;
}) {
  const pausedRef = useRef(paused);
  const speedRef = useRef(speed);
  pausedRef.current = paused;
  speedRef.current = speed;

  const clip = edge?.clip || null;
  const useVideo = clip ? isVideoClip(clip, edge!.clipKind) : false;

  const fromImg = edge ? graph.nodes[edge.from]?.image : node ? graph.nodes[node]?.image : null;
  const toImg = edge ? graph.nodes[edge.to]?.image : fromImg;

  const videoRef = useRef<HTMLVideoElement>(null);

  // keep video play/rate in sync with controls
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
    if (paused) v.pause();
    else void v.play().catch(() => {});
  }, [paused, speed, edge?.id, useVideo]);

  // still/gif hold timer (advance after HOLD_MS); only while traversing an edge
  useEffect(() => {
    if (useVideo || !edge) return; // video advances on ended; no edge = dead-end hold
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      if (!pausedRef.current) elapsed += dt * speedRef.current;
      const t = Math.min(1, elapsed / HOLD_MS);
      onProgress(t);
      if (t >= 1) {
        onAdvance();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [edge, useVideo, onAdvance, onProgress]);

  // ---- render ----
  let media: React.ReactNode;
  if (clip && useVideo) {
    media = (
      <video
        key={edge!.id}
        ref={videoRef}
        className="stageMedia"
        src={fileUrl(clip)}
        autoPlay
        muted
        playsInline
        onEnded={onAdvance}
        onError={onAdvance}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          if (v.duration) onProgress(v.currentTime / v.duration);
        }}
      />
    );
  } else if (clip) {
    // gif clip — animates on its own; hold timer advances
    media = <img key={edge!.id} className="stageMedia" src={fileUrl(clip)} alt={edge!.label} />;
  } else if (toImg || fromImg) {
    // still fallback: crossfade from→to so movement reads even with no clip
    media = (
      <>
        {fromImg && <img className="stageMedia fade" src={fileUrl(fromImg)} alt="" />}
        {toImg && toImg !== fromImg && (
          <img key={edge?.id} className="stageMedia fade crossto" src={fileUrl(toImg)} alt="" />
        )}
      </>
    );
  } else {
    media = (
      <div className="stageEmpty muted">
        No keyframe yet — generate one for this node in the editor.
      </div>
    );
  }

  return <div className="stage">{media}</div>;
}

/* ---------- player ---------- */
export default function Player({ graph: editorGraph }: { graph: Graph }) {
  const engineGraph = useMemo(() => graphToEngine(editorGraph), [editorGraph]);

  const [log, setLog] = useState<(EngineEvent & { ts: string })[]>([]);
  const onEvent = useCallback((ev: EngineEvent) => {
    setLog((l) => [{ ...ev, ts: new Date().toLocaleTimeString() }, ...l].slice(0, 10));
  }, []);

  const { snap, advance, trigger, setVar, reset } = useWalker(engineGraph, onEvent);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [progress, setProgress] = useState(0);

  // reset transient UI when the graph changes
  useEffect(() => {
    setLog([]);
    setProgress(0);
  }, [engineGraph]);

  const choices = useMemo(
    () => engineGraph.edges.filter((e) => e.type === "interaction" && e.trigger),
    [engineGraph],
  );

  const nodeLabel = snap.node ? engineGraph.nodes[snap.node]?.label ?? snap.node : "—";
  const hasNodes = Object.keys(engineGraph.nodes).length > 0;

  return (
    <div className="player">
      {!hasNodes ? (
        <div className="muted" style={{ padding: 24 }}>
          This graph has no nodes yet. Add some in the editor, then come back to play.
        </div>
      ) : (
        <div className="playerGrid">
          <Stage
            graph={engineGraph}
            edge={snap.edge}
            node={snap.node}
            paused={paused}
            speed={speed}
            onAdvance={advance}
            onProgress={setProgress}
          />

          <div className="playerSide">
            <div className="panel sceneMapPanel">
              <div className="plabel">scene map</div>
              <div className="sceneMap">
                <SceneGraph
                  mode="player"
                  activeEdgeId={snap.edge?.id ?? null}
                  activeNodeId={snap.node ?? null}
                  progress={progress}
                />
              </div>
            </div>

            <div className="panel">
              <div className="plabel">state</div>
              <div className="hudrow"><span>node</span><b>{nodeLabel}</b></div>
              <div className="hudrow">
                <span>edge</span>
                <b className={snap.edge?.type === "interaction" ? "amber" : "blue"}>
                  {snap.edge?.label ?? "—"}
                </b>
              </div>
              <div className="hudrow"><span>progress</span><b>{Math.round(progress * 100)}%</b></div>
              <div className="hudrow">
                <span>queue</span>
                <b className={snap.queueIds.length ? "amber" : ""}>
                  {snap.queueIds.length ? snap.queueIds.join(" → ") : "empty"}
                </b>
              </div>
              <div className="progressbar"><div style={{ width: `${progress * 100}%` }} /></div>
            </div>

            {choices.length > 0 && (
              <div className="panel">
                <div className="plabel">choices</div>
                <div className="stack" style={{ gap: 6 }}>
                  {choices.map((e) => {
                    const usable =
                      (!e.once || !snap.usedIds.includes(e.id)) &&
                      evalClauses(e.condition, snap.vars);
                    const queued = snap.queueIds.includes(e.id);
                    const here = e.from === snap.node;
                    return (
                      <button
                        key={e.id}
                        className={queued ? "on" : ""}
                        disabled={!usable || queued}
                        title={
                          !usable
                            ? "condition not met"
                            : here
                              ? "plays from the current node"
                              : "walker routes there via idle edges"
                        }
                        onClick={() => e.trigger && trigger(e.trigger)}
                      >
                        {e.trigger}
                        {!here && (
                          <span className="muted"> · @{engineGraph.nodes[e.from]?.label}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {Object.keys(snap.vars).length > 0 && (
              <div className="panel">
                <div className="plabel">variables (live — edit to test)</div>
                {Object.entries(snap.vars).map(([k, v]) => (
                  <div className="hudrow" key={k}>
                    <span>{k}</span>
                    {typeof v === "boolean" ? (
                      <input
                        type="checkbox"
                        style={{ width: "auto" }}
                        checked={v}
                        onChange={(e) => setVar(k, e.target.checked)}
                      />
                    ) : (
                      <input
                        type="number"
                        style={{ width: 72, padding: "2px 6px" }}
                        value={v}
                        onChange={(e) => setVar(k, +e.target.value)}
                      />
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="panel">
              <div className="plabel">controls</div>
              <div className="row" style={{ gap: 6 }}>
                <button className={paused ? "on" : ""} onClick={() => setPaused((p) => !p)}>
                  {paused ? "resume" : "pause"}
                </button>
                {[0.5, 1, 2].map((s) => (
                  <button key={s} className={speed === s ? "on" : ""} onClick={() => setSpeed(s)}>
                    {s}×
                  </button>
                ))}
                <button onClick={reset} title="Restart the run — start node, default variables">
                  ⟲
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="plabel">event log</div>
              {log.length === 0 && <div className="logline muted">scheduler starting…</div>}
              {log.map((l, i) => (
                <div key={i} className="logline">
                  <span className={l.kind === "interaction" || l.kind === "queued" ? "amber" : "blue"}>
                    {l.kind}
                  </span>{" "}
                  <b>{l.edge ?? ""}</b> @ {l.node}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
