"use client";

import type { MouseEvent as ReactMouseEvent } from "react";
import { Activity, Pause, Play, SlidersHorizontal, X } from "lucide-react";
import { RangeControl } from "@/design-system/components/RangeControl";

/**
 * The precision editor: the whole window, one waveform to seek on, and the numbers that shape
 * the sound. It owns nothing — the values are the studio's, the audio element is the bar's, and
 * every dial writes straight back through `onChange` — which is what lets it be loaded on demand
 * and unmounted without the playback noticing.
 */
export type ParametersScreenProps = {
  title: string;
  waveform: number[];
  duration: number;
  currentTime: number;
  previewProgress: number;
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
  onSeekPointer: (event: ReactMouseEvent<HTMLElement>) => void;
  onClose: () => void;
  formatTime: (seconds: number) => string;
};

export default function ParametersScreen({
  title, waveform, duration, currentTime, previewProgress, playing, saved,
  rate, volume, gain, eq, fadeIn, fadeOut,
  onRate, onVolume, onGain, onEq, onFadeIn, onFadeOut,
  onTogglePlayback, onSave, onSeekPointer, onClose, formatTime,
}: ParametersScreenProps) {
  return (
    <section className="parameter-screen">
      <div className="parameter-header"><h1>{title}</h1><button className="ghost-button" onClick={onClose}><X size={16} /> Close editor</button></div>
      <div className="parameter-wave-card">
        <div className="wave-toolbar"><span><Activity size={15} /> Editable waveform</span><span className="wave-hint">Click anywhere to seek</span></div>
        <div className="wave-track interactive-wave" onClick={onSeekPointer} role="slider" aria-label="Seek waveform in parameter editor" aria-valuemin={0} aria-valuemax={duration} aria-valuenow={currentTime} tabIndex={0}><div className="wave-bars">{waveform.map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}</div><div className="playhead" style={{ left: `${previewProgress}%` }} /></div>
        <div className="wave-times"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
      </div>
      <div className="parameter-grid">
        <div className="parameter-card">
          <div className="panel-title"><Activity size={17} /><h3>Playback</h3></div>
          <RangeControl label="Playback rate" value={rate} min={25} max={200} display={`${(rate / 100).toFixed(2)}x`} onChange={onRate} />
          <RangeControl label="Preview volume" value={volume} min={0} max={100} display={`${volume}%`} onChange={onVolume} />
          <button className="primary-button" onClick={onTogglePlayback}>{playing ? <Pause size={15} /> : <Play size={15} />} {playing ? "Pause preview" : "Play preview"}</button>
        </div>
        <div className="parameter-card">
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
