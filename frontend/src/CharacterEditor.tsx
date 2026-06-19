/* Character definition editor — the consistency anchor (name, appearance,
   LoRA + IP-Adapter reference images). Used in two places:
     • embedded inside the node Inspector when a node has a character,
     • as the right-pane editor when a character is selected from the library. */
import { useEffect, useRef, useState } from "react";
import { api, fileUrl } from "./api";
import type { Character, ComfyModels } from "./types";

export default function CharacterEditor({
  character,
  projectId,
  refresh,
  embedded = false,
}: {
  character: Character;
  projectId: string;
  refresh: () => Promise<void>;
  embedded?: boolean;
}) {
  const [name, setName] = useState(character.name);
  const [desc, setDesc] = useState(character.description);
  const [loraName, setLoraName] = useState(character.lora_name ?? "");
  const [loraWeight, setLoraWeight] = useState(character.lora_weight);
  const [ipWeight, setIpWeight] = useState(character.ip_adapter_weight);
  const [refIds, setRefIds] = useState<string[]>(character.ref_image_ids);
  const [refThumbs, setRefThumbs] = useState<Record<string, string>>({});
  const [uploadingRef, setUploadingRef] = useState(false);
  const [saved, setSaved] = useState(false);
  const [comfy, setComfy] = useState<ComfyModels | null>(null);
  const [isComfy, setIsComfy] = useState(false);
  const refInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setName(character.name);
    setDesc(character.description);
    setLoraName(character.lora_name ?? "");
    setLoraWeight(character.lora_weight);
    setIpWeight(character.ip_adapter_weight);
    setRefIds(character.ref_image_ids);
    setRefThumbs({});
    character.ref_image_ids.forEach((id) =>
      api
        .asset(id)
        .then((a) => setRefThumbs((m) => ({ ...m, [id]: fileUrl(a.thumb_path || a.path) })))
        .catch(() => {}),
    );
  }, [character.id]);

  useEffect(() => {
    api.providers().then((p) => setIsComfy(p.image === "comfyui")).catch(() => {});
    api.comfyModels().then(setComfy).catch(() => setComfy(null));
  }, []);

  const save = async (overrides: Partial<{ ref_image_ids: string[] }> = {}) => {
    await api.updateCharacter(character.id, {
      name,
      description: desc,
      ref_image_ids: overrides.ref_image_ids ?? refIds,
      lora_name: loraName || null,
      lora_weight: loraWeight,
      ip_adapter_weight: ipWeight,
    });
    await refresh();
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  };

  const addRefImage = async (file: File) => {
    setUploadingRef(true);
    try {
      const asset = await api.uploadAsset(projectId, file);
      const next = [...refIds, asset.id];
      setRefIds(next);
      setRefThumbs((m) => ({ ...m, [asset.id]: fileUrl(asset.thumb_path || asset.path) }));
      await save({ ref_image_ids: next });
    } finally {
      setUploadingRef(false);
      if (refInputRef.current) refInputRef.current.value = "";
    }
  };

  const removeRefImage = async (id: string) => {
    const next = refIds.filter((x) => x !== id);
    setRefIds(next);
    await save({ ref_image_ids: next });
  };

  return (
    <div className={embedded ? "charbox" : "stack"}>
      <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>
        This description is prepended to <strong>every</strong> node using “{character.name}”
        — the consistency anchor.
      </div>
      <label className="muted">character name</label>
      <input value={name} onChange={(e) => setName(e.target.value)} />
      <label className="muted" style={{ display: "block", marginTop: 6 }}>
        appearance description
      </label>
      <textarea
        rows={3}
        value={desc}
        placeholder="green cloak, short brown hair…"
        onChange={(e) => setDesc(e.target.value)}
      />

      <div className="muted" style={{ fontSize: 11, margin: "10px 0 4px" }}>
        <strong>Consistency stack</strong> (ComfyUI) — pin identity beyond the text anchor.
      </div>

      <label className="muted">character LoRA</label>
      {isComfy && comfy?.online && comfy.loras.length > 0 ? (
        <select value={loraName} onChange={(e) => setLoraName(e.target.value)}>
          <option value="">— none —</option>
          {comfy.loras.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      ) : (
        <input
          value={loraName}
          placeholder={isComfy ? "no LoRAs found in ComfyUI" : "switch image provider to ComfyUI"}
          onChange={(e) => setLoraName(e.target.value)}
        />
      )}
      {loraName && (
        <>
          <label className="muted" style={{ display: "block", marginTop: 6 }}>
            LoRA weight · {loraWeight.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={1.5}
            step={0.05}
            value={loraWeight}
            onChange={(e) => setLoraWeight(+e.target.value)}
          />
        </>
      )}

      <label className="muted" style={{ display: "block", marginTop: 8 }}>
        reference images (IP-Adapter)
      </label>
      <div className="row" style={{ flexWrap: "wrap", gap: 6, marginTop: 4 }}>
        {refIds.map((id) => (
          <div key={id} style={{ position: "relative", flex: "0 0 auto" }}>
            {refThumbs[id] ? (
              <img
                src={refThumbs[id]}
                alt="ref"
                style={{ width: 52, height: 52, objectFit: "cover", borderRadius: 4 }}
              />
            ) : (
              <div style={{ width: 52, height: 52, borderRadius: 4, background: "#0003" }} />
            )}
            <button
              title="remove"
              onClick={() => removeRefImage(id)}
              style={{
                position: "absolute", top: -6, right: -6, width: 18, height: 18,
                padding: 0, lineHeight: "16px", borderRadius: 9, fontSize: 11,
              }}
            >
              ✕
            </button>
          </div>
        ))}
        <button
          disabled={uploadingRef}
          onClick={() => refInputRef.current?.click()}
          style={{ width: 52, height: 52, fontSize: 20, flex: "0 0 auto" }}
        >
          {uploadingRef ? "…" : "+"}
        </button>
      </div>
      <input
        ref={refInputRef}
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) addRefImage(f);
        }}
      />
      {refIds.length > 0 && (
        <>
          <label className="muted" style={{ display: "block", marginTop: 6 }}>
            IP-Adapter weight · {ipWeight.toFixed(2)}
          </label>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={ipWeight}
            onChange={(e) => setIpWeight(+e.target.value)}
          />
        </>
      )}

      <button style={{ marginTop: 8 }} onClick={() => save()}>
        {saved ? "Saved ✓" : "Save character"}
      </button>
    </div>
  );
}
