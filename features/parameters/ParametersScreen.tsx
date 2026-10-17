"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Activity, Pause, Play, Repeat, Sparkles, Undo2, X } from "@/design-system/components/icons";
import { WaveformTrack, meterOf, type AudioGraphHandle, type WaveformPeaks } from "@/features/player";
import {
  DEFAULT_TRACK_PARAMETERS,
  PARAMETER_LIMITS,
  PARAMETER_PRESETS,
  type ParameterPreset,
  type TrackParameters,
  type WaveformSettings,
} from "@/shared/parameters";
import { ParameterDial, ParameterToggle } from "./ParameterDial";
import "./parameters.css";

/**
 * The precision editor: the whole window, one waveform to shape, and every number that decides
 * how the track sounds. It owns nothing — the document is the studio's, the audio element is the
 * bar's, the effect chain is the player's — and every dial writes straight back through the
 * callbacks, which is what lets the screen be loaded on demand and unmounted without the
 * playback noticing.
 *
 * It reads the position from the element itself rather than taking it as a prop: a prop would
 * mean the studio re-rendering four times a second to hand down a number this view can watch on
 * its own.
 *
 * The three shapes on the page are deliberate. Tone and image are what the file is; dynamics and
 * fades are what happens to it over time; the wave's own settings are how it is drawn, and they
 * live with the local preferences rather than with the track.
 */

export type ParametersScreenProps = {
  title: string;
  /** Decorative bar heights, drawn until the decoded peaks arrive. */
  waveform: number[];
  peaks: WaveformPeaks | null;
  media: RefObject<HTMLMediaElement | null>;
  /** The live chain's reading: whether it is attached, and what it is putting out. */
  graph: AudioGraphHandle;
  playing: boolean;
  /** True when the document matches the one stored with the track. */
  saved: boolean;
  params: TrackParameters;
  waveformSettings: WaveformSettings;
  bypass: boolean;
  onParam: <K extends keyof TrackParameters>(key: K, value: TrackParameters[K]) => void;
  onWaveform: (patch: Partial<WaveformSettings>) => void;
  onPreset: (preset: ParameterPreset) => void;
  onReset: () => void;
  onRevert: () => void;
  onBypass: (next: boolean) => void;
  onTogglePlayback: () => void;
  onSave: () => void;
  onClose: () => void;
};

/** A level as the dBFS a meter prints; silence has no number, so it keeps its own glyph. */
function decibels(level: number): string {
  if (!(level > 0)) return "−∞";
  return (20 * Math.log10(level)).toFixed(1);
}

/**
 * The meter is the editor's own walk over the chain's analyser: the graph hands over the node and
 * says nothing more, so a screen that is not open costs the player nothing. The clip light holds
 * for about a second after the last sample at full scale, which is how long an eye needs to see it.
 */
