# Next-session plan

A working handoff: what's done, what's next (prioritized), and the gotchas.
Last updated 2026-06-15.

## Where things stand (works today)

- **Image generation runs on local ComfyUI** end-to-end. Checkpoint is
  `DreamShaper_8_pruned.safetensors` (SD 1.5). The UI exposes checkpoint /
  width / height / steps / cfg / seed; defaults 512×512.
- **Settings UI** (⚙): swap image/video/upscale/llm providers **live** (no
  restart), edit OpenRouter base URL / key / text+vision models with a **Test**
  button, ComfyUI URL, default upscale model, backend health + **Restart** +
  offline banner. Persisted to `data/runtime.json` (git-ignored).
- **Character editor** in the Inspector: name + appearance description. The
  description is the *consistency anchor* prepended to every node prompt.
- **Character consistency stack: LoRA + IP-Adapter** (new). `txt2img_anime.json`
  now carries `LoraLoader` + `IPAdapterUnifiedLoader`/`IPAdapterAdvanced` nodes;
  the ComfyUI adapter **splices them out per-candidate** when a character has no
  LoRA / no reference image (driven by an `_animpipe.optional` map that rewires
  the model/clip chain), so one template serves both cases. The character editor
  exposes a **LoRA picker** (from `GET /api/comfyui/models` → `loras`),
  **reference-image upload** (stored on `character.ref_image_ids`) with
  thumbnails, and **LoRA / IP-Adapter weight** sliders. Covered by unit tests in
  `tests/test_comfyui_workflow.py`.
- **Prompt assembly** = `[character.description] + [node.prompt] + DEFAULT_STYLE`;
  negatives = `DEFAULT_NEGATIVE` + the node's negative box (now wired).
- **Triage**: reject = hard-delete (row + file), **AI-score-all**, **sort by
  score** (OpenRouter vision; verified), per-candidate upscale that polls the job.
- **LLM intelligence line** (prompt expand, vision triage, scenario→graph) runs
  on OpenRouter (key configured).

Providers still on **mock** by default: **video** and **upscale**.

## Hardware reality

RTX 3070 = **8 GB VRAM** (the ceiling) + 32 GB RAM. Great for SD1.5/SDXL
images; **video is heavy**. Plan: rent a cloud GPU (RunPod/Vast) running
ComfyUI and just repoint `ANIMPIPE_COMFYUI_URL` — the adapter is pure HTTP, so
nothing else changes.

## Prioritized next steps

1. **Verify the consistency stack on real hardware** (the code landed this
   session — now prove it on the 3070). SD1.5 LoRA + IP-Adapter both fit in 8 GB.
   - Install the **ComfyUI_IPAdapter_plus** custom pack + an IP-Adapter model;
     drop a character LoRA in `ComfyUI/models/loras`. If your node class names
     differ from the shipped template (`IPAdapterUnifiedLoader` /
     `IPAdapterAdvanced`), rebuild in the editor, export API JSON, and fix the
     `_animpipe.patch` + `optional` maps in `txt2img_anime.json`.
   - In the UI: pick the LoRA in the character editor, upload 1+ reference
     images, tune the weight sliders, generate, and eyeball identity drift across
     nodes. (The adapter auto-splices the LoRA/IP-Adapter nodes out when a
     character supplies neither, so unconfigured characters still generate.)
   - Multi-image IP-Adapter: today only `ref_images[0]` is uploaded/used — extend
     to batch all refs if needed.

2. **Real upscale**: install an ESRGAN model (`RealESRGAN_x4plus_anime_6B` or
   `4x-UltraSharp`) into `ComfyUI/models/upscale_models`, pick it in ⚙ Settings,
   flip upscale provider → comfyui, verify (model passthrough is already wired).

3. **Video pipeline** (do once a bigger GPU is available). The two video JSONs
   are **placeholders with fake nodes**. Rebuild:
   - `video_loop.json` → AnimateDiff-Evolved (`closed_loop`) for seamless idles.
   - `video_flf2v.json` → Wan 2.2 I2V / LTX-Video with start+end frame
     conditioning. Fix patch maps, then flip video provider → comfyui.

4. **Auto-shortlist** (extends triage): after score-all, auto-star the top N and
   optionally reject below a threshold.

5. **Regenerate-from-candidate**: "tweak & regenerate" using the lineage already
   stored in `asset.params` (seed/model/prompt).

6. **Smaller wins**:
   - Expose sampler/scheduler in gen params (currently fixed euler/normal — just
     patch-map + UI fields).
   - **Final assembled-prompt preview** in the Inspector (positive + negative).
   - Export `graph.json` + asset bundle for the game engine.
   - Cost dashboard; WebSocket job progress; motion-mask painter.

## Gotchas / dev notes

- Windows: no `make`. Run backend with **`--reload`** (the Restart button and
  live edits depend on it): `cd backend; uvicorn app.main:app --reload --port 8000`.
  Frontend: `cd frontend; npm run dev`. Use `python`, not `python3`.
- `data/runtime.json` holds the OpenRouter **API key** — git-ignored, keep it so.
- Python deps are installed **globally** (no venv) — consider a `backend/.venv`.
- The UI can only control fields listed in each workflow's `_animpipe.patch` map;
  anything else means editing the workflow JSON (rebuild in ComfyUI → export API
  format → fix the map).
- A workflow can now mark nodes **optional** via `_animpipe.optional`
  (`{node_id: {requires, passthrough}}`): the adapter removes them when the gating
  field is absent and rewires their outputs through `passthrough`. That's how the
  LoRA / IP-Adapter stack stays in one template yet runs for characters that use
  neither — reuse the pattern for any other "only when configured" node.
- Consistency now stacks **text anchor + LoRA + IP-Adapter** (identity, not just
  similarity). It's only as good as the LoRA/reference images you supply, and runs
  on ComfyUI only (mock ignores the extra fields).
