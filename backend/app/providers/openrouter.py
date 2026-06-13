"""OpenRouter LLM adapter (the swappable 'intelligence' line).

OpenRouter exposes an OpenAI-compatible API, so any model it routes to — Claude,
GPT, Gemini, Llama, Qwen-VL, etc. — can drive prompt expansion and vision-based
triage. Pick the model per call from the UI; defaults come from config.
"""
from __future__ import annotations

import base64
import json

import httpx

from ..config import get_settings
from .base import TriageScore


class OpenRouterProvider:
    def __init__(self) -> None:
        s = get_settings()
        self.base_url = s.openrouter_base_url.rstrip("/")
        self.api_key = s.openrouter_api_key
        self.text_model = s.llm_text_model
        self.vision_model = s.llm_vision_model

    def _headers(self) -> dict[str, str]:
        if not self.api_key:
            raise RuntimeError("ANIMPIPE_OPENROUTER_API_KEY is not set")
        return {
            "Authorization": f"Bearer {self.api_key}",
            "HTTP-Referer": "https://github.com/onskop/anim-pipe",
            "X-Title": "anim-pipe",
        }

    async def _chat(self, model: str, messages: list, max_tokens: int = 800) -> str:
        async with httpx.AsyncClient(timeout=120) as http:
            r = await http.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json={"model": model, "messages": messages, "max_tokens": max_tokens},
            )
            r.raise_for_status()
            return r.json()["choices"][0]["message"]["content"]

    async def expand_prompt(self, brief: str, context: str = "") -> str:
        sys = (
            "You write concise, vivid image-generation prompts for an anime/cartoon "
            "game character. Keep character identity consistent. Return ONLY the prompt."
        )
        user = f"Context: {context}\nBrief: {brief}" if context else brief
        return (await self._chat(
            self.text_model,
            [{"role": "system", "content": sys}, {"role": "user", "content": user}],
            max_tokens=200,
        )).strip()

    async def score_candidate(self, image: bytes, intent: str, kind: str) -> TriageScore:
        b64 = base64.b64encode(image).decode()
        sys = (
            "You are a strict art director triaging generated game assets. "
            "Score 0..1 and return ONLY JSON with keys: overall, character_consistency, "
            "motion_quality, loop_seamlessness, artifacts, verdict (keep|reject|borderline), notes."
        )
        content = [
            {"type": "text", "text": f"Intended {kind}: {intent}. Score this candidate."},
            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}},
        ]
        raw = await self._chat(
            self.vision_model,
            [{"role": "system", "content": sys}, {"role": "user", "content": content}],
        )
        return self._parse_score(raw)

    async def scenario_to_graph(self, scenario: str) -> dict:
        sys = (
            "Convert a game scenario into an animation graph. Nodes are stable "
            "character keyframes; edges are short clips: 'loop' (idle back to same "
            "node) or 'transition' (between nodes). Return ONLY JSON: "
            '{"nodes":[{"key","title","prompt"}],"edges":[{"source","target","kind","label"}]}'
        )
        raw = await self._chat(
            self.text_model,
            [{"role": "system", "content": sys}, {"role": "user", "content": scenario}],
            max_tokens=2000,
        )
        return self._parse_json(raw)

    # --- helpers --------------------------------------------------------
    @staticmethod
    def _parse_json(raw: str) -> dict:
        raw = raw.strip()
        if raw.startswith("```"):
            raw = raw.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0]
        start, end = raw.find("{"), raw.rfind("}")
        return json.loads(raw[start : end + 1]) if start >= 0 else {}

    def _parse_score(self, raw: str) -> TriageScore:
        try:
            d = self._parse_json(raw)
            return TriageScore(
                overall=float(d.get("overall", 0.5)),
                character_consistency=float(d.get("character_consistency", 0.0)),
                motion_quality=float(d.get("motion_quality", 0.0)),
                loop_seamlessness=float(d.get("loop_seamlessness", 0.0)),
                artifacts=float(d.get("artifacts", 0.0)),
                verdict=str(d.get("verdict", "borderline")),
                notes=str(d.get("notes", "")),
            )
        except Exception:
            return TriageScore(overall=0.5, verdict="borderline", notes="parse failed")
