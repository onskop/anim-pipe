import { useEffect, useState } from "react";
import { ReactFlowProvider } from "reactflow";
import { api } from "./api";
import GraphCanvas from "./GraphCanvas";
import Inspector from "./Inspector";
import TriageGallery from "./TriageGallery";
import { useStore } from "./store";
import type { Project, ProviderStatus } from "./types";

export default function App() {
  const { projectId, graph, setProject, refresh } = useStore();
  const [projects, setProjects] = useState<Project[]>([]);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [scenario, setScenario] = useState("");

  const loadProjects = async () => setProjects(await api.listProjects());

  useEffect(() => {
    loadProjects();
    api.providers().then(setProviders);
  }, []);

  const newProject = async () => {
    const name = prompt("Project name?");
    if (!name) return;
    const p = await api.createProject(name);
    await loadProjects();
    await setProject(p.id);
  };

  const importScenario = async () => {
    if (!projectId || !scenario.trim()) return;
    await api.scenario(projectId, scenario);
    await refresh();
  };

  const addNode = async () => {
    if (!projectId) return;
    const key = prompt("Node key (e.g. idle_campfire)?");
    if (!key) return;
    await api.createNode(projectId, { key, title: key, x: 200, y: 200, prompt: key });
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
          <button onClick={newProject}>+ New</button>
        </div>

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

        {graph && (
          <>
            <h2>Graph</h2>
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
            <h2>Backends</h2>
            <div className="muted stack" style={{ gap: 2 }}>
              <div>image: <span className="tag">{providers.image}</span></div>
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
          <ReactFlowProvider>
            <GraphCanvas />
          </ReactFlowProvider>
        ) : (
          <div className="muted" style={{ padding: 24 }}>
            Create or select a project to start building your animation graph.
          </div>
        )}
      </div>

      <Inspector />
      <TriageGallery />
    </div>
  );
}
