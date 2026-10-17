"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type { TrackParameters } from "@/shared/parameters";
import { fadeGainAt } from "./levels";

/**
 * The live effect chain: everything the parameter editor shapes is applied here, to the one media
 * element the studio owns.
 *
 * The order is the one a mixer would draw it in — pre-amp, low shelf, mid bell, high shelf, pan,
 * compressor, make-up, envelope, meter — and a dry leg runs beside it so the editor's A/B switch
 * can step over the whole chain without rebuilding a node. Fades and the loop region are driven
 * from one `requestAnimationFrame` walk, which is also what meters the output.
 *
 * Two rules shape the lifecycle:
 *
 *   1. No `MediaElementSource` is created until the context is *running*. Routing an element into
 *      a suspended context silences it, and a source cannot be taken off an element again — so the
 *      graph is only attached once a user gesture has actually opened the context, and a browser
 *      that refuses simply leaves the element playing on its own.
 *   2. The chain is never torn down while the page lives. A second source cannot be made for the
 *      same element, so unmounting the graph would silence the track for the rest of the session;
 *      the hook outlives its re-renders instead.
 */

export type AudioGraphHandle = {
  /** The browser can build a graph here at all. */
  supported: boolean;
  /** The chain exists and the element is routed through it. */
  ready: boolean;
  /** The live meter's window, null until the chain is up. The meter polls it; this hook does not. */
  analyser: AnalyserNode | null;
  context: AudioContext | null;
};

/** The window the analyser fills — typed from the node itself so the two cannot drift apart. */
type Chain = {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preGain: GainNode;
  low: BiquadFilterNode;
  mid: BiquadFilterNode;
  high: BiquadFilterNode;
  panner: StereoPannerNode | null;
  compressor: DynamicsCompressorNode;
  makeup: GainNode;
  chain: GainNode;
  dry: GainNode;
  envelope: GainNode;
  analyser: AnalyserNode;
};

type Binding = { context: AudioContext; chain: Chain | null };

/** One binding per element, so a re-render can never build a second source for the same media. */
const bindings = new WeakMap<HTMLMediaElement, Binding>();

