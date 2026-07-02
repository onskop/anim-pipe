# Story Studio — functional design

> Full functional design for the next-generation app, distilled from everything
> that works (and doesn't) in the current anim-pipe codebase. This is the spec a
> rebuild starts from. Written 2026-07-02.

---

## 1. Product vision

**One studio that takes a story idea to a playable adventure:** you write or
generate a story graph (adventure-style walkthrough), produce the key images
(nodes) and transition/idle videos (edges) with AI generation, triage and edit
them in the browser until every piece is a keeper, wire up simple interaction
logic, test-play it inside the editor, and finally export a **game bundle** that
an agent compiles ("vibecodes") into the polished final game.

Three pillars, in the user's words:

1. **Generation & triage** — generate, evaluate, and edit images and videos,
   with every easily-implementable win from real practice baked in (browser
   scope; not pro NLE software).
2. **Graph building & management** — the story is a graph; the graph is the UI.
3. **Play & ship** — a simplified in-editor runtime for testing, and a
   compile-style export where an agent takes the resource template (images,
   videos, graph, instructions) and builds the final polished game instance.

Not goals: multiplayer, cloud collaboration, a full game engine inside the
editor, professional video editing (keyframed timelines, color grading suites).

---

## 2. What the current repo got right (keep these ideas)

Extracted from the code, docs, and commit history. These survive the rebuild as
*requirements*, regardless of how much code survives.

### 2.1 Core model
- **Story = graph; nodes = canonical keyframe images (stable states); edges =
  short clips.** Two edge asset kinds: **idle loops** (source==target, first
  frame == last frame for seamless cycling) and **transitions** (A→B clip
  conditioned on both endpoint keyframes). This maps 1:1 to how the game plays
  and to how the assets are generated. It's the heart of the product.
- **Multiple scenes (sub-graphs) per project**, each with a start node;
  characters and variables shared at project level.
- **Character as a first-class consistency anchor**: description fragment
  injected into every prompt + reference images + (provider-specific) identity
  tools (LoRA / IP-Adapter / reference-conditioning). Consistency is a *stack*,
  not one trick.
- **Layered prompt assembly**: `[character anchor] + [node/edge prompt] +
  [project style preset]` with `{variable}` substitution from a project bag, so
  changing an outfit or lighting propagates everywhere.

### 2.2 Generation economics & reproducibility
- **Two-stage economy: generate cheap → triage → upscale only keepers.**
  Candidates are disposable; the keeper is sacred.
- **Full lineage on every asset**: prompt, seed, model, params,
  `parent_asset_id` (upscale/regen/edit source). Enables
  regenerate-with-tweaks, reproducibility, and audit of cost.
- **Content-addressed asset store** (dedupe by hash, share-safe delete).
- **Cost tracked per job/asset** (needs the dashboard it never got).
- **Async job queue with progress**, provider-agnostic.

### 2.3 Provider abstraction (the "swappable intelligence line")
- Neutral request types (`ImageRequest`, `VideoRequest`, `UpscaleRequest`,
  LLM ops) + a registry resolving adapters by config name. Mock adapter lets the
  entire app run and be tested with no GPU/keys. This is the single best
  architectural decision in the repo — keep it exactly.
- ComfyUI adapter's **workflow template + patch-map** pattern (API-format JSON +
  `field → [node, input]` map + optional-node splicing) — keep as the *local*
  adapter strategy for people with GPUs.
- **LLM line as a provider too**: prompt expansion, vision triage scoring,
  scenario→graph. Same swappability.

### 2.4 Craft knowledge (from PRACTICES.md — encode into features, not docs)
- Seamless loops: same frame as first AND last condition (`closed_loop`).
- **Cinemagraph principle**: motion masks — animate a region, freeze the rest.
  The mask painter exists and works; keep it.
- Subtle beats strong for idles: low motion scale, amplitude as a per-edge dial.
- Transitions conditioned on the two **locked** keyframes so motion stays
  on-model; build nodes first, then edges.
