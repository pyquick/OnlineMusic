"use client";

import type { RefObject } from "react";
import { Activity, Pause, Play, SlidersHorizontal, X } from "lucide-react";
import { RangeControl } from "@/design-system/components/RangeControl";
import { WaveformTrack } from "@/features/player";

/**
 * The precision editor: the whole window, one waveform to seek on, and the numbers that shape
 * the sound. It owns nothing — the values are the studio's, the audio element is the bar's, and
 * every dial writes straight back through `onChange` — which is what lets it be loaded on demand
 * and unmounted without the playback noticing.
 *
 * It reads the position from the element itself rather than taking it as a prop: a prop would
 * mean the studio re-rendering four times a second to hand down a number this view can watch
 * on its own.
 */
export type ParametersScreenProps = {
  title: string;
  media: RefObject<HTMLMediaElement | null>;
  waveform: number[];
  playing: boolean;
  saved: boolean;
  rate: number; volume: number; gain: number; eq: number; fadeIn: number; fadeOut: number;
  onRate: (next: number) => void;
  onVolume: (next: number) => void;
  onGain: (next: number) => void;
  onEq: (next: number) => void;
  onFadeIn: (next: number) => void;
  onFadeOut: (next: number) => void;
  onTogglePlayback: () => void;
  onSave: () => void;
  onClose: () => void;
};

export default function ParametersScreen({
  title, media, waveform, playing, saved,
  rate, volume, gain, eq, fadeIn, fadeOut,
  onRate, onVolume, onGain, onEq, onFadeIn, onFadeOut,
  onTogglePlayback, onSave, onClose,
}: ParametersScreenProps) {
  return (
    <section className="parameter-screen">
      <div className="parameter-header"><h1>{title}</h1><button className="ghost-button" data-glass-edge="" onClick={onClose}><X size={16} /> Close editor</button></div>
      <div className="parameter-wave-card" data-glass-edge="">
        <div className="wave-toolbar"><span><Activity size={15} /> Editable waveform</span><span className="wave-hint">Click anywhere to seek</span></div>
        <WaveformTrack media={media} waveform={waveform} ariaLabel="Seek waveform in parameter editor" />
      </div>
      <div className="parameter-grid">
        <div className="parameter-card" data-glass-edge="">
          <div className="panel-title"><Activity size={17} /><h3>Playback</h3></div>
          <RangeControl label="Playback rate" value={rate} min={25} max={200} display={`${(rate / 100).toFixed(2)}x`} onChange={onRate} />
          <RangeControl label="Preview volume" value={volume} min={0} max={100} display={`${volume}%`} onChange={onVolume} />
          <button className="primary-button" data-glass-edge="" onClick={onTogglePlayback}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause preview" : "Play preview"}</button>
        </div>
        <div className="parameter-card" data-glass-edge="">
          <div className="panel-title"><SlidersHorizontal size={17} /><h3>Dynamics &amp; tone</h3></div>
          <RangeControl label="Gain" value={gain} min={0} max={150} display={`${gain}%`} onChange={onGain} />
          <RangeControl label="Tone / EQ" value={eq} min={-100} max={100} display={`${eq > 0 ? "+" : ""}${eq}`} onChange={onEq} />
          <RangeControl label="Fade in" value={fadeIn} min={0} max={30} display={`${fadeIn}s`} onChange={onFadeIn} />
          <RangeControl label="Fade out" value={fadeOut} min={0} max={30} display={`${fadeOut}s`} onChange={onFadeOut} />
          <button className="save-button" onClick={onSave}>{saved ? "Parameters saved" : "Save parameters"}</button>
        </div>
      </div>
    </section>
  );
}
