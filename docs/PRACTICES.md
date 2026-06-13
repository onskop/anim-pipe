# Practitioner notes: living comics, cinemagraphs & generative idle loops

This captures the techniques anim-pipe is built around — distilled from how
cinemagraph and "living comics" / motion-comic artists actually get convincing,
cheap, consistent animation, plus the 2025–2026 model landscape. Design choices
in the codebase trace back to these.

## 1. Seamless loops = condition the same frame as first AND last
The defining trick of a good idle loop (breathing, candle flicker, hair sway) is
that the **last frame matches the first**, so playback cycles with no visible cut.

- The recent **DreamLoop** method generates cinemagraphs from a single photo by
  using that image as **both the first- and last-frame condition**, which
  enforces a seamless loop without any cinemagraph-specific training data.
- In ComfyUI/AnimateDiff this is the **`closed_loop`** flag (AnimateDiff-Evolved):
  the last context view connects back to the first. Pair with a ping-pong export
  as a fallback.

→ In anim-pipe, a **loop edge** sends the source node's keyframe as `start_image`
and (implicitly) the same image as the end condition, with `closed_loop=true`.

## 2. Cinemagraph principle: animate a *region*, freeze the rest
A cinemagraph keeps almost the whole frame perfectly still and moves only a small
masked area (chest rising, eyes blinking, cloak edge). This is why living-comics
panels feel alive without the cost/risk of regenerating the entire image — and it
kills the "everything subtly morphs" artifact of naive image-to-video.

→ anim-pipe carries an optional **motion mask** on every edge (`motion_mask_id`)
so loops can be region-locked. (UI mask painter is on the roadmap; the data path
and provider field exist today.)

## 3. Subtle beats strong for idles
Idle motion should be low-amplitude. Use a low motion scale (SVD's
`motion_bucket_id`, or AnimateDiff motion-LoRA strength) so the character
breathes rather than lunges. anim-pipe exposes `motion_scale` (default 0.6) and
lowers it further for loops.

## 4. Two-stage: generate cheap, triage, THEN upscale
Everyone doing this at volume renders **low/medium res (≈512–768px, 12–24 fps)**,
triages, and upscales **only the keepers** (Topaz / Real-ESRGAN / an `4x-Anime`
ESRGAN). Upscaling rejects is wasted money/time.

→ anim-pipe makes this first-class: candidates are cheap; `Upscale` is a separate
job you run on a selected asset, with lineage back to its parent.

## 5. Character consistency is a *stack*, not one trick
Across many nodes the character must stay on-model. Practitioners layer:

- a **character LoRA** trained on 15–30 refs (multiple angles/expressions) for
  identity;
- **IP-Adapter** (Plus/Face) from a reference image for per-shot likeness/style;
- optional **ControlNet** (pose/lineart) for precise staging;
- a **shared prompt fragment** (the character sheet) injected into every node.

→ anim-pipe models a `Character` (description + LoRA name/weight + IP-Adapter
weight + ref images) and injects its description into every node/edge prompt via
`prompts.py`. The ComfyUI txt2img template has hooks for LoRA/IP-Adapter.

## 6. Reuse keyframes as video conditioning
Because transitions are conditioned on the **actual selected keyframe images**
(first = node A, last = node B), motion stays anchored to on-model frames instead
of drifting. Generate keyframes first, lock them, then animate between them.

---

## Model cheat-sheet (local, 2026)

| Need | Pick | Notes |
|---|---|---|
| Keyframe stills (anime) | SDXL-family anime checkpoint + character LoRA + IP-Adapter | Illustrious / Pony / AnimagineXL lineage |
| Transition A→B (first-last frame) | **Wan 2.2 I2V** or **LTX-2** | strong identity preservation + FLF conditioning; LTX-2 is fast, Wan 2.2 (MoE) is high-fidelity |
| Idle loop | **AnimateDiff-Evolved** (`closed_loop`) or image-to-video (**SVD** on low VRAM) | SVD runs on 8–16GB but lower ceiling |
| Upscale | Real-ESRGAN / `4x-AnimeSharp` (image), Topaz (video) | keepers only |
| Render target | 640–768px, 12–24 fps, then upscale | sweet spot for cost/quality |

---

## Sources
- DreamLoop — controllable cinemagraph generation (first=last frame loop): https://arxiv.org/abs/2601.02646
- AnimateDiff High-Res Loops (ComfyUI template, `closed_loop`): https://comfy.org/workflows/template_animate_diff_loops-5edd51bc1a25/
- AnimateDiff IP-Adapter looping animation template: https://www.comfy.org/workflows/templates_purz_animatediff_simple_weighted_ipadapters_looping_animation-ba62b8d37772/
- Perfectly looping animations in ComfyUI (frame alignment, render-then-upscale): https://medium.com/@saurabhswami/creating-perfectly-looping-animations-using-comfyui-a-step-by-step-guide-to-animatediff-c5acdd02a6ff
- AnimateDiff-Evolved (`ADE_LoopedUniformViewOptions`, closed loop): https://www.runcomfy.com/comfyui-nodes/ComfyUI-AnimateDiff-Evolved/ADE_LoopedUniformViewOptions
- Local AI video generation — Wan 2.2 / LTX / Hunyuan (2026): https://localaimaster.com/blog/local-ai-video-generation
- Wan 2.2 vs LTX-2 comparison: https://vast.ai/article/wan-2-2-vs-ltx-2-which-ai-video-model-should-you-use
- Sprite Sheet Diffusion (pose + appearance via IP-Adapter/ControlNet): https://arxiv.org/html/2412.03685v2
- Character consistency: LoRA + IP-Adapter + ControlNet workflow: https://apatero.com/blog/ai-character-consistency-virtual-personas-guide-2025
- Anime character consistency (LoRA training, 15–30 refs): https://apatero.com/blog/anime-character-consistency-complete-guide-2025