- Render low-res/low-fps for candidates; upscale keepers.

### 2.5 Player engine (ported from "anna" — genuinely good)
- **Headless walker**: pure functions decide *which* edge to traverse; the stage
  decides *when* (clip end / hold timeout). Framework-agnostic, testable.
- **Weighted-random idle roaming** + **interaction queue with shortest-path
  routing**: trigger an interaction anywhere and the walker routes through idle
  edges to the interaction's source node, then plays it. This is a small gem —
  it makes graphs feel alive with zero authoring effort.
- Graceful degradation: edge with no clip falls back to the destination still.
- The `EdgeType = idle | interaction | auto` shape with `trigger`, `weight`
  (and planned guards/effects) was already designed for the logic layer — the
  rebuild fills it in rather than inventing it.

### 2.6 UI lessons (from UI_REDESIGN.md iterations)
- Three-pane shell: left rail (project/scenes/characters/status), center canvas,
  right contextual inspector. Editor and player share **one** graph renderer
  (player = read-only + active-edge highlight + progress marker riding the
  path). Self-loops drawn as real arcs, tiered when stacked.
- **The generate-and-triage surface is a focused modal/workspace per node/edge**
  (prompts + params + candidate grid together), not scattered panels.
- Node cards show readiness (has keyframe ✓ / missing !) and asset counts —
  the graph doubles as a production checklist.
- In-app dialogs/toasts everywhere (no browser prompts); double-click canvas to
  create a node at the cursor; inline rename.
- Deterministic edit ops (crop/resize/trim/extract-frame via Pillow/ffmpeg) as
  cheap, lineage-tracked asset operations.

### 2.7 What was weak (fix in the rebuild)
- Polling for job status → needs push (SSE/WebSocket).
- Local-GPU-first (SD1.5/ComfyUI on 8 GB VRAM) made **video effectively
  impossible**; the video workflows were never real. The 2026 reality: cloud
  APIs (fal.ai / Replicate / Gemini / OpenAI images; Kling / Veo / Wan 2.5 /
  LTX-2 video with first/last-frame conditioning) make the whole pipeline
  practical with zero local GPU. **Cloud-first, local-optional.**
