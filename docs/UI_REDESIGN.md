# anim-pipe UI — requirements & decisions log

> Living doc. We review the current UI one area at a time and capture the **good
> ideas + hard requirements** here, so a future rebuild (full or partial) starts
> from a clean spec instead of half-finished patches. Nothing here is built yet
> unless marked ✅. Started 2026-06-18.

## 0. Keep vs rebuild (assessment)

**Solid — keep:** FastAPI backend + data model, content-addressed storage,
generation pipeline, player engine (`engine/`), `GraphCanvas` (React Flow),
`TriageGallery` internals, the per-field logic inside `Inspector`.

**Weak — rebuild:** the **app shell / information architecture** — everything is
crammed into one 230 px left rail (`App.tsx`); browser-native `prompt()` /
`confirm()` / `alert()` dialogs; always-on clutter (scenario box + Backends
status block) competing for the same narrow column.

**Recommendation:** re-architect the **shell + dialog system** (split `App.tsx`
into `Sidebar` → `ProjectSwitcher` / `SceneList` / `CharacterList` /
`StatusFooter`, plus a real modal/toast layer). Do **not** greenfield the
engine/backend/canvas/triage — the good parts survive. This is a contained,
high-leverage refactor, not a rewrite.

## 1. Target information architecture

Three panes, rebalanced:

