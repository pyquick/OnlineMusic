"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { MAX_EDGE_OFFSET, MAX_BAND_PX, type GlassGroup, type GlassGroupValues } from "@/lib/glassEdge";
import { RangeControl } from "@/design-system/components/RangeControl";
import "./appearance.css";
import {
  GRADIENT_PRESETS, GLASS_BLUR_STEP, MAX_GLASS_BLUR, SOLID_PRESETS, TINT_PRESETS,
  hexToRgb, prepareBackgroundImage, rgbToHex, type Appearance,
} from "./model";

/** The seven families a rim can belong to, in the order the preview lays their samples out. Each
    row's sliders show the effective value — the family's own if it has one, the global sliders'
    otherwise — and "Follow" clears the override. */
const GLASS_FAMILIES: { id: GlassGroup; label: string }[] = [
  { id: "pane", label: "Panels" },
  { id: "card", label: "Cards" },
  { id: "button", label: "Buttons" },
  { id: "field", label: "Fields" },
  { id: "chip", label: "Chips" },
  { id: "capsule", label: "Capsule" },
  { id: "tile", label: "Bar tiles" },
];

export type SettingsViewProps = {
  blur: number; onBlur: (next: number) => void;
  clarity: number; onClarity: (next: number) => void;
  edge: number; onEdge: (next: number) => void;
  refraction: number; onRefraction: (next: number) => void;
  radius: number; onRadius: (next: number) => void;
  appearance: Appearance;
  onAppearance: (patch: Partial<Appearance>) => void;
  /** Per-family edge refraction; a family absent here follows the two global sliders. */
  groups: GlassGroupValues;
  onGroups: (next: GlassGroupValues) => void;
  onClose: () => void;
};

