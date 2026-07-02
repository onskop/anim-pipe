/* Left rail: project switcher (dropdown) · scenes · characters library ·
   status footer. Replaces the old crammed sidebar; uses the dialog layer
   instead of browser prompt()/confirm(). */
import { useEffect, useRef, useState } from "react";
import { api, fileUrl, waitJob } from "./api";
import { dialog } from "./dialogs";
import { useStore } from "./store";
import type { GraphInfo, ProviderStatus } from "./types";

/* ---------- project switcher (dropdown + actions) ---------- */
function ProjectSwitcher() {
  const { projects, projectId, setProject, loadProjects } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const active = projects.find((p) => p.id === projectId);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const newProject = async () => {
    const name = await dialog.prompt({
      title: "New project", label: "Project name", placeholder: "Wandering Hero",
    });
    if (!name) return;
    const p = await api.createProject(name);
    await api.createGraph(p.id, "Main"); // every project starts with one scene
    await loadProjects();
    await setProject(p.id);
    setOpen(false);
  };

  const renameProject = async () => {
    if (!active) return;
    const name = await dialog.prompt({ title: "Rename project", defaultValue: active.name });
    if (!name || name === active.name) return;
    await api.updateProject(active.id, { name });
    await loadProjects();
  };

  const deleteProject = async () => {
    if (!active) return;
    const ok = await dialog.confirm({
      title: `Delete “${active.name}”?`,
      message: "Removes its scenes, nodes, edges, characters and all generated assets.",
      danger: true, confirmText: "Delete project",
    });
    if (!ok) return;
    await api.deleteProject(active.id);
    setOpen(false);
    await loadProjects();
    const rest = useStore.getState().projects;
    if (rest[0]) await setProject(rest[0].id);
    else useStore.setState({ projectId: null, graph: null, graphs: [], selection: null });
    dialog.toast("Project deleted");
  };

  return (
    <div className="dropdown" ref={ref}>
      <button className="ddTrigger" onClick={() => setOpen((o) => !o)}>
        <span className="ddTriggerLabel">{active ? active.name : "Select project…"}</span>
        <span className="muted">▾</span>
      </button>
      {open && (
        <div className="ddMenu">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`ddItem ${p.id === projectId ? "active" : ""}`}
              onClick={() => { setProject(p.id); setOpen(false); }}
            >
              {p.name}
            </div>
          ))}
          {projects.length === 0 && <div className="ddItem muted">No projects yet</div>}
          <div className="ddSep" />
          <div className="ddItem" onClick={newProject}>+ New project…</div>
          {active && <div className="ddItem" onClick={renameProject}>✎ Rename “{active.name}”</div>}
          {active && <div className="ddItem danger" onClick={deleteProject}>🗑 Delete “{active.name}”</div>}
        </div>
      )}
    </div>
  );
}