- **LEFT RAIL (~260–280 px, ideally resizable)** — project context + libraries:
  1. Brand + global actions (Settings, New project) — compact header.
  2. Editor / Player segmented toggle.
  3. **Project switcher = dropdown** (active shown; menu lists others + "New
     project…" + manage). Not a flat always-expanded list.
  4. **Scenes (graphs):** card list, active highlighted, n/e counts; row actions
     (rename/delete) as small hover icons or a `⋯` kebab — never big full-width
     buttons. "+ New scene" small in the section header.
  5. **Characters library** (project-scoped): card list with avatar (ref-image
     thumb) + name; click → edit on the right. "+ New character" inline.
  6. **Status footer** pinned to the bottom: compact provider/connection pills
     (e.g. `ComfyUI ●`), click → Settings. Replaces the verbose Backends block.
- **CENTER:** canvas (graph) / player stage. Unchanged.
- **RIGHT:** contextual editor — edits **and assigns** the selected node / edge /
  character. The single edit surface.

## 2. Per-area requirements (from review on 2026-06-18)

### Projects
- **Now:** flat clickable list; no delete in UI; two junk test projects
  (duplicate "regen-check"); created via `prompt()`.
- **Want:** dropdown selector; create via modal/inline form; rename; **delete**
  with a cascade confirmation. Disambiguate same-named projects (show created
  date or a hint).
- **Backend gap:** `DELETE /projects/{pid}` exists but only ORM-cascades
  characters/graphs/nodes/edges — it **leaks that project's Assets + files**
  (SQLite FKs unenforced). Fix delete to also remove the project's assets and
  unreference/unlink files (mirror `delete_asset`'s share-safe unlink).

### Scenes (graphs)
- **Now:** card + two big full-width Rename/Delete buttons that dwarf the card;
  scenario box always visible below.
- **Want:** the card is the primary affordance; rename/delete shrink to icon /
  kebab actions; a **visual separator** between the scene *list* and the
  *active-scene* controls (add node, counts). Scenario generator moves here as an
  **opt-in** (revealed by "+ New scene", or a per-scene "generate/expand"), not
  perma-visible.

### Nodes
- **Now:** created via `prompt()` for the key.
- **Want:** create by **double-clicking the canvas** at the cursor (sets node
  position) → inline name; or a small modal (key / title / character). Inline
  rename on the node card. No browser prompts.

### Characters
- **Now:** only reachable by selecting a node; editor lives in the right
  Inspector; created via two chained `prompt()`s.
- **Want:** first-class **Characters library in the left rail** (project-scoped);
  avatar = first ref image (or a node that uses it); click → edit/define on the
  right; assign-to-node still on the node editor (right). Create via inline
  form/modal.

### Settings / backends
- **Now:** Settings modal (fine) **plus** an always-on "Backends" status block on
  the rail.
- **Want:** keep Settings as a modal (or a left entry); **remove the perma
  Backends block**; surface connection state as the compact footer indicator;
  full provider config stays in Settings.

### Dialog system (cross-cutting)
- Replace **all** `prompt()` / `confirm()` / `alert()` with in-app modals +
  inline edits + toasts. (`EditModal`, `Inspector`, `TriageGallery` all use
  `alert()` today.)

### Scene graph — editor canvas (`GraphCanvas`)
- **Now:** custom `KeyframeNode` (thumb + label) on React Flow; edges use the
  default renderer.
- **Cropped keyframes:** `.gnode .thumb` is `object-fit: cover` @ fixed 96 px →
  non-square images get center-cropped (head/legs cut off). **Want:**
  `object-fit: contain` (whole image, smaller is fine), letterboxed on the dark
  bg. Consider an aspect-aware thumb box.
- **Self-loops invisible:** a `loop` edge has source==target, so React Flow's
  default edge collapses to a stub handle — the loop isn't drawn. **Want:** a
  custom `selfloop` edge type drawing a real arc/teardrop out of and back into
  the node, label on the arc, returning arrowhead (port anna `GraphViz.loopPath`
  concept onto a React Flow edge).
- **Edge visual language:** transition = directed blue, idle-loop = orange arc,
  (later, Phase 3) interaction = dashed amber. Keep the animated flow-dots when a
  clip is selected.

### Player — live graph view
- **Now:** text-only HUD (node/edge/progress/queue) + event log. No graph.
- **Want:** a live graph showing the whole scene, **active edge highlighted** and
  a **progress marker riding along it** (loops as arcs) — "where the scene is and
  how it's playing out." This is anna's old `GraphViz`, which we removed. The
  Player already has the inputs: `snap.edge` + `progress`.

### ★ Unify: one `SceneGraph`, two modes
- Build a single `SceneGraph` component used by **both** editor and player
  (nodes already persist `x/y`, so the player reuses the editor layout). A prop
  switches: editor = interactive (drag/connect/select); player = read-only with
  active-edge highlight + progress marker. One renderer, identical look, no drift.
  The full-image + self-loop fixes then benefit both views at once.

## 3. Good-ideas backlog (not yet committed)

- Resizable left rail; collapsible sections so long lists don't fight for space.
- One shared "list row / card" component reused by project, scene, character.
- Node creation on canvas double-click with live position.
- Inline rename everywhere (double-click label → input; Esc/Enter).
- Character avatar derived from a ref image or a node using it.
- Toasts for async results (replace `alert`).
- Friendly empty states with a single primary CTA.
- Keyboard: delete-selected, F2 rename (later).

## 5. Implemented — shell refactor (2026-06-18)

First pass of the shell-only refactor landed (tsc + vite build clean; new backend
routes verified via TestClient). Files: `dialogs.tsx`, `Sidebar.tsx`,
`SceneGraph.tsx`, `CharacterEditor.tsx`; `App.tsx` slimmed; `GraphCanvas.tsx`
removed. Iterate from here.

- ✅ Dialog/toast layer (`dialog.prompt/confirm/toast` + `DialogHost`); all
  `prompt()/confirm()/alert()` removed from App/Inspector/EditModal/TriageGallery.
- ✅ Project switcher dropdown with new/rename/delete (backend `PATCH /projects`
  added; delete now wired in the client + cleans assets/files).
- ✅ Scenes: card list with hover ✎/🗑 actions, divider, `+ Node`, scenario
  generator behind a `✨ Scenario` toggle (no longer perma-visible).
- ✅ Characters library in the left rail (avatar + name); selecting one edits it
  on the right (`CharacterEditor`, extracted); `DELETE /characters/{cid}` added.
- ✅ Status footer (online dot + img/vid pills → Settings); perma "Backends"
  block gone.
- ✅ Unified `SceneGraph` (editor interactive / player read-only). Node images
  `object-fit: contain` (whole image). Custom self-loop edge draws a real arc.
  Player shows active-edge highlight + progress dot riding the path (replaces the
  old text-only HUD-only view); double-click canvas adds a node at the cursor.

### Iteration 2–3 (2026-06-18)
- ✅ Self-loops anchor above the node (live geometry), stack into tiers; wider
  gaps. Nodes draggable (was controlled w/o `onNodesChange`).
- ✅ Edges selectable + renamable: edge label is clickable (select) and
  double-click renames (`api.updateEdge`).
- ✅ Node cards show **resource count + completeness** (✓ has keyframe / ! none) —
  backend `asset_count` added to NodeOut/EdgeOut.
- ✅ **Right panel slimmed to a summary**: node = key + character *selector* only
  (no repeated character editor — that's the left library), a resources tray to
  quick-select, and an **Edit & generate** button. Edge = rename + motion mask +
  tray + Edit button. Prompt/negative/generation params removed from the panel.
- ✅ **Editor modal is now the main interface**: positive/negative prompt,
  generation params + Generate, and the candidate grid (use/star/delete/score/
  more/edit/upscale/copy) all live there.
- ✅ **Generation/LLM feedback**: toasts on Generate/Expand start+finish, a
  spinner banner while a job runs, and a spinner state on the Expand button.

**Not done / next iteration:** resizable rail; inline rename on double-click for
nodes/projects/scenes (still prompt-modal); richer player layout (graph is a
small side panel); interaction/auto edge visual language (waits on Phase 3);
"top N by score" auto-surfacing in the inspector tray (currently shows
accepted/starred/active).

## 4. Decisions

- [x] **Shell-only refactor** chosen (2026-06-18) — rebuild App shell + dialogs,
      keep backend/engine/canvas/triage.
- [x] Leftover `regen-check` test projects: **leave for now**, clean up as part of
      fixing project-delete (assets + files) in the UI.
- [ ] Project selector style: dropdown vs modal "project manager".
- [ ] Scenario generation home: new-scene form vs per-scene action vs both.
