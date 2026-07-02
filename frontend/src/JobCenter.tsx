/* Floating job center — the global queue, live over SSE.

   Collapsed: a pill (bottom-left of the canvas) that spins while anything is
   queued/running. Expanded: the recent jobs with per-job progress bars. The
   initial list comes from the REST endpoint; SSE snapshots keep it current. */
import { useEffect, useState } from "react";
import { api, onJobEvent } from "./api";
import { useStore } from "./store";
import type { Job } from "./types";

const isActive = (j: Job) => j.status === "queued" || j.status === "running";

export default function JobCenter() {
  const { projectId, graph } = useStore();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!projectId) {
      setJobs([]);
      return;
    }
    api.jobs(projectId).then(setJobs).catch(() => setJobs([]));
  }, [projectId]);

  useEffect(
    () =>
      onJobEvent((e) => {
        if (e.project_id !== projectId) return;
        setJobs((cur) => {
          const idx = cur.findIndex((j) => j.id === e.id);
          const patch = { status: e.status, progress: e.progress, error: e.error, cost: e.cost };
          if (idx >= 0) {
            const next = [...cur];
            next[idx] = { ...next[idx], ...patch };
            return next;
          }
          return [
            { id: e.id, kind: e.kind, target_type: e.target_type, target_id: e.target_id, ...patch } as Job,
            ...cur,
          ];
        });
      }),
    [projectId],
  );

  if (!projectId) return null;
  const active = jobs.filter(isActive);
  const recent = jobs.slice(0, 8);

  const targetLabel = (j: Job) => {
    const n = graph?.nodes.find((x) => x.id === j.target_id);
    if (n) return n.title || n.key;
    const e = graph?.edges.find((x) => x.id === j.target_id);
    if (e) return e.label || e.kind;
    return j.target_type ?? "";
  };

  return (
    <div className="jobCenter">
      {open && (
        <div className="jobList panel">
          <div className="plabel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Jobs</span>
            <button className="xbtn" style={{ width: 22, height: 22 }} onClick={() => setOpen(false)}>✕</button>
          </div>
          {recent.length === 0 && <div className="muted">No jobs yet.</div>}
          {recent.map((j) => (
            <div key={j.id} className="jobRow" title={j.error ?? undefined}>
              <span className={`jobDot ${j.status}`} />
              <span className="jobKind">{j.kind}</span>
              <span className="jobTarget muted">{targetLabel(j)}</span>
              {j.status === "running" && (
                <span className="jobBar">
                  <span style={{ width: `${Math.round(j.progress * 100)}%` }} />
                </span>
              )}
              {j.status === "error" && <span style={{ color: "var(--bad)" }}>⚠</span>}
            </div>
          ))}
        </div>
      )}
      <button className={`jobPill ${active.length ? "busy" : ""}`} onClick={() => setOpen((o) => !o)}>
        {active.length > 0 ? (
          <>
            <span className="spinner" /> {active.length} running
          </>
        ) : (
          "⚙ jobs"
        )}
      </button>
    </div>
  );
}
