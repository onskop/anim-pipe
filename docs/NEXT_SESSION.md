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

1. **Character consistency: LoRA + IP-Adapter** (highest value). The request
   fields exist (`lora_name`, `lora_weight`, `ref_images`, `ip_adapter_weight`)
   but the `txt2img_anime.json` workflow has **no LoraLoader / IPAdapter nodes**.
   - Rebuild the workflow in ComfyUI with those nodes; export API JSON; extend
     the `_animpipe.patch` map (`lora_name`, `lora_weight`, `ref_image`,
     `ip_weight`).
   - Add a **LoRA dropdown** in the UI: extend `GET /api/comfyui/models` to also
     return `loras` (object_info `LoraLoader.lora_name`) and surface it in the
     character editor.
   - Wire **reference-image upload** → store on the character (`ref_image_ids`,
     upload endpoint already exists) → flows into `ImageRequest.ref_images`
     (already plumbed in the pipeline).
   - Test on the 3070 (SD1.5 LoRA + IP-Adapter both fit in 8 GB).

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
- Consistency today is **text-only** (similar, not identical) — that's exactly
  what step 1 fixes.