- Instruction-based image *editing* (nano-banana-class models) didn't exist in
  the design: deriving node B's keyframe by *editing* node A's keyframe ("same
  scene, but she's now sitting") is today the strongest consistency tool of all
  and must be first-class.
- No export, no runtime spec, no game output — the last mile was never built.
- Single 5k-line organically-grown frontend; rebuild the shell cleanly around
  the surviving concepts.

---

## 3. Domain model

```
Project
 ├─ settings: style preset, negative preset, variables{}, providers, budget
 ├─ Character[]        (name, anchor description, ref images, identity config)
 ├─ Scene[]            (a sub-graph: name, start_node_id)
 │   ├─ Node[]         (key, title, prompt, character_id?, selected_asset_id,
 │   │                  x, y, notes, on_enter_effects[], dialogue?)
 │   └─ Edge[]         (source, target, asset kind: loop|transition,
 │                      logic type: idle|choice|auto,
 │                      label, prompt, motion_mask_id?, selected_asset_id,
 │                      weight, trigger?, condition?, effects[], once?, notes)
 ├─ Asset[]            (kind image|video|mask|audio, status, path, sha256,
 │                      params/lineage, parent_asset_id, ai_score, cost)
 ├─ Job[]              (kind, provider, status, progress, cost, error)
 └─ Snapshot[]         (versioned graph.json checkpoints)
```

Two orthogonal classifications on an edge (the old code conflated them):

- **Asset kind** — what clip gets generated: `loop` (source==target) or
  `transition` (A→B). Purely a production concern.
- **Logic type** — how the runtime traverses it: `idle` (ambient,
  weighted-random), `choice` (player-triggered button), `auto` (fires when its
  condition becomes true). Purely a gameplay concern.

A `loop` is almost always `idle`; a `transition` can be any logic type.

### 3.1 Variables & logic (the declarative layer — see §7 for the decision)

- **Variables**: project-scoped typed bag — `number | bool | enum`. Declared
  with a default. Examples: `depth: number = 0`, `has_key: bool = false`.
- **Condition** (edge guard / choice visibility): conjunction/disjunction of
  simple comparisons — `depth >= 3 AND has_key == true`. No scripting language.
- **Effects** (on edge traversal or node enter): `set var = x`,
  `add var += x`, `roll var = random(a,b)`. Nothing else.
- **Choice metadata**: button label, optional `show_if` (hidden) vs `enabled_if`
  (greyed out), optional weight for AI/auto-play, `once` flag, cooldown.
- Everything serializes to plain JSON. The in-editor player interprets it; the
  compile agent receives it as an unambiguous machine-readable spec.

---

## 4. Feature areas

### A. Studio shell & project management
- Three panes: **left rail** (project switcher dropdown, scene list with
  readiness counts, character library with avatars, status footer with provider
  pills), **center** canvas/stage, **right** contextual inspector.
- Projects: create/rename/delete (cascade incl. assets/files), duplicate,
  import/export project archive (`.zip` of DB rows + assets).
- Settings: provider selection per capability (image / video / edit / upscale /
  llm), API keys, budget cap with warning, style & negative presets, ffmpeg
  path. Live provider swap, health checks, test buttons.
- Job center: global queue panel (running/queued/failed, progress bars, cancel,
  retry), push-updated (SSE). Cost dashboard: spend per project / scene / node /
  provider, candidates-vs-keepers ratio.

### B. Graph editor
- React-Flow-class canvas; **one `SceneGraph` renderer** shared with the player.
- Nodes: thumbnail of locked keyframe (contain, not crop), title, readiness
  badge (keyframe locked / candidates exist / empty), character chip.
- Edges: visual language — transition = directed solid, loop = arc above node
  (tiered), choice = labeled with a button glyph, auto = dashed, conditional =
  gate glyph; animated flow dots when a clip is locked.
- Editing: double-click canvas → new node at cursor; drag node→node → edge
  (drag onto itself → loop); inline rename; multi-select, delete, copy/paste
  nodes with prompts; auto-layout button; minimap; zoom-to-fit.
- **Validation overlay** (toggle): unreachable nodes, dead ends, nodes missing
  keyframes, edges missing clips, choices whose conditions can never be true,
  variables never set/read. The graph is the production checklist.
- **Scenario copilot** (LLM line): paste/write a scenario → draft graph
  (nodes+edges+prompts); per-node "expand prompt"; "suggest missing
  transitions/loops"; per-node dialogue bank generation. All drafts are
  editable, never auto-locked.
- Scene management: multiple scenes per project; **portal edges** (node →
  another scene's start) for chaptered stories; scene duplicate as template.
- **Snapshots**: one-click checkpoint of the whole graph (JSON), list + diff +
  restore. Cheap insurance for LLM-drafted rewrites.

### C. Generation studio (the per-node / per-edge workspace)
Opens as a focused workspace (modal or route) from a node/edge. Contains:

- **Prompt panel**: node/edge prompt, negative, live **assembled-prompt
  preview** (anchor + prompt + style after variable substitution), character
  selector, LLM expand button.
- **Params panel**: provider, model, size/duration, seed (lock / randomize /
  sweep), batch count `n`, guidance/steps where applicable, motion amplitude
  for video, cost estimate *before* generating.
- **Candidate grid** (the triage surface, see D).
- Generation paths for a **node keyframe**:
  1. *Text→image* (fresh).
  2. **Image-edit derive** — pick any existing keyframe (typically the
     neighbor node's locked keeper or the character sheet) + an edit
     instruction ("same framing, eyes closed, slumped in chair") → new
     candidates. This is the primary consistency tool; make it the default
     suggestion when a neighbor is already locked.
  3. *Upload* (external art) — enters the same lineage system.
- Generation paths for an **edge clip**:
  1. **Transition**: first frame = source keeper, last frame = target keeper
     (first/last-frame-conditioned video models); prompt describes the motion.
  2. **Loop**: first = last = the node's keeper; low motion amplitude default;
     optional **motion mask** (painter carried over) restricting animated
     region; ping-pong fallback toggle for models without loop closure.
  3. *Guard rails*: generating an edge clip requires locked endpoint
     keyframe(s); the UI offers to jump there if missing.
- Every generation lands as candidate assets with lineage; jobs stream progress.

### D. Triage & evaluation
- **Candidate grid**: hover-scrub video thumbnails, click → full-size compare
  viewer (A/B side-by-side + flicker toggle, loupe zoom, loop playback).
- Actions per candidate: ⭐ star, ✔ **select as keeper** (locks onto
  node/edge), ✖ reject (delete file+row), 🔁 **regenerate from this** (params
  pre-filled from lineage, tweakable), ✏ edit (→ E), ⬆ upscale, 📋 copy to
  another node/edge.
- **AI art director** (LLM vision): score-all against rubric (prompt adherence,
  anatomy, consistency with character refs, loop seamlessness for videos),
  sort by score, **auto-shortlist top N / auto-reject below threshold**
  (one-click, never silent). Rubric text is user-editable per project.
- Batch tools: select-all-rejects sweep, "keep starred only".
- **Consistency check**: pick two assets (or node keeper vs character ref) →
  LLM vision "same character? differences?" verdict — cheap drift detector.

### E. Asset editing (browser-scope wins only)
All edits are lineage-tracked new assets (never destructive).

- **Deterministic ops** (server-side Pillow/ffmpeg — already proven): crop
  (aspect presets), resize, rotate/flip, video trim, speed change, reverse,
  **ping-pong loop**, extract frame → usable as a new node keyframe or as an
  image-edit source, GIF/webm/mp4 transcode.
- **Mask painter** (exists): paint motion masks for cinemagraph loops; reuse
  masks across edges of the same node.
- **Provider-backed edits**: instruction edit ("remove the extra hand"),
  inpaint with painted mask, background removal, upscale (image + video).
- Out of scope: timelines, multi-track compositing, keyframed effects.

### F. Story logic layer (thin & declarative — see §7)
- Right-panel logic tab on every edge: logic type, trigger/button label,
  weight, condition builder (dropdown var / op / value rows, AND/OR),
  effects list, once/cooldown.
- Node logic tab: on-enter effects, dialogue/subtitle lines (per-node bank,
  one shown per visit — random or sequential), hold time when no idle loop.
- Variables manager (project level): declare, type, default, description;
  usage list (which edges read/write it); unused-variable lint.
- Hard rule: **no scripting.** If a mechanic can't be expressed in
  vars/conditions/effects, it goes into the **notes/instructions** field for
  the compile agent (§H) and the preview player ignores it.

### G. Preview player (the simplified test runtime)
- Same `SceneGraph` renderer beside the stage: current node highlighted, active
  edge animated with a progress marker — "where the story is and how it's
  playing".
- Stage: plays the locked clip for the traversed edge; falls back to the target
  node's still + hold timer when no clip. Choice buttons render from outgoing
  `choice` edges (respecting `show_if`/`enabled_if`); `auto` edges fire on
  condition; `idle` edges roam weighted-random; interaction queue routes via
  shortest path (walker engine carried over wholesale).
- **Debug HUD**: live variable values (editable on the fly), event log,
  traversal history, "teleport to node", seed the RNG for reproducible runs.
- Purpose: *validate story feel and asset completeness*, not to be the final
  game. Missing-asset placeholders render loudly.

### H. Export & game compile (the "vibecode" pipeline)
- **Game bundle export** (one click):
  ```
  bundle/
    graph.json          # schema-versioned: scenes, nodes, edges, logic,
                        # variables, dialogue — the machine-readable spec
    assets/             # keepers only, upscaled — WebM video + WebP images
    characters.json     # anchors + ref image paths
    instructions.md     # project brief + per-node/edge notes fields compiled
                        # into one agent-readable design doc
    style.md            # look & feel notes, UI wishes
  ```
- **Reference runtime**: a single small dependency-free JS module that plays a
  bundle exactly like the preview player (same walker semantics). Ships inside
  the bundle. It is (a) instantly playable proof the bundle is complete, and
  (b) the semantic ground truth the agent must not break.
- **Compile pack generator**: produces the agent prompt — "here is graph.json
  (the contract), the reference runtime (the semantics), instructions.md (the
  polish wishes); build the final game as a **static HTML5 single-page app**
  (the one blessed template — no build step, trivially verifiable, runs from a
  folder)". Anything beyond the declarative layer (meters, timers, minigames,
  save/load, menus, audio mixing) lives in instructions.md and is the agent's
  job, verified by the human against the reference runtime.
- Re-export is cheap and repeatable → iterate assets/logic in the studio,
  re-compile the game.

### I. Providers (cloud-first, everything swappable)
| Capability | Cloud default | Local option | Notes |
|---|---|---|---|
| Image gen | **fal.ai** (first adapter; Replicate/Gemini/OpenAI later) | ComfyUI adapter (template+patch-map pattern) | pick per project |
| Image edit | **fal.ai** instruction-edit endpoint (Kontext / nano-banana class) | ComfyUI inpaint | the consistency workhorse |
| Video | **fal.ai** FLF endpoints (Wan / Kling / LTX) — **must support first+last frame conditioning**; loop = first==last | ComfyUI (Wan/AnimateDiff) | motion masks only where supported; ping-pong fallback |
| Upscale | **fal.ai** ESRGAN endpoint | ComfyUI ESRGAN | keepers only |
| LLM | OpenRouter (text + vision) | any OpenAI-compatible | copilot, art director, scenario→graph |
| Mock | built-in, no keys | — | full app runs offline; powers tests |

The **ComfyUI local adapter is a first-class peer, not a legacy fallback**: it
covers models and content that cloud APIs won't serve and gives
zero-marginal-cost prototyping on local hardware. The template+patch-map
pattern ports over unchanged.

Adapter contract unchanged from anim-pipe: neutral request in, bytes+metadata
out, cost reported. Adding a provider touches one file.

### J. Tech stack (recommendation, brief)
- **Frontend**: React + Vite + @xyflow/react (React Flow 12), Zustand,
  TanStack Query, SSE for jobs. The canvas library choice is validated; the
  rest of the old frontend is reference material, not a base.
- **Backend**: keep **FastAPI + SQLite + content-addressed files** — it was
  never the weak part, the Python ecosystem is where image/video tooling lives
  (Pillow, ffmpeg), and the provider adapters port over. Add SSE, cancelation,
  and Alembic-free simple migrations. Single-user local-first stays.
- **Ship as**: `pip install`-able package or Docker; backend serves built
  frontend at `/` (single process, like today's `make build`).

---

## 5. Primary user journey (end to end)

1. **New project** → set style preset, add Character(s) (anchor text + ref
   images).
2. **Draft the story**: write scenario → LLM drafts scene graph → user edits
   nodes/edges/prompts on canvas.
3. **Keyframes**: for each node — generate candidates (fresh or **derived by
   image-edit from a locked neighbor**), triage (AI score → shortlist → human
   pick), lock keeper. Graph badges track progress.
4. **Clips**: for each edge — generate transition (FLF-conditioned) or loop
   (first=last, optional motion mask), triage, lock. Trim/ping-pong/edit as
   needed.
5. **Logic**: mark choice edges + labels, add variables/conditions/effects,
   dialogue lines.
6. **Test**: preview player; watch the graph light up; tweak weights/logic
   live; find dead ends via validation overlay.
7. **Polish**: upscale all keepers (batch action: "upscale every locked asset
   below 1080p").
8. **Export bundle** → play the reference runtime → **compile pack → agent
   builds the final game** → human reviews against the reference runtime.

---

## 6. Phased build plan

| Phase | Scope | Exit criterion |
|---|---|---|
| **1. Core studio** | Shell, projects/scenes/characters, graph editor, image gen + image-edit derive (fal.ai + ComfyUI + mock), triage grid + AI score, lineage, upscale, SSE jobs | Lock keyframes for a 6-node scene end-to-end |
| **2. Video** | Transition (FLF) + loop generation via cloud API, deterministic edit ops, mask painter, ping-pong, hover-scrub triage for video | Every edge of the scene has a locked clip |
| **3. Logic + player** | Variables, edge logic types, condition/effect builder, preview player with debug HUD, validation overlay | The scene is playable with choices in-editor |
| **4. Ship** | Bundle export, reference runtime, compile pack generator | Agent-built game runs from an exported bundle |
| **5. Polish** | Cost dashboard, snapshots/diff, consistency checker, auto-shortlist, batch ops, image-edit derive UX, scenario copilot round-trip | — |

Each phase is independently useful; Phase 1+2 alone already replaces the old
app at higher quality.

---

## 7. Decision: interaction controls in-editor vs. compile-only

The open question: build runtime controls (conditional edges, probabilities,
gates) into the studio, or keep the studio purely about assets+graph and let
the compile agent invent the game logic?

**Recommendation: both, split by a hard line — a *thin declarative logic
layer* in the studio, and *everything else* in the agent compile step.**

Why not compile-only:
- Without any testable logic, iteration is blind: you can't feel pacing, dead
  ends, or choice flow until after an expensive agent build. The feedback loop
  is days instead of seconds.
- The agent needs a spec anyway. Free-text instructions alone → hallucinated
  mechanics and drift between rebuilds. A machine-readable `graph.json` with
  explicit triggers/conditions/effects is the anti-hallucination contract, and
  the reference runtime makes the contract executable.
- The engine is nearly free: the ported walker already has types for
  `interaction`/`auto`, triggers, weights; guards and effects are ~small pure
  functions over a JSON variable bag.

Why not a full in-editor game engine:
- Meters, timers, minigames, save systems, scoring, audio, UI chrome are
  unbounded scope — exactly what "polished vibecode" is for. Building them
  in-editor turns the studio into a bad game engine and never ships.
- The declarative layer has a natural, enforceable ceiling: vars + comparisons
  + set/add effects + weights + once/cooldown. Anything past that ceiling is
  *by definition* an `instructions.md` note for the agent.

So: **studio = spec + assets + testable core loop; agent = final game.** The
preview player and the reference runtime share semantics, which means "it
plays correctly in the studio" is a meaningful promise about the final game.

---

## 8. Decisions (settled 2026-07-02)

1. **Bundle codec: WebM only.** Target is modern evergreen browsers; smallest
   bundles, single encode. Export is automated ffmpeg, so adding an MP4
   fallback later is a flag, not a redesign.
2. **One blessed game template: static HTML5 single-page.** No build step,
   easiest for the compile agent to get right, trivially verifiable against
   the reference runtime. More templates only after the pipeline proves out.
3. **Audio: schema reservation only in v1.** `kind=audio` in the Asset model +
   a slot in graph.json so ambience/VO attach later without migration. No
   audio UI; final-game audio is the compile agent's job via instructions.md.
4. **Multi-character: one bound character per node in v1.** Extra characters
   are described in the node prompt/notes. Revisit once single-character
   consistency proves out (likely via image-edit compositing).
5. **Stack: keep FastAPI + SQLite backend, evolve it in place; frontend
   rebuilt clean** (React + Vite + React Flow 12 + Zustand + TanStack Query),
   porting proven internals (walker engine, SceneGraph geometry, mask painter,
   triage grid) rather than rewriting them blind.
6. **Repo: this repo, in place.** Old frontend stays in git history.
7. **Providers: fal.ai is the first cloud adapter** (image gen, instruction
   edit, FLF video, upscale under one key). **ComfyUI local stays first-class**
   — needed for models/content cloud APIs won't serve and for cheap local
   prototyping. Mock always ships and powers tests.
