import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { ComfyModels, Settings as TSettings, TestLLMResult, WorkflowInfo } from "./types";

const START_CMD =
  "cd C:\\Projects\\dev\\nime\\anim-pipe\\backend; uvicorn app.main:app --reload --port 8000";

export default function Settings({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [online, setOnline] = useState(true);
  const [s, setS] = useState<TSettings | null>(null);
  const [comfy, setComfy] = useState<ComfyModels | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<TestLLMResult | null>(null);
  const [restarting, setRestarting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    const up = await api.health();
    setOnline(up);
    if (!up) return;
    setS(await api.settings());
    api.comfyModels().then(setComfy).catch(() => setComfy(null));
    api.workflows().then(setWorkflows).catch(() => setWorkflows([]));
  };

  useEffect(() => {
    load();
    pollRef.current = window.setInterval(async () => setOnline(await api.health()), 4000);
    return () => {
      if (pollRef.current) window.clearInterval(pollRef.current);
    };
  }, []);

  const set = <K extends keyof TSettings>(k: K, v: TSettings[K]) =>
    setS((cur) => (cur ? { ...cur, [k]: v } : cur));

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      const next = await api.updateSettings(s);
      setS(next);
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
      onSaved();
      api.comfyModels().then(setComfy).catch(() => {});
    } finally {
      setBusy(false);
    }
  };

  const runTest = async () => {
    setTest(null);
    setBusy(true);
    try {
      setTest(await api.testLLM());
    } finally {
      setBusy(false);
    }
  };

  const restart = async () => {
    setRestarting(true);
    try {
      await api.restart();
    } catch {
      /* connection drops as it reloads — expected */
    }
    // Wait for it to come back.
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 750));
      if (await api.health()) break;
    }
    setRestarting(false);
    await load();
    onSaved();
  };

  const Field = ({ label, children }: { label: string; children: ReactNode }) => (
    <div className="stack" style={{ gap: 3 }}>
      <label className="muted">{label}</label>
      {children}
    </div>
  );

  // Per-role workflow picker: lists templates on disk and shows which logical
  // fields each one exposes (auto-detected) + the model files it references.
  const wfPicker = (
    label: string,
    key: "workflow_image" | "workflow_loop" | "workflow_transition",
    role: "image" | "video",
  ): ReactNode => {
    if (!s) return null;
    const cur = workflows.find((w) => w.name === s[key]);
    const opts = workflows.filter((w) => w.role === role);
    return (
      <Field label={label}>
        <select value={s[key]} onChange={(e) => set(key, e.target.value)}>
          {!workflows.some((w) => w.name === s[key]) && (
            <option value={s[key]}>{s[key]} (not found)</option>
          )}
          {opts.map((w) => (
            <option key={w.name} value={w.name}>{w.name}</option>
          ))}
        </select>
        {cur && (
          <div className="muted" style={{ fontSize: 11, marginTop: 1 }}>
            drives: {cur.fields.join(", ") || "—"}
            {cur.models.length > 0 && ` · refs: ${cur.models.join(", ")}`}
          </div>
        )}
      </Field>
    );
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ width: "min(560px, 94vw)" }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Settings</h2>
          <button onClick={onClose}>Close ✕</button>
        </div>

        {/* backend status */}
        <div className="row" style={{ marginTop: 10, justifyContent: "space-between" }}>
          <div>
            backend:{" "}
            <span className="tag" style={{ color: online ? "var(--good)" : "var(--bad)" }}>
              {restarting ? "restarting…" : online ? "online" : "offline"}
            </span>
          </div>
          <div className="row" style={{ flex: "0 0 auto", gap: 6 }}>
            <button onClick={restart} disabled={!online || restarting}>↻ Restart</button>
          </div>
        </div>

        {!online && (
          <div className="banner">
            <div>Backend is offline. Start it in a terminal:</div>
            <code className="cmd">{START_CMD}</code>
            <button onClick={() => navigator.clipboard?.writeText(START_CMD)}>Copy command</button>
          </div>
        )}

        {online && s && (
          <>
            <h2>Providers</h2>
            <div className="grid2">
              <Field label="image">
                <select value={s.image_provider} onChange={(e) => set("image_provider", e.target.value)}>
                  <option value="mock">mock</option>
                  <option value="comfyui">comfyui</option>
                </select>
              </Field>
              <Field label="upscale">
                <select value={s.upscale_provider} onChange={(e) => set("upscale_provider", e.target.value)}>
                  <option value="mock">mock</option>
                  <option value="comfyui">comfyui</option>
                </select>
              </Field>
              <Field label="video">
                <select value={s.video_provider} onChange={(e) => set("video_provider", e.target.value)}>
                  <option value="mock">mock</option>
                  <option value="comfyui">comfyui</option>
                </select>
              </Field>
              <Field label="llm (intelligence)">
                <select value={s.llm_provider} onChange={(e) => set("llm_provider", e.target.value)}>
                  <option value="mock">mock</option>
                  <option value="openrouter">openrouter</option>
                </select>
              </Field>
            </div>

            <h2>ComfyUI</h2>
            <Field label="url">
              <input value={s.comfyui_url} onChange={(e) => set("comfyui_url", e.target.value)} />
            </Field>
            <div className="muted" style={{ marginTop: 4 }}>
              {comfy?.online
                ? `online · ${comfy.checkpoints.length} checkpoint(s), ${comfy.upscale_models.length} upscale model(s)`
                : "not reachable at this URL"}
            </div>
            <Field label="default upscale model (ESRGAN)">
              {comfy && comfy.upscale_models.length > 0 ? (
                <select value={s.upscale_model} onChange={(e) => set("upscale_model", e.target.value)}>
                  <option value="">— workflow default —</option>
                  {comfy.upscale_models.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={s.upscale_model}
                  placeholder="none installed — drop one in ComfyUI/models/upscale_models"
                  onChange={(e) => set("upscale_model", e.target.value)}
                />
              )}
            </Field>

            <h2>Workflows (ComfyUI templates)</h2>
            <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>
              Drop a ComfyUI <b>API-format</b> export into{" "}
              <code>backend/app/providers/workflows/</code> and pick it here. The app writes
              prompt/seed/size/start-end into nodes it recognises by title, input name, or type —
              it never rewires your graph. Name key nodes (e.g. <code>seed</code>,{" "}
              <code>start_image</code>) to help auto-detection.
            </div>
            <div className="stack" style={{ gap: 8 }}>
              {wfPicker("image (keyframes)", "workflow_image", "image")}
              {wfPicker("loop (idle clip)", "workflow_loop", "video")}
              {wfPicker("transition (A→B clip)", "workflow_transition", "video")}
            </div>

            <h2>OpenRouter (prompt expand + AI triage)</h2>
            <Field label="base url">
              <input value={s.openrouter_base_url} onChange={(e) => set("openrouter_base_url", e.target.value)} />
            </Field>
            <Field label="api key">
              <input
                type="password"
                value={s.openrouter_api_key}
                placeholder="sk-or-..."
                onChange={(e) => set("openrouter_api_key", e.target.value)}
              />
            </Field>
            <div className="grid2">
              <Field label="text model">
                <input value={s.llm_text_model} onChange={(e) => set("llm_text_model", e.target.value)} />
              </Field>
              <Field label="vision model (triage)">
                <input value={s.llm_vision_model} onChange={(e) => set("llm_vision_model", e.target.value)} />
              </Field>
            </div>
            <Field label="triage / scoring prompt — sent to the vision model">
              <textarea
                rows={5}
                value={s.llm_triage_prompt}
                onChange={(e) => set("llm_triage_prompt", e.target.value)}
              />
            </Field>
            <div className="muted" style={{ marginTop: 4, fontSize: 11 }}>
              Must instruct the model to return JSON with at least <code>overall</code> (0–1) and{" "}
              <code>verdict</code> — those drive the gallery score &amp; sort. Keep the JSON keys or scores fall back to 0.5.
            </div>
            <Field label="prompt-expand instructions — sent to the text model">
              <textarea
                rows={3}
                value={s.llm_expand_prompt}
                onChange={(e) => set("llm_expand_prompt", e.target.value)}
              />
            </Field>
            <div className="row" style={{ marginTop: 8 }}>
              <button onClick={runTest} disabled={busy}>Test LLM</button>
              {test && (
                <span className="muted" style={{ flex: 2 }}>
                  {test.ok ? `✓ ${test.provider}/${test.model}: ${test.sample}` : `✕ ${test.error}`}
                </span>
              )}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <button className="primary" onClick={save} disabled={busy}>
                {busy ? "Saving…" : saved ? "Saved ✓" : "Save settings"}
              </button>
              <button onClick={onClose}>Cancel</button>
            </div>
            <div className="muted" style={{ marginTop: 6, fontSize: 11 }}>
              Provider/model changes apply live — no restart needed.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