function useMeter(analyser: AnalyserNode | null) {
  const [reading, setReading] = useState({ peak: 0, rms: 0, clipped: false });
  useEffect(() => {
    if (!analyser) {
      setReading({ peak: 0, rms: 0, clipped: false });
      return;
    }
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let last = 0;
    let clipUntil = 0;
    const tick = (now: number) => {
      analyser.getFloatTimeDomainData(samples);
      const { peak, rms } = meterOf(samples);
      if (peak >= 0.99) clipUntil = Date.now() + 1200;
      if (now - last >= 90) {
        last = now;
        const clipped = Date.now() < clipUntil;
        setReading((current) => (
          Math.abs(current.peak - peak) < 0.004 && Math.abs(current.rms - rms) < 0.004 && current.clipped === clipped
            ? current
            : { peak, rms, clipped }
        ));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [analyser]);
  return reading;
}

export default function ParametersScreen({
  title, waveform, peaks, media, graph, playing, saved,
  params, waveformSettings, bypass,
  onParam, onWaveform, onPreset, onReset, onRevert, onBypass, onTogglePlayback, onSave, onClose,
}: ParametersScreenProps) {
  /**
   * The keyboard is part of an editor this size: space runs the transport, L flips the loop, the
   * brackets drop its edges at the playhead, and B steps over the whole chain for a comparison.
   * The handler lives in a ref so the listener is bound once and still runs the newest closures.
   */
  const keysRef = useRef<(event: KeyboardEvent) => void>(() => {});
  keysRef.current = (event: KeyboardEvent) => {
    const target = event.target;
    const typing = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable);
    if (event.metaKey || event.ctrlKey) {
      if (!typing && (event.key === "s" || event.key === "S")) {
        event.preventDefault();
        onSave();
      }
      return;
    }
    if (event.altKey || typing) return;
    const at = media.current && Number.isFinite(media.current.currentTime) ? media.current.currentTime : 0;
    if (event.key === " " || event.code === "Space") {
      event.preventDefault();
      if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) document.activeElement.blur();
      onTogglePlayback();
    } else if (event.key === "l" || event.key === "L") {
      onParam("loop", { ...params.loop, on: !params.loop.on });
    } else if (event.key === "[") {
      onParam("loop", { ...params.loop, on: true, start: Math.max(0, at) });
    } else if (event.key === "]") {
      onParam("loop", { ...params.loop, on: true, end: at > params.loop.start ? at : 0 });
    } else if (event.key === "b" || event.key === "B") {
      onBypass(!bypass);
    }
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => keysRef.current(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const meter = useMeter(graph.analyser);

  function setLoopEdge(which: "start" | "end") {
    const at = media.current && Number.isFinite(media.current.currentTime) ? Math.max(0, media.current.currentTime) : 0;
    if (which === "start") onParam("loop", { ...params.loop, on: true, start: at, end: params.loop.end > at ? params.loop.end : 0 });
    else onParam("loop", { ...params.loop, on: true, end: at > params.loop.start ? at : 0 });
  }

  const levelPercent = Math.min(1, meter.peak) * 100;
  const rmsPercent = Math.min(1, meter.rms) * 100;

  return (
    <section className="parameter-screen">
      <div className="parameter-header">
        <div>
          <p className="eyebrow">Full parameter editor</p>
          <h1>{title}</h1>
          <p className={`parameter-status${saved ? "" : " is-dirty"}`}>
            {saved ? "Every dial on this page is stored with the track." : "Unsaved changes — save to keep them with this track."}
          </p>
        </div>
        <div className="parameter-header-actions">
          <button
            className={`toolbar-button parameter-ab${bypass ? " is-on" : ""}`}
            data-glass-edge=""
            aria-pressed={bypass}
            onClick={() => onBypass(!bypass)}
          >
            <Activity size={15} /> {bypass ? "Chain bypassed" : "A/B compare"}
          </button>
          <button className="ghost-button" data-glass-edge="" onClick={onClose}><X size={16} /> Close editor</button>
        </div>
      </div>

      <div className="parameter-wave-card" data-glass-edge="">
        <div className="wave-toolbar">
          <span><Activity size={15} /> Editable waveform</span>
          <span className="wave-hint">drag to scrub · wheel to zoom · double-click to fit · Alt-drag for a loop</span>
        </div>
        <WaveformTrack
          media={media}
          waveform={waveform}
          peaks={peaks}
          options={waveformSettings}
          loop={params.loop}
          onLoopChange={(loop) => onParam("loop", loop)}
          onOptionsChange={onWaveform}
          ariaLabel="Seek waveform in the parameter editor"
        />
        <div className="wave-control-grid">
          <ParameterDial label="Amplitude" value={waveformSettings.amplitude} min={PARAMETER_LIMITS.amplitude.min} max={PARAMETER_LIMITS.amplitude.max} step={PARAMETER_LIMITS.amplitude.step} unit="%" home={100} hint="How tall the wave is drawn." onChange={(amplitude) => onWaveform({ amplitude })} />
          <ParameterDial label="Peak / body" value={waveformSettings.smoothing} min={PARAMETER_LIMITS.smoothing.min} max={PARAMETER_LIMITS.smoothing.max} step={PARAMETER_LIMITS.smoothing.step} unit="%" home={20} hint="0 draws the sharp peaks, 100 the average body." onChange={(smoothing) => onWaveform({ smoothing })} />
          <ParameterDial label="Bars" value={waveformSettings.resolution} min={PARAMETER_LIMITS.resolution.min} max={PARAMETER_LIMITS.resolution.max} step={PARAMETER_LIMITS.resolution.step} home={220} hint="How many bars fill the viewport." onChange={(resolution) => onWaveform({ resolution })} />
          <ParameterDial label="Gap" value={waveformSettings.gap} min={PARAMETER_LIMITS.gap.min} max={PARAMETER_LIMITS.gap.max} step={PARAMETER_LIMITS.gap.step} unit="%" home={30} hint="Space between two bars, as a share of a bar." onChange={(gap) => onWaveform({ gap })} />
          <ParameterDial label="Zoom" value={waveformSettings.zoom} min={PARAMETER_LIMITS.zoom.min} max={PARAMETER_LIMITS.zoom.max} step={PARAMETER_LIMITS.zoom.step} unit="×" home={1} hint="1 shows the whole track; the wheel zooms around the pointer." onChange={(zoom) => onWaveform({ zoom, scroll: zoom === 1 ? 0.5 : waveformSettings.scroll })} />
          <ParameterDial label="Window" value={waveformSettings.scroll} min={PARAMETER_LIMITS.scroll.min} max={PARAMETER_LIMITS.scroll.max} step={PARAMETER_LIMITS.scroll.step} home={0.5} disabled={waveformSettings.zoom <= 1} hint="Where the zoomed window sits in the track." onChange={(scroll) => onWaveform({ scroll })} />
        </div>
        <div className="wave-toggle-row">
          <ParameterToggle label="Mirror" checked={waveformSettings.mirror} onChange={(mirror) => onWaveform({ mirror })} />
          <ParameterToggle label="Grid" checked={waveformSettings.grid} onChange={(grid) => onWaveform({ grid })} />
          <ParameterToggle label="Playhead" checked={waveformSettings.playhead} onChange={(playhead) => onWaveform({ playhead })} />
          <button className="small-action" data-glass-edge="" onClick={() => onWaveform({ zoom: 1, scroll: 0.5 })}>Fit whole track</button>
        </div>
      </div>

      <div className="parameter-grid">
        <section className="parameter-card" data-glass-edge="">
          <div className="panel-title"><Play size={16} /><h3>Playback</h3></div>
          <ParameterDial label="Playback rate" value={params.rate} min={PARAMETER_LIMITS.rate.min} max={PARAMETER_LIMITS.rate.max} step={PARAMETER_LIMITS.rate.step} unit="%" home={100} hint="100 % plays at the file's own speed." onChange={(rate) => onParam("rate", rate)} />
          <ParameterDial label="Preview volume" value={params.volume} min={PARAMETER_LIMITS.volume.min} max={PARAMETER_LIMITS.volume.max} step={PARAMETER_LIMITS.volume.step} unit="%" home={DEFAULT_TRACK_PARAMETERS.volume} hint="The same level the transport bar's speaker shows." onChange={(volume) => onParam("volume", volume)} />
          <div className="parameter-row">
            <ParameterToggle label="Keep pitch" checked={params.preservePitch} onChange={(preservePitch) => onParam("preservePitch", preservePitch)} />
          </div>
          {/* No glass mark here: the veil rule repaints every marked surface white, and this one
              is the accent button — it keeps its own fill like every other primary button. */}
          <button className="primary-button" onClick={onTogglePlayback}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause preview" : "Play preview"}</button>
          <div className={`parameter-meter${meter.clipped ? " is-clipped" : ""}`}>
            <div className="meter-rail">
              <div className="meter-rms" style={{ width: `${rmsPercent}%` }} />
              <div className="meter-peak" style={{ width: `${levelPercent}%` }} />
            </div>
            <div className="meter-foot">
              <span>{graph.ready ? `out ${decibels(meter.peak)} dBFS` : graph.supported ? "chain starts with playback" : "no Web Audio in this browser"}</span>
              <span className={`clip${meter.clipped ? " is-hot" : ""}`}>CLIP</span>
            </div>
          </div>
        </section>

        <section className="parameter-card" data-glass-edge="">
          <div className="panel-title"><Activity size={16} /><h3>Tone &amp; image</h3></div>
          <ParameterDial label="Low" value={params.eq.low} min={PARAMETER_LIMITS.eqLow.min} max={PARAMETER_LIMITS.eqLow.max} step={PARAMETER_LIMITS.eqLow.step} unit="dB" home={0} onChange={(low) => onParam("eq", { ...params.eq, low })} />
          <ParameterDial label="Mid" value={params.eq.mid} min={PARAMETER_LIMITS.eqMid.min} max={PARAMETER_LIMITS.eqMid.max} step={PARAMETER_LIMITS.eqMid.step} unit="dB" home={0} onChange={(mid) => onParam("eq", { ...params.eq, mid })} />
          <ParameterDial label="High" value={params.eq.high} min={PARAMETER_LIMITS.eqHigh.min} max={PARAMETER_LIMITS.eqHigh.max} step={PARAMETER_LIMITS.eqHigh.step} unit="dB" home={0} onChange={(high) => onParam("eq", { ...params.eq, high })} />
          <ParameterDial label="Stereo pan" value={params.pan} min={PARAMETER_LIMITS.pan.min} max={PARAMETER_LIMITS.pan.max} step={PARAMETER_LIMITS.pan.step} home={0} hint="−100 is hard left, 100 hard right." onChange={(pan) => onParam("pan", pan)} />
          <ParameterDial label="Pre-amp gain" value={params.gain} min={PARAMETER_LIMITS.gain.min} max={PARAMETER_LIMITS.gain.max} step={PARAMETER_LIMITS.gain.step} unit="%" home={100} hint="The level fed into the chain, before the tone controls." onChange={(gain) => onParam("gain", gain)} />
        </section>

        <section className="parameter-card" data-glass-edge="">
          <div className="panel-title"><Sparkles size={16} /><h3>Dynamics</h3></div>
          <div className="parameter-row">
            <ParameterToggle label="Compressor" checked={params.compressor.on} onChange={(on) => onParam("compressor", { ...params.compressor, on })} />
          </div>
          <ParameterDial label="Threshold" value={params.compressor.threshold} min={PARAMETER_LIMITS.threshold.min} max={PARAMETER_LIMITS.threshold.max} step={PARAMETER_LIMITS.threshold.step} unit="dB" home={-24} disabled={!params.compressor.on} onChange={(threshold) => onParam("compressor", { ...params.compressor, threshold })} />
          <ParameterDial label="Ratio" value={params.compressor.ratio} min={PARAMETER_LIMITS.ratio.min} max={PARAMETER_LIMITS.ratio.max} step={PARAMETER_LIMITS.ratio.step} home={3} disabled={!params.compressor.on} onChange={(ratio) => onParam("compressor", { ...params.compressor, ratio })} />
          <ParameterDial label="Attack" value={params.compressor.attack} min={PARAMETER_LIMITS.attack.min} max={PARAMETER_LIMITS.attack.max} step={PARAMETER_LIMITS.attack.step} unit="s" home={0.01} disabled={!params.compressor.on} onChange={(attack) => onParam("compressor", { ...params.compressor, attack })} />
          <ParameterDial label="Release" value={params.compressor.release} min={PARAMETER_LIMITS.release.min} max={PARAMETER_LIMITS.release.max} step={PARAMETER_LIMITS.release.step} unit="s" home={0.25} disabled={!params.compressor.on} onChange={(release) => onParam("compressor", { ...params.compressor, release })} />
          <ParameterDial label="Make-up" value={params.compressor.makeup} min={PARAMETER_LIMITS.makeup.min} max={PARAMETER_LIMITS.makeup.max} step={PARAMETER_LIMITS.makeup.step} unit="%" home={100} disabled={!params.compressor.on} onChange={(makeup) => onParam("compressor", { ...params.compressor, makeup })} />
        </section>

        <section className="parameter-card" data-glass-edge="">
          <div className="panel-title"><Repeat size={16} /><h3>Fades &amp; loop</h3></div>
          <ParameterDial label="Fade in" value={params.fadeIn} min={PARAMETER_LIMITS.fade.min} max={PARAMETER_LIMITS.fade.max} step={PARAMETER_LIMITS.fade.step} unit="s" home={0} onChange={(fadeIn) => onParam("fadeIn", fadeIn)} />
          <ParameterDial label="Fade out" value={params.fadeOut} min={PARAMETER_LIMITS.fade.min} max={PARAMETER_LIMITS.fade.max} step={PARAMETER_LIMITS.fade.step} unit="s" home={0} onChange={(fadeOut) => onParam("fadeOut", fadeOut)} />
          <div className="parameter-row">
            <ParameterToggle label="A/B loop" checked={params.loop.on} onChange={(on) => onParam("loop", { ...params.loop, on })} />
          </div>
          <ParameterDial label="Loop from" value={params.loop.start} min={PARAMETER_LIMITS.loopTime.min} max={PARAMETER_LIMITS.loopTime.max} step={PARAMETER_LIMITS.loopTime.step} unit="s" home={0} disabled={!params.loop.on} onChange={(start) => onParam("loop", { ...params.loop, start })} />
          <ParameterDial label="Loop to" value={params.loop.end} min={PARAMETER_LIMITS.loopTime.min} max={PARAMETER_LIMITS.loopTime.max} step={PARAMETER_LIMITS.loopTime.step} unit="s" home={0} disabled={!params.loop.on} hint="0 plays on to the end of the track." onChange={(end) => onParam("loop", { ...params.loop, end })} />
          <div className="parameter-actions">
            <button className="small-action" data-glass-edge="" onClick={() => setLoopEdge("start")}>Set from playhead</button>
            <button className="small-action" data-glass-edge="" onClick={() => setLoopEdge("end")}>Set to playhead</button>
          </div>
        </section>

        <section className="parameter-card parameter-presets" data-glass-edge="">
          <div className="panel-title"><Sparkles size={16} /><h3>Presets &amp; saving</h3></div>
          <p className="parameter-hint">A preset moves tone and dynamics only — never the rate, the fades or the loop, which belong to this take.</p>
          <div className="preset-row">
            {PARAMETER_PRESETS.map((preset) => (
              <button key={preset.id} className="preset-button" data-glass-edge="" title={preset.hint} onClick={() => onPreset(preset)}>{preset.name}</button>
            ))}
          </div>
          <div className="parameter-actions">
            <button className="small-action" data-glass-edge="" disabled={saved} onClick={onRevert}><Undo2 size={14} /> Revert changes</button>
            <button className="small-action" data-glass-edge="" onClick={onReset}>Reset to flat</button>
            <button className="save-button" onClick={onSave} disabled={saved}>{saved ? "All changes saved" : "Save parameters"}</button>
          </div>
          <p className="parameter-shortcuts">Space plays · L loops · [ and ] set the loop edges at the playhead · B bypasses the chain · ⌘S saves</p>
        </section>
      </div>
    </section>
  );
}