export default function AppearanceSettings({ blur, onBlur, clarity, onClarity, edge, onEdge, refraction, onRefraction, radius, onRadius, appearance, onAppearance, groups, onGroups, onClose }: SettingsViewProps) {
  const [imageError, setImageError] = useState("");
  const [busy, setBusy] = useState(false);
  const imageInput = useRef<HTMLInputElement>(null);

  async function chooseBackgroundImage(file: File | undefined) {
    if (!file) return;
    setImageError("");
    setBusy(true);
    const prepared = await prepareBackgroundImage(file);
    setBusy(false);
    if ("error" in prepared) { setImageError(prepared.error); return; }
    onAppearance({ bgKind: "image", bgImage: prepared.uri, shellLuma: prepared.luma });
  }

  return (
    <section className="settings-page">
      <header className="settings-page-head">
        <h1>Appearance</h1>
        <button className="ghost-button" data-glass-edge="" onClick={onClose}><X size={16} /> Close</button>
      </header>

      <div className="settings-card panel" data-glass-edge="">
        <div className="panel-title"><h3>Glass tint</h3></div>
        <div className="settings-page-body">
          <div className="swatch-row">
            {TINT_PRESETS.map((preset) => (
              <button key={preset.id} className={`swatch ${appearance.tint === preset.rgb ? "is-on" : ""}`} style={{ background: `rgb(${preset.rgb})` }} onClick={() => onAppearance({ tint: preset.rgb })} aria-label={preset.label} title={preset.label} />
            ))}
            <label className="swatch swatch-custom" title="Custom tint">
              <input type="color" value={rgbToHex(appearance.tint)} onChange={(event) => onAppearance({ tint: hexToRgb(event.target.value) })} aria-label="Custom tint" />
            </label>
          </div>
          <label className="toggle-row"><input type="checkbox" checked={appearance.shade} onChange={(event) => onAppearance({ shade: event.target.checked })} /><span>Darken and lighten with the backdrop</span></label>
          <p className="settings-hint">The colour the glass lays down. Auto-shade darkens it over a dark backdrop without shifting its hue; turn it off to pin the tint whatever it covers.</p>
        </div>
      </div>

      <div className="settings-card panel" data-glass-edge="">
        <div className="panel-title"><h3>Background</h3></div>
        <div className="settings-page-body">
          <div className="segmented">
            <button className={appearance.bgKind === "preset" ? "is-on" : ""} onClick={() => onAppearance({ bgKind: "preset", shellLuma: SOLID_PRESETS.find((preset) => preset.id === appearance.bgPreset)?.luma ?? 0.96 })}>Solid</button>
            <button className={appearance.bgKind === "gradient" ? "is-on" : ""} onClick={() => onAppearance({ bgKind: "gradient", shellLuma: GRADIENT_PRESETS.find((preset) => preset.id === appearance.bgGradient)?.luma ?? 0.96 })}>Gradient</button>
            <button className={appearance.bgKind === "image" ? "is-on" : ""} onClick={() => onAppearance({ bgKind: "image", shellLuma: appearance.bgImage ? appearance.shellLuma : 0.96 })}>Image</button>
          </div>
          {appearance.bgKind === "preset" && (
            <div className="swatch-row">
              {SOLID_PRESETS.map((preset) => (
                <button key={preset.id} className={`swatch ${appearance.bgPreset === preset.id ? "is-on" : ""}`} style={{ background: preset.color }} onClick={() => onAppearance({ bgPreset: preset.id, shellLuma: preset.luma })} aria-label={preset.label} title={preset.label} />
              ))}
            </div>
          )}
          {appearance.bgKind === "gradient" && (
            <div className="swatch-row">
              {GRADIENT_PRESETS.map((preset) => (
                <button key={preset.id} className={`swatch ${appearance.bgGradient === preset.id ? "is-on" : ""}`} style={{ background: preset.css }} onClick={() => onAppearance({ bgGradient: preset.id, shellLuma: preset.luma })} aria-label={preset.label} title={preset.label} />
              ))}
            </div>
          )}
          {appearance.bgKind === "image" && (
            <>
              <div className="bg-image-row">
                <button className="toolbar-button" data-glass-edge="" onClick={() => imageInput.current?.click()} disabled={busy}>{busy ? "Preparing…" : appearance.bgImage ? "Replace image" : "Choose image"}</button>
                {appearance.bgImage && <button className="toolbar-button" data-glass-edge="" onClick={() => onAppearance({ bgImage: "", bgKind: "preset", shellLuma: SOLID_PRESETS.find((preset) => preset.id === appearance.bgPreset)?.luma ?? 0.96 })}>Remove</button>}
                <input ref={imageInput} type="file" accept="image/*" hidden onChange={(event) => { void chooseBackgroundImage(event.target.files?.[0]); event.target.value = ""; }} />
              </div>
              {imageError && <p className="error-message">{imageError}</p>}
              <RangeControl label="Dim" value={appearance.bgDim} min={0} max={80} display={`${appearance.bgDim}%`} onChange={(next) => onAppearance({ bgDim: next })} />
              <p className="settings-hint">Shrunk to 1600px on its long side and kept in this browser — never uploaded. Its brightness is measured as it goes in, so the glass and the page type know what they sit on.</p>
            </>
          )}
        </div>
      </div>

      <div className="settings-card panel" data-glass-edge="">
        <div className="panel-title"><h3>Liquid glass</h3></div>
        <div className="settings-page-body">
          <RangeControl label="Blur" value={blur} min={0} max={MAX_GLASS_BLUR} step={GLASS_BLUR_STEP} display={`${blur}px`} onChange={onBlur} />
          <RangeControl label="Clarity" value={clarity} min={0} max={100} display={`${clarity}%`} onChange={onClarity} />
          <RangeControl label="Corner radius" value={radius} min={50} max={150} display={`${radius}%`} onChange={onRadius} />
          <p className="settings-hint">Blur frosts what sits behind a pane and clarity is how much of it shows through; both apply live and are saved in this browser. Edge distortion and edge refraction now live per family, in the card below.</p>
        </div>
      </div>

      <div className="settings-card panel" data-glass-edge="">
        <div className="panel-title"><h3>Liquid glass · per control</h3></div>
        <div className="settings-page-body">
          <p className="settings-hint">Every family carries its own edge distortion (how hard the rim bends the backdrop) and edge refraction (how far in the bend reaches). The preview sits on stripes — a flat colour has nothing for a rim to bend — and answers every slider live. “Reset” returns a family to the studio defaults.</p>
          <div className="lgs-stage" data-glass-edge="" aria-hidden="true">
            <span className="lgs-sample lgs-pane" data-glass-edge="">Panel</span>
            <span className="lgs-sample lgs-card" data-glass-edge="">Card</span>
            <button className="lgs-sample lgs-button" data-glass-edge="" type="button" tabIndex={-1}>Button</button>
            <span className="lgs-sample lgs-field" data-glass-edge="">Field</span>
            <span className="lgs-sample lgs-chip" data-glass-edge="">Chip</span>
            <span className="lgs-sample lgs-capsule" data-glass-edge="">Capsule</span>
            <span className="lgs-sample lgs-tile" data-glass-edge="">◍</span>
          </div>
          <div className="lgs-rows">
            {GLASS_FAMILIES.map((family) => {
              const own = groups[family.id];
              const band = own?.band ?? refraction;
              const pull = own?.pull ?? edge;
              const set = (patch: { band?: number; pull?: number }) => onGroups({ ...groups, [family.id]: { band: patch.band ?? band, pull: patch.pull ?? pull } });
              return (
                <div className={`lgs-row ${own ? "is-own" : ""}`} key={family.id} data-sample={family.id}>
                  <span className="lgs-name">{family.label}</span>
                  <label className="lgs-ctl" title="Edge refraction — how far in the bend reaches">Width
                    <input type="range" min={0} max={MAX_BAND_PX} value={band} onChange={(event) => set({ band: Number(event.target.value) })} />
                    <b>{band}px</b>
                  </label>
                  <label className="lgs-ctl" title="Edge distortion — how hard the rim bends the backdrop">Strength
                    <input type="range" min={0} max={MAX_EDGE_OFFSET} value={pull} onChange={(event) => set({ pull: Number(event.target.value) })} />
                    <b>{pull}px</b>
                  </label>
                  <button className="ghost-button lgs-follow" type="button" disabled={!own} onClick={() => { const next = { ...groups }; delete next[family.id]; onGroups(next); }}>Reset</button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
