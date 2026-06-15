"""Unit tests for the ComfyUI txt2img consistency-stack pruning.

The shipped ``txt2img_anime.json`` always contains the LoRA + IP-Adapter nodes;
``_prune_optional`` splices them out when a character doesn't use them, rewiring
the model/clip connections so the graph stays valid either way.
"""
from __future__ import annotations

from app.providers.comfyui import ComfyUIProvider


def _load():
    p = ComfyUIProvider(base_url="http://localhost:0")
    wf, meta = p._load("txt2img_anime.json")
    return wf, meta, p


def test_no_consistency_stack_is_spliced_out():
    wf, meta, p = _load()
    p._prune_optional(wf, meta["optional"], active_fields=set())
    # LoRA + IP-Adapter nodes are gone.
    for nid in ("10", "11", "12", "13"):
        assert nid not in wf
    # KSampler reads the checkpoint model directly; text encoders read its clip.
    assert wf["3"]["inputs"]["model"] == ["4", 0]
    assert wf["6"]["inputs"]["clip"] == ["4", 1]
    assert wf["7"]["inputs"]["clip"] == ["4", 1]


def test_lora_only_keeps_lora_drops_ipadapter():
    wf, meta, p = _load()
    p._prune_optional(wf, meta["optional"], active_fields={"lora_name"})
    assert "10" in wf  # LoRA kept
    for nid in ("11", "12", "13"):
        assert nid not in wf  # IP-Adapter dropped
    # Sampler now reads the LoRA-patched model; clip flows checkpoint -> lora -> encode.
    assert wf["3"]["inputs"]["model"] == ["10", 0]
    assert wf["10"]["inputs"]["model"] == ["4", 0]
    assert wf["6"]["inputs"]["clip"] == ["10", 1]


def test_full_stack_is_untouched():
    wf, meta, p = _load()
    p._prune_optional(wf, meta["optional"],
                      active_fields={"lora_name", "ref_image"})
    for nid in ("10", "11", "12", "13"):
        assert nid in wf
    # End of the model chain feeds the sampler.
    assert wf["3"]["inputs"]["model"] == ["13", 0]
    assert wf["13"]["inputs"]["model"] == ["11", 0]
    assert wf["11"]["inputs"]["model"] == ["10", 0]


def test_ref_only_drops_lora_keeps_ipadapter():
    wf, meta, p = _load()
    p._prune_optional(wf, meta["optional"], active_fields={"ref_image"})
    assert "10" not in wf  # LoRA dropped
    for nid in ("11", "12", "13"):
        assert nid in wf
    # IP-Adapter loader now reads the checkpoint model directly.
    assert wf["11"]["inputs"]["model"] == ["4", 0]
    # Text encoders fall back to the checkpoint clip.
    assert wf["6"]["inputs"]["clip"] == ["4", 1]
