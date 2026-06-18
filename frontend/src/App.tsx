import { useEffect, useState } from "react";
import { ReactFlowProvider } from "reactflow";
import { api } from "./api";
import GraphCanvas from "./GraphCanvas";
import Inspector from "./Inspector";
import Player from "./Player";
import Settings from "./Settings";
import TriageGallery from "./TriageGallery";
import { useStore } from "./store";
import type { Project, ProviderStatus } from "./types";

type Mode = "editor" | "player";

export default function App() {
  const { projectId, graphId, graphs, graph, setProject, setGraph, refresh } = useStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [scenario, setScenario] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<Mode>("editor");

  const loadProjects = async () => setProjects(await api.listProjects());
  const loadProviders = () => api.providers().then(setProviders).catch(() => setProviders(null));

  useEffect(() => {
    loadProjects();
    loadProviders();
  }, []);

  const newProject = async () => {
    const name = prompt("Project name?");
    if (!name) return;
    const p = await api.createProject(name);
    await api.createGraph(p.id, "Main"); // start every project with one scene
    await loadProjects();
    await setProject(p.id);
  };

  const newGraph = async () => {
    if (!projectId) return;
    const name = prompt("Graph (scene) name?", "Scene");
    if (!name) return;
    const g = await api.createGraph(projectId, name);
    await refresh();
    await setGraph(g.id);
  };

  const renameGraph = async (gid: string, current: string) => {
    const name = prompt("Rename graph", current);
    if (!name || name === current) return;
    await api.renameGraph(gid, { name });
    await refresh();
  };

  const removeGraph = async (gid: string) => {
    if (!projectId) return;
    if (!confirm("Delete this graph and all its nodes/edges?")) return;
    await api.deleteGraph(gid);
    await setProject(projectId); // reload graphs and select the first remaining
  };

  const importScenario = async () => {
    if (!graphId || !scenario.trim()) return;
    await api.scenario(graphId, scenario);
    await refresh();
  };

  const addNode = async () => {
    if (!graphId) return;
    const key = prompt("Node key (e.g. idle_campfire)?");
    if (!key) return;
    await api.createNode(graphId, { key, title: key, x: 200, y: 200, prompt: key });
    await refresh();
  };

  const addCharacter = async () => {
    if (!projectId) return;
    const name = prompt("Character name?");
    if (!name) return;
    const description = prompt("Appearance description (consistency anchor):") || "";
    await api.createCharacter(projectId, { name, description });
    await refresh();
  };

  return (
    <div className="app">
      <div className="sidebar">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>anim-pipe</strong>
          <div className="row" style={{ flex: "0 0 auto", gap: 6 }}>
            <button onClick={() => setShowSettings(true)} title="Settings">⚙</button>
            <button onClick={newProject}>+ New</button>
          </div>
        </div>

        {graph && (
          <div className="modeToggle">
            <button className={mode === "editor" ? "on" : ""} onClick={() => setMode("editor")}>
              Editor
            </button>
            <button className={mode === "player" ? "on" : ""} onClick={() => setMode("player")}>
              Player
            </button>
          </div>
        )}

        <h2>Projects</h2>
        <div className="stack">
          {projects.map((p) => (
            <div
              key={p.id}
              className={`proj ${p.id === projectId ? "active" : ""}`}
              onClick={() => setProject(p.id)}
            >
              {p.name}
            </div>
          ))}
          {projects.length === 0 && <span className="muted">No projects yet.</span>}
        </div>

        {projectId && (
          <>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: "14px 0 6px" }}>Graphs (scenes)</h2>
              <button style={{ flex: "0 0 auto" }} onClick={newGraph}>+ New</button>
            </div>
            <div className="stack">
              {graphs.map((g) => (
                <div
                  key={g.id}
                  className={`proj ${g.id === graphId ? "active" : ""}`}
                  onClick={() => setGraph(g.id)}
                >
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <span>{g.name}</span>
                    <span className="muted" style={{ flex: "0 0 auto", fontSize: 11 }}>
                      {g.node_count}n · {g.edge_count}e
                    </span>
                  </div>
                </div>
              ))}
              {graphs.length === 0 && <span className="muted">No graphs yet — add one.</span>}
            </div>
            {graphId && (
              <div className="row" style={{ marginTop: 6 }}>
                <button onClick={() => {
                  const g = graphs.find((x) => x.id === graphId);
                  if (g) renameGraph(g.id, g.name);
                }}>Rename</button>
                <button className="danger" onClick={() => removeGraph(graphId)}>Delete</button>
              </div>
            )}
          </>
        )}

        {graph && (
          <>
            <h2>Active graph</h2>
            <div className="stack">
              <button onClick={addNode}>+ Add node</button>
              <button onClick={addCharacter}>+ Add character</button>
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              {graph.nodes.length} nodes · {graph.edges.length} edges · {graph.characters.length} chars
            </div>

            <h2>Scenario → graph</h2>
            <textarea
              rows={5}
              placeholder="One beat per line; the LLM builds nodes + idle loops + transitions."
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
            />
            <button style={{ marginTop: 6 }} onClick={importScenario}>Build graph</button>
          </>
        )}

        {providers && (
          <>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: "14px 0 6px" }}>Backends</h2>
              <button style={{ flex: "0 0 auto" }} onClick={() => setShowSettings(true)}>edit</button>
            </div>
            <div className="muted stack" style={{ gap: 2 }}>
              <div>image: <span className="tag">{providers.image}</span></div>
              <div>upscale: <span className="tag">{providers.upscale}</span></div>
              <div>video: <span className="tag">{providers.video}</span></div>
              <div>llm: <span className="tag">{providers.llm}</span></div>
              <div>comfyui: {providers.comfyui_url}</div>
              <div>openrouter: {providers.openrouter_configured ? "configured" : "—"}</div>
            </div>
          </>
        )}
      </div>

      <div className="canvas">
        {graph ? (
          mode === "player" ? (
            <Player graph={graph} />
          ) : (
            <ReactFlowProvider>
              <GraphCanvas />
            </ReactFlowProvider>
          )
        ) : (
          <div className="muted" style={{ padding: 24 }}>
            {projectId
              ? "Create or select a graph (scene) to start building."
              : "Create or select a project to start building your animation graph."}
          </div>
        )}
      </div>

      {mode === "editor" && (
        <>
          <Inspector />
          <TriageGallery />
        </>
      )}
      {showSettings && (
        <Settings onClose={() => setShowSettings(false)} onSaved={loadProviders} />
      )}
    </div>
  );
}