/* ---------- scenes (graphs) ---------- */
function SceneList() {
  const { graphs, graphId, projectId, setGraph, setProject, refresh } = useStore();
  const [showScenario, setShowScenario] = useState(false);
  const [scenario, setScenario] = useState("");
  const active = graphs.find((g) => g.id === graphId);

  const newScene = async () => {
    if (!projectId) return;
    const name = await dialog.prompt({ title: "New scene", label: "Scene name", defaultValue: "Scene" });
    if (!name) return;
    const g = await api.createGraph(projectId, name);
    await refresh();
    await setGraph(g.id);
  };

  const renameScene = async (g: GraphInfo) => {
    const name = await dialog.prompt({ title: "Rename scene", defaultValue: g.name });
    if (!name || name === g.name) return;
    await api.renameGraph(g.id, { name });
    await refresh();
  };

  const deleteScene = async (g: GraphInfo) => {
    if (!projectId) return;
    const ok = await dialog.confirm({
      title: `Delete scene “${g.name}”?`,
      message: "Deletes its nodes and edges.", danger: true, confirmText: "Delete scene",
    });
    if (!ok) return;
    await api.deleteGraph(g.id);
    await setProject(projectId); // reload + select first remaining
  };

  const addNode = async () => {
    if (!graphId) return;
    const key = await dialog.prompt({
      title: "New node (keyframe)", label: "Node key — the stable game id", placeholder: "idle_campfire",
    });
    if (!key) return;
    await api.createNode(graphId, { key, title: key, x: 120, y: 120, prompt: key });
    await refresh();
  };

  const buildGraph = async () => {
    if (!graphId || !scenario.trim()) return;
    await api.scenario(graphId, scenario);
    setScenario("");
    setShowScenario(false);
    await refresh();
  };

  return (
    <div className="railSection">
      <div className="railHead">
        <h3>Scenes</h3>
        <button className="iconBtn" onClick={newScene}>+ New</button>
      </div>
      <div className="sceneList">
        {graphs.map((g) => (
          <div
            key={g.id}
            className={`sceneCard ${g.id === graphId ? "active" : ""}`}
            onClick={() => setGraph(g.id)}
          >
            <span className="sceneName">{g.name}</span>
            <span className="sceneMeta muted">{g.node_count}n · {g.edge_count}e</span>
            <span className="sceneActions">
              <button title="Rename" onClick={(e) => { e.stopPropagation(); renameScene(g); }}>✎</button>
              <button className="danger" title="Delete" onClick={(e) => { e.stopPropagation(); deleteScene(g); }}>🗑</button>
            </span>
          </div>
        ))}
        {graphs.length === 0 && <span className="muted">No scenes yet.</span>}
      </div>

      {active && (
        <>
          <div className="railDivider" />
          <div className="row" style={{ gap: 6 }}>
            <button onClick={addNode} style={{ flex: 1 }}>+ Node</button>
            <button
              className={showScenario ? "on" : ""}
              onClick={() => setShowScenario((s) => !s)}
              style={{ flex: 1 }}
            >
              ✨ Scenario
            </button>
          </div>
          <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>
            …or double-click the canvas to add a node.
          </div>
          {showScenario && (
            <div className="stack" style={{ marginTop: 8 }}>
              <textarea
                rows={4}
                placeholder="One beat per line; the LLM builds nodes + idle loops + transitions."
                value={scenario}
                onChange={(e) => setScenario(e.target.value)}
              />
              <button onClick={buildGraph} disabled={!scenario.trim()}>Build into scene</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ---------- characters library ---------- */
function CharacterList() {
  const { graph, selection, select, refresh } = useStore();
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const chars = graph?.characters ?? [];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      for (const c of chars) {
        const id = c.ref_image_ids[0];
        if (!id) continue;
        try {
          const a = await api.asset(id);
          next[c.id] = fileUrl(a.thumb_path || a.path);
        } catch {
          /* ignore */
        }
      }
      if (!cancelled) setAvatars(next);
    })();
    return () => { cancelled = true; };
  }, [graph]);

  const newChar = async () => {
    if (!graph) return;
    const name = await dialog.prompt({
      title: "New character", label: "Character name", placeholder: "Anna",
    });
    if (!name) return;
    const c = await api.createCharacter(graph.project.id, { name });
    await refresh();
    select({ type: "character", id: c.id });
  };

  if (!graph) return null;
  return (
    <div className="railSection">
      <div className="railHead">
        <h3>Characters</h3>
        <button className="iconBtn" onClick={newChar}>+ New</button>
      </div>
      <div className="charList">
        {chars.map((c) => (
          <div
            key={c.id}
            className={`charCard ${selection?.type === "character" && selection.id === c.id ? "active" : ""}`}
            onClick={() => select({ type: "character", id: c.id })}
          >
            {avatars[c.id] ? (
              <img className="charAvatar" src={avatars[c.id]} alt="" />
            ) : (
              <div className="charAvatar empty">{c.name.slice(0, 1).toUpperCase()}</div>
            )}
            <span className="charName">{c.name}</span>
          </div>
        ))}
        {chars.length === 0 && <span className="muted">No characters yet.</span>}
      </div>
    </div>
  );
}

/* ---------- ship: game bundle export ---------- */
function ExportSection() {
  const { projectId } = useStore();
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState(0);

  const doExport = async () => {
    if (!projectId || busy) return;
    setBusy(true);
    setProg(0);
    try {
      const job = await api.exportProject(projectId);
      const done = await waitJob(job.id, setProg);
      if (done.status === "error") {
        dialog.toast(`Export failed: ${done.error}`, "error");
      } else {
        const out = done.params?.output as string | undefined;
        if (out) window.open(`/api/exports/${out}`, "_blank");
        dialog.toast("Bundle exported ✓", "success");
      }
    } catch (e) {
      dialog.toast(`Export failed: ${e}`, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!projectId) return null;
  return (
    <div className="railSection">
      <div className="railHead"><h3>Ship</h3></div>
      <button onClick={doExport} disabled={busy}>
        {busy ? `Exporting… ${Math.round(prog * 100)}%` : "⇪ Export game bundle"}
      </button>
      <div className="muted" style={{ fontSize: 11 }}>
        WebP/WebM keepers + graph.json + a playable reference runtime + the
        agent compile pack, zipped.
      </div>
    </div>
  );
}

/* ---------- compact status footer ---------- */
function StatusFooter({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const load = () => {
      api.health().then(setOnline);
      api.providers().then(setProviders).catch(() => setProviders(null));
    };
    load();
    const t = window.setInterval(load, 5000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="statusFooter" onClick={onOpenSettings} title="Open settings">
      <span className={`statusDot ${online ? "ok" : "bad"}`} />
      <span className="muted">{online ? "backend" : "offline"}</span>
      {providers && <span className="tag">img:{providers.image}</span>}
      {providers && <span className="tag">vid:{providers.video}</span>}
      <span className="muted" style={{ marginLeft: "auto" }}>⚙</span>
    </div>
  );
}

/* ---------- composed rail ---------- */
export default function Sidebar({
  mode,
  setMode,
  onOpenSettings,
}: {
  mode: "editor" | "player";
  setMode: (m: "editor" | "player") => void;
  onOpenSettings: () => void;
}) {
  const { projectId, graph } = useStore();
  return (
    <div className="sidebar">
      <div className="sidebarScroll">
        <div className="brand">
          <strong>anim-pipe</strong>
          <button className="iconBtn" title="Settings" onClick={onOpenSettings}>⚙</button>
        </div>

        {graph && (
          <div className="modeToggle">
            <button className={mode === "editor" ? "on" : ""} onClick={() => setMode("editor")}>Editor</button>
            <button className={mode === "player" ? "on" : ""} onClick={() => setMode("player")}>Player</button>
          </div>
        )}

        <ProjectSwitcher />
        {projectId && <SceneList />}
        {projectId && <CharacterList />}
        <ExportSection />
      </div>
      <StatusFooter onOpenSettings={onOpenSettings} />
    </div>
  );
}
