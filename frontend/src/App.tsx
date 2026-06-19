import { useEffect, useState } from "react";
import { DialogHost } from "./dialogs";
import Inspector from "./Inspector";
import Player from "./Player";
import SceneGraph from "./SceneGraph";
import Settings from "./Settings";
import Sidebar from "./Sidebar";
import TriageGallery from "./TriageGallery";
import { useStore } from "./store";

type Mode = "editor" | "player";

export default function App() {
  const { graph, loadProjects } = useStore();
  const [showSettings, setShowSettings] = useState(false);
  const [mode, setMode] = useState<Mode>("editor");

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  return (
    <div className={`app ${mode}`}>
      <Sidebar mode={mode} setMode={setMode} onOpenSettings={() => setShowSettings(true)} />

      <div className="canvas">
        {graph ? (
          mode === "player" ? (
            <Player graph={graph} />
          ) : (
            <SceneGraph mode="editor" />
          )
        ) : (
          <div className="muted" style={{ padding: 24 }}>
            Create or select a project, then a scene, to start building your animation graph.
          </div>
        )}
      </div>

      {mode === "editor" && (
        <>
          <Inspector />
          <TriageGallery />
        </>
      )}
      {showSettings && <Settings onClose={() => setShowSettings(false)} onSaved={() => {}} />}
      <DialogHost />
    </div>
  );
}
