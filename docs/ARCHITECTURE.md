# Architecture

## Data model (`backend/app/models.py`)

- **Project** — a graph + a freeform `scenario`.
- **Character** — the consistency anchor: `description` (injected into every
  prompt), `lora_name`/`lora_weight`, `ip_adapter_weight`, `ref_image_ids`.
- **Node** — a canonical keyframe state: `key` (stable id the game uses),
  `prompt`, `character_id`, `selected_asset_id` (the chosen keyframe), `x`/`y`
  canvas position.
- **Edge** — a clip: `source_node_id` → `target_node_id`, `kind` = `loop`
  (source==target) or `transition`, `prompt`, optional `motion_mask_id`,
  `selected_asset_id`.
- **GenerationJob** — queued unit of work: `kind` (`image`/`video_loop`/
  `video_transition`/`upscale`), `provider`, `n`, `status`, `progress`, `cost`.
- **Asset** — one generated candidate (image/video/mask) with **lineage**:
  `params` (seed/model/prompt), `parent_asset_id` (upscale/regen source),
  `ai_score`, `status` (`candidate`/`accepted`/`rejected`/`starred`), `cost`.

## Request flow

1. UI calls `POST /api/nodes/{id}/generate` or `/api/edges/{id}/generate`.
2. `api.py` creates a `GenerationJob` (status `queued`) and enqueues its id.
3. The async worker (`queue.py`) picks it up, marks it `running`, calls
   `pipeline.run_job`.
4. `pipeline.py` builds a neutral provider request from the node/edge + character
   (prompt assembly in `prompts.py`), fans out `n` candidates, and writes each to
   the **content-addressed store** (`storage.py`) + an `Asset` row.
5. UI polls `GET /api/jobs/{id}`; when `done`, it opens the triage gallery
   (`GET /api/{owner}/{id}/assets`).
6. Triage: `PATCH /api/assets/{id}` (star/reject), `POST /api/assets/{id}/score`
   (LLM art-director), `POST /api/{owner}/{id}/select/{asset}` (lock the keeper),
   `POST /api/assets/{id}/upscale` (two-stage upscale of a keeper).

## Provider abstraction (`backend/app/providers/`)

`base.py` defines neutral dataclasses (`ImageRequest`, `VideoRequest`,
`UpscaleRequest`, `GenAsset`, `TriageScore`) and `Protocol`s. The registry in
`__init__.py` resolves the adapter by config name.

- `mock.py` — Pillow-only placeholder gen (images + seamless GIF loops + cross-
  fade transitions). Lets the whole app run with no GPU/keys; powers the tests.
- `comfyui.py` — uploads conditioning images, patches an API-format workflow
  template, queues `/prompt`, polls `/history`, downloads `/view`.
- `openrouter.py` — OpenAI-compatible LLM for `expand_prompt`,
  `score_candidate` (vision triage), `scenario_to_graph`.

Workflow templates (`providers/workflows/*.json`) are ComfyUI API JSON plus an
`_animpipe.patch` map of `field -> [node_id, input_key]`. This decouples Python
from your specific node ids/model names: rebuild in ComfyUI, export API JSON, fix
the map.

## Adding a backend

1. Implement the relevant `Protocol` in a new module under `providers/`.
2. Register it in `providers/__init__.py`.
3. Select it via `ANIMPIPE_<CAP>_PROVIDER`.

Nothing in the pipeline, storage, triage or cost layers needs to change — e.g. a
`fal.py` or `replicate.py` cloud adapter slots straight in.

## Why these choices
- **FastAPI + SQLite + filesystem**: zero-config local single-user tool; the DB
  is the source of truth so the in-process queue can be swapped for Celery/RQ
  later without touching the API.
- **React Flow**: purpose-built node/edge canvas — the graph IS the UI.
- **Content-addressed assets**: identical generations dedupe; lineage stays
  intact for reproducible reg/upscale.
