"""Prompt assembly + management.

A node/edge prompt is composed from layers so character identity stays consistent
across the whole graph:

    [character.description] + [node/edge.prompt] + [style preset] (+ negatives)

Templates support {var} substitution from a project-level variable bag so you can
change the character's outfit or the lighting once and have it propagate.
"""
from __future__ import annotations

from dataclasses import dataclass, field

# Anime/cartoon defaults (chosen style). Override per project in meta["style"].
DEFAULT_STYLE = (
    "anime style, clean cel shading, soft rim light, expressive, "
    "consistent character design, full body, simple background"
)
DEFAULT_NEGATIVE = (
    "lowres, bad anatomy, extra fingers, deformed, watermark, text, "
    "jpeg artifacts, inconsistent character, blurry, duplicate"
)


@dataclass
class PromptContext:
    character_description: str = ""
    style: str = DEFAULT_STYLE
    negative: str = DEFAULT_NEGATIVE
    variables: dict[str, str] = field(default_factory=dict)


def _subst(text: str, variables: dict[str, str]) -> str:
    for k, v in variables.items():
        text = text.replace("{" + k + "}", v)
    return text


def build_image_prompt(node_prompt: str, ctx: PromptContext) -> tuple[str, str]:
    """Return (positive, negative) for a keyframe image."""
    parts = [p for p in (ctx.character_description, node_prompt, ctx.style) if p.strip()]
    positive = _subst(", ".join(parts), ctx.variables)
    negative = _subst(ctx.negative, ctx.variables)
    return positive, negative


def build_video_prompt(edge_prompt: str, kind: str, ctx: PromptContext) -> tuple[str, str]:
    """Return (positive, negative) for a transition/loop clip.

    Loops get a 'subtle, seamless, looping' nudge; transitions get a motion cue.
    """
    motion = (
        "subtle idle motion, breathing, seamless loop, minimal camera movement"
        if kind == "loop"
        else "smooth natural transition, coherent motion"
    )
    parts = [p for p in (ctx.character_description, edge_prompt, motion) if p.strip()]
    positive = _subst(", ".join(parts), ctx.variables)
    negative = _subst(ctx.negative, ctx.variables)
    return positive, negative