function contextCtor(): typeof AudioContext | undefined {
  if (typeof window === "undefined") return undefined;
  const legacy = window as unknown as { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? legacy.webkitAudioContext;
}

function build(context: AudioContext, element: HTMLMediaElement): Chain {
  const source = context.createMediaElementSource(element);
  const preGain = context.createGain();
  const low = context.createBiquadFilter();
  low.type = "lowshelf";
  low.frequency.value = 200;
  const mid = context.createBiquadFilter();
  mid.type = "peaking";
  mid.frequency.value = 1000;
  mid.Q.value = 0.9;
  const high = context.createBiquadFilter();
  high.type = "highshelf";
  high.frequency.value = 4000;
  // Stereo panning is the one node an older engine can lack; the chain simply skips it there.
  const panner = typeof context.createStereoPanner === "function" ? context.createStereoPanner() : null;
  const compressor = context.createDynamicsCompressor();
  compressor.knee.value = 6;
  const makeup = context.createGain();
  const chain = context.createGain();
  const dry = context.createGain();
  const envelope = context.createGain();
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;

  source.connect(preGain);
  preGain.connect(low);
  low.connect(mid);
  mid.connect(high);
  if (panner) {
    high.connect(panner);
    panner.connect(compressor);
  } else {
    high.connect(compressor);
  }
  compressor.connect(makeup);
  makeup.connect(chain);
  chain.connect(envelope);
  source.connect(dry);
  dry.connect(envelope);
  envelope.connect(analyser);
  analyser.connect(context.destination);

  return {
    context, source, preGain, low, mid, high, panner, compressor, makeup, chain, dry, envelope, analyser,
  };
}

/** Writes a parameter document into the chain. Short ramps, because a dragged dial must not click. */
function applyChain(chain: Chain, parameters: TrackParameters, bypass: boolean) {
  const now = chain.context.currentTime;
  const set = (parameter: AudioParam, value: number) => parameter.setTargetAtTime(value, now, 0.03);
  set(chain.preGain.gain, parameters.gain / 100);
  set(chain.low.gain, parameters.eq.low);
  set(chain.mid.gain, parameters.eq.mid);
  set(chain.high.gain, parameters.eq.high);
  if (chain.panner) set(chain.panner.pan, Math.max(-1, Math.min(1, parameters.pan / 100)));
  const compressor = parameters.compressor;
  if (compressor.on) {
    set(chain.compressor.threshold, compressor.threshold);
    set(chain.compressor.ratio, compressor.ratio);
    set(chain.compressor.attack, Math.max(0.001, compressor.attack));
    set(chain.compressor.release, Math.max(0.01, compressor.release));
    set(chain.makeup.gain, compressor.makeup / 100);
  } else {
    // A ratio of one is arithmetic transparency, which is as close to "off" as the node gets.
    set(chain.compressor.threshold, 0);
    set(chain.compressor.ratio, 1);
    set(chain.compressor.attack, 0.01);
    set(chain.compressor.release, 0.25);
    set(chain.makeup.gain, 1);
  }
  set(chain.chain.gain, bypass ? 0 : 1);
  set(chain.dry.gain, bypass ? 1 : 0);
}

export function useAudioGraph(
  media: RefObject<HTMLMediaElement | null>,
  parameters: TrackParameters,
  bypass = false,
): AudioGraphHandle {
  const [state, setState] = useState<AudioGraphHandle>({ supported: false, ready: false, analyser: null, context: null });
  const parametersRef = useRef(parameters);
  const bypassRef = useRef(bypass);
  const readyRef = useRef(false);
  parametersRef.current = parameters;
  bypassRef.current = bypass;

  // Whether this engine has Web Audio at all is only knowable in the browser; the first paint
  // says "no" and the mount effect corrects it, so the controls can dim until then.
  useEffect(() => {
    const supported = Boolean(contextCtor());
    setState((previous) => (previous.supported === supported ? previous : { ...previous, supported }));
  }, []);

  /**
   * Opens the context and attaches the chain. Called from a gesture and from `play`, in that
   * order of reliability: a pointer event is still inside its own activation, which is exactly
   * what `resume()` needs.
   */
  const attach = (element: HTMLMediaElement): Binding | null => {
    const Ctor = contextCtor();
    if (!Ctor) return null;
    let binding = bindings.get(element);
    if (!binding) {
      binding = { context: new Ctor(), chain: null };
      bindings.set(element, binding);
    }
    if (binding.chain) return binding;
    const current = binding;
    void current.context.resume().then(() => {
      if (current.chain || current.context.state !== "running") return;
      current.chain = build(current.context, element);
      applyChain(current.chain, parametersRef.current, bypassRef.current);
      readyRef.current = true;
      // One render, once: the meter gets its analyser and the controls learn the chain is live.
      setState((previous) => (previous.ready ? previous : { supported: true, ready: true, analyser: current.chain!.analyser, context: current.context }));
    }).catch(() => {
      // No gesture, or no Web Audio: the element keeps playing directly, which is the fallback
      // this whole lazy attach exists to preserve.
    });
    return binding;
  };

  // Re-apply on every edit; the reference updates above keep the frame walk reading the same values.
  useEffect(() => {
    const element = media.current;
    if (!element) return;
    const binding = bindings.get(element);
    if (binding?.chain) applyChain(binding.chain, parameters, bypass);
  }, [media, parameters, bypass]);

  // Pitch preservation is the element's own switch, not a node in the chain.
  useEffect(() => {
    const element = media.current as (HTMLMediaElement & { webkitPreservesPitch?: boolean }) | null;
    if (!element) return;
    try {
      element.preservesPitch = parameters.preservePitch;
    } catch {
      // An engine that only knows the prefixed name.
    }
    try {
      element.webkitPreservesPitch = parameters.preservePitch;
    } catch {
      // Neither switch exists; the rate just changes pitch the old way.
    }
  }, [media, parameters.preservePitch]);

  useEffect(() => {
    const element = media.current;
    if (!element) return;
    let frame: number | null = null;

    /** Applies the fade value where the playhead currently sits, playing or not. */
    const envelope = () => {
      const chain = bindings.get(element)?.chain;
      if (!chain) return;
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      chain.envelope.gain.setTargetAtTime(
        fadeGainAt(element.currentTime, duration, parametersRef.current.fadeIn, parametersRef.current.fadeOut),
        chain.context.currentTime,
        0.01,
      );
    };

    const tick = () => {
      frame = null;
      const chain = bindings.get(element)?.chain ?? null;
      const loop = parametersRef.current.loop;
      const duration = Number.isFinite(element.duration) ? element.duration : 0;
      if (loop.on && loop.end > loop.start && !element.seeking && element.currentTime >= loop.end - 0.03) {
        try {
          element.currentTime = loop.start;
        } catch {
          // The source went away between the check and the write.
        }
      }
      // The envelope is the only thing the frame walk writes; the meter reads the analyser from
      // its own component, so a playing track never re-renders the studio through this hook.
      if (chain) envelope();
      if (!element.paused && !element.ended) frame = window.requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame === null && !element.paused && !element.ended) frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
        frame = null;
      }
    };
    const gesture = () => {
      attach(element);
    };
    const onPlay = () => {
      attach(element);
      start();
    };
    const onStop = () => {
      stop();
      envelope();
    };

    element.addEventListener("play", onPlay);
    element.addEventListener("pause", onStop);
    element.addEventListener("ended", onStop);
    element.addEventListener("seeked", envelope);
    element.addEventListener("loadedmetadata", envelope);
    // A gesture anywhere on the page opens the context; the transport's own click is usually the
    // first one, and this catches the cases where the element was started by something else.
    document.addEventListener("pointerdown", gesture, true);
    document.addEventListener("keydown", gesture, true);
    if (!element.paused) onPlay();
    else envelope();

    return () => {
      stop();
      element.removeEventListener("play", onPlay);
      element.removeEventListener("pause", onStop);
      element.removeEventListener("ended", onStop);
      element.removeEventListener("seeked", envelope);
      element.removeEventListener("loadedmetadata", envelope);
      document.removeEventListener("pointerdown", gesture, true);
      document.removeEventListener("keydown", gesture, true);
    };
  }, [media]);

  return state;
}
