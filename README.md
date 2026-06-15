# anim-pipe

A local-first studio for generating the **images and short videos that animate a
game character** — modeled as a graph. **Nodes** are canonical keyframe images
(stable character states: idle, looking around, at a door). **Edges** are short
clips between them:

- **Idle loops** (back to the same node): breathing, blinking, scratching — a
  seamless loop where the first frame equals the last.
- **Transitions** (node A → node B): a first→last-frame clip that interpolates
  motion between two keyframes.

You drive everything from a node-graph canvas: click a node to generate keyframe
candidates, click an edge to generate clip candidates, triage the batch (by hand
or with an AI art-director), pick the keeper, and upscale only what you keep.

> Status: **v0.1 foundation.** The full loop — graph → generate → triage → select
> → upscale — runs end-to-end today against a built-in **Mock** provider (no GPU,
> no API keys). The real **ComfyUI** (local GPU) and **OpenRouter** (LLM) adapters
> are wired and ready to point at your models.

---

## Why a graph?

A character's animation is really a **state machine**: stable poses (states) and
short clips that move between them (transitions) or keep them alive in place
(loops). Representing that directly as a graph means:

- the game can ship a tiny manifest (`graph.json` + assets) and play clips by
  walking edges;
- you generate and version each piece independently;
- idle loops and transitions reuse the exact keyframe images as conditioning, so
  the character stays consistent shot to shot.

This mirrors how **"living comics" / cinemagraph** artists work — see
[`docs/PRACTICES.md`](docs/PRACTICES.md) for the techniques baked in (seamless
loops via first=last frame, motion masks so only a region moves, two-stage
generate-then-upscale, character-consistency stacking).

---

## Architecture

```
frontend (React + React Flow)        backend (FastAPI)
  graph canvas / inspector  ──HTTP──►  REST API ──► async job queue
  triage gallery                          │            │
                                          │            ▼
                                          │      provider registry  (swappable line)
                                          │        ├─ image:  mock | comfyui
                                          │        ├─ video:  mock | comfyui
                                          │        ├─ upscale: mock | comfyui
                                          │        └─ llm:    mock | openrouter
                                          ▼
                                   SQLite (graph + lineage + cost)
                                   data/assets (content-addressed files)
```

Every generation is stored as an `Asset` candidate carrying full **lineage**
(prompt, seed, model, parent) so triage, regeneration and upscaling are
reproducible. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

### The swappable "intelligence" line
Backends are resolved by name from config (`ANIMPIPE_*_PROVIDER`). Adapters are
thin: they translate neutral requests (`ImageRequest`, `VideoRequest`,
`UpscaleRequest`) into ComfyUI graphs or API calls and return bytes + metadata.
Add a backend by dropping an adapter in `backend/app/providers/` and registering
it — the pipeline, storage, triage and cost tracking are untouched.

---

## Quickstart

```bash
make setup          # install backend (pip) + frontend (npm) deps

# Terminal 1 — API on :8000  (defaults to the Mock provider; runs anywhere)
make backend

# Terminal 2 — UI on :5173  (proxies /api -> :8000)
make frontend

# optional: a demo project to click around
make seed
```

Open http://localhost:5173, create/select a project, drop in a scenario or add
nodes, drag edges between them (drag a node onto itself for an idle loop), then
**Generate** and **triage**.

Single-process option: `make build` compiles the UI into `frontend/dist`, which
the backend then serves at `/` — so `make backend` alone serves the whole app.

### Tests
```bash
make test   # end-to-end smoke over the Mock provider
```

---

## Going real (local GPU)

1. Run **ComfyUI** with your anime checkpoint (Illustrious/Pony/AnimagineXL),
   AnimateDiff-Evolved + VideoHelperSuite, an IP-Adapter pack, and an ESRGAN
   upscale model.
2. Edit the workflow templates in
   `backend/app/providers/workflows/` to point at your models/nodes. They're in
   ComfyUI **API format** with a small `_animpipe.patch` map so the app knows
   which node input each field sets — rebuild a workflow in ComfyUI, export the
   API JSON, fix the map, done.
3. Flip providers in `backend/.env`:
   ```
   ANIMPIPE_IMAGE_PROVIDER=comfyui
   ANIMPIPE_VIDEO_PROVIDER=comfyui
   ANIMPIPE_UPSCALE_PROVIDER=comfyui
   ANIMPIPE_LLM_PROVIDER=openrouter
   ANIMPIPE_OPENROUTER_API_KEY=sk-or-...
   ```

Recommended local models (2026): **Wan 2.2 I2V** or **LTX-2** for transitions
(strong first/last-frame conditioning + identity preservation), **AnimateDiff-
Evolved** (`closed_loop`) or image-to-video for seamless idle loops. See
[`docs/PRACTICES.md`](docs/PRACTICES.md) for the full rationale and sources.

---

## Roadmap (next milestones)

> See [`docs/NEXT_SESSION.md`](docs/NEXT_SESSION.md) for the detailed, prioritized plan.

Done:
- [x] Local ComfyUI image generation wired (checkpoint/size/steps/cfg/seed in the UI).
- [x] Settings UI: live provider swap, OpenRouter config + test, ComfyUI URL, backend health/restart.
- [x] Character editor (consistency anchor) + node negative prompt wired.
- [x] Triage: batch AI-score + sort by score; reject hard-deletes.
- [x] **Character consistency: LoRA + IP-Adapter** wired into the txt2img workflow + UI. The
  workflow always ships the LoRA/IP-Adapter nodes; the adapter splices them out per-candidate
  when a character supplies neither, so the same template runs with or without the stack. The
  character editor exposes a LoRA picker (from ComfyUI), reference-image upload, and weights.

Next:
- [ ] Real ESRGAN upscale (install model → flip provider; passthrough already wired).
- [ ] Video workflows (AnimateDiff loops / Wan·LTX transitions) — rebuild the placeholder graphs, ideally on a rented GPU.
- [ ] Auto-shortlist top N after scoring; regenerate-with-tweaks from a candidate (lineage exists).
- [ ] Expose sampler/scheduler; final assembled-prompt preview.
- [ ] Export `graph.json` + asset bundle; cost dashboard; WebSocket job progress; motion-mask painter.
```

## Layout
```
backend/   FastAPI app, providers, pipeline, queue, SQLite models, tests
frontend/  React + React Flow canvas, inspector, triage gallery
docs/      ARCHITECTURE.md, PRACTICES.md
```
