/**
 * Adaptive ink: the text on a glass pane follows the brightness of the backdrop it is showing —
 * light page, dark type; a dark scene, light type; a mixed or middling one, a grey between the two.
 *
 * The reading is measured, not guessed, and it is taken where the glyphs are: every run of text in
 * a pane is judged against what sits behind *it*, because a tall pane can straddle a pale page and
 * a dark cover at once, and no single ink is readable on both.
 *
 * Each run is handed a mix — how far its ink has to travel from the pane's own dark type toward its
 * light counterpart — written as `--ink-mix`, which the stylesheet mixes in. The scale is
 * continuous, so a scene in the middle of the range gets a grey rather than a coin toss.
 *
 * Per pane, each media element behind the glass (a video frame, a cover image) has the slice that
 * is visible under the pane drawn once into a 16x16 canvas: one tiny readback gives a coarse
 * brightness map of that media, and every text rect is then scored against the map's cells plus the
 * pane's baseline (the studio's paper-white, or the overlay's near-black inside the video overlay).
 * Only panes whose scene can have changed are re-read, a few times a second, so the cost never
 * lands on a frame: the whole tick is a handful of rects, one 16x16 blit per media slice, and
 * arithmetic.
 *
 * The same reading feeds the prism: each pane also wears a `--glass-glow`, its backdrop's
 * brightness lifted onto a floor, which both engines scale the rainbow's channel split by — so the
 * brightest scenes disperse the most, and every pane's rainbow answers the scene under it.
 */

/** How often the scene is re-read. `dirty` panes are sampled on the next tick after the change. */
const SAMPLE_MS = 250;
/** The studio's page, cards and chrome are paper-white: text over them sits on a light surface. */
const PAGE_LUMA = 0.96;
/** The video overlay paints itself near-black, and its panes stand on it wherever the frame cannot. */
const OVERLAY_LUMA = 0.03;
/**
 * How the video overlay is found. The attribute is the whole contract — the overlay root carries
 * it (`data-glass-layer="video"`), so nothing here has to know the app's class names, and a pane
 * inside it or above it belongs to the overlay's scene rather than the page's.
 */
const VIDEO_LAYER = "[data-glass-layer='video']";
/**
 * The mix's ends, read on the *surface* the glyphs sit on — the pane's own white veil laid over
 * whatever is behind it, not the backdrop alone. The veil lifts everything: a mid-grey video under
 * a dense pane leaves a surface of 0.77, and judging that backdrop directly is what once pushed
 * light grey type onto a light grey pane. At or under the first value the surface is dark and the
 * ink goes all the way to its light counterpart; at or over the second it is light and the ink
 * stays as drawn. The span between them is walked continuously, so a middling surface gets a grey.
 * Glass over the page lands at ~0.98, over a dark cover at ~0.57, over black video at ~0.56, and
 * over a mid-grey video at ~0.77.
 */
const DARK_BELOW = 0.65;
const LIGHT_ABOVE = 0.76;
/** The mix is only rewritten once it has moved this far, so a drifting scene cannot flicker. */
const STEP = 0.08;
/**
 * The glass's own shade is allowed to move in finer steps than the type is: it is a large,
 * low-contrast surface rather than thin strokes, so the thing that forces a dead-band on the ink
 * — a glyph edge flickering between two greys — does not apply to it, and a scene sliding under
 * the bar should be followed as closely as the sampler's clock allows.
 */
const SHADE_STEP = 0.02;
/**
 * Where the glass starts to darken with what is behind it, and where it can get no darker. A pane
 * over paper-white stays exactly the tint that was chosen; over a dark video or a dark wallpaper
 * it loses up to SHADE_MAX of that tint's brightness — the same hue, scaled down, which is what
 * the CSS does with `--glass-shade`.
 *
 * Read on the backdrop itself, not on the veil laid over it. The veil is white and usually thick
 * enough to lift even a black scene to a surface of ~0.5, so a ramp scored there would sit at
 * zero for every scene and the glass would never darken at all.
 */
const SHADE_DARK = 0.62;
const SHADE_FLOOR = 0.15;
const SHADE_MAX = 0.85;
/**
 * The dispersion gain's floor. The user's rule for the rainbow is that the brighter the place,
 * the more visible its refraction, and the sampler is the one thing that knows how bright each
 * pane's backdrop actually is — so it publishes a 0–1 gain per pane (`--glass-glow`), which both
 * engines scale their channel split by. Dark maps to the floor rather than to zero: a pitch-black
 * scene keeps a fifth of the split, because the glass still has an edge there and a rainbow that
 * switched off entirely would read as a bug rather than as physics.
 */
const GLOW_FLOOR = 0.2;
/**
 * The two ends past the mix. Type is grey by default and stays grey through the whole of the
 * studio's own range, but a backdrop at the extremes calls for type at its extreme: over a black
 * video or photo the greys go all the way to white, over a pure-white one all the way to black.
 * --ink-top is a light grey rather than white and --ink-base a grey rather than black, so the mix
 * alone tops out short of both and these two ramps carry it the rest of the way.
 *
 * Scored on the backdrop, not on the veiled surface the mix uses. The studio's own paper page
 * sits at 0.96 and its panes compose to nearly 1.0, so a ramp read on the surface would drag
 * every grey in the app to black on an untouched page. They cannot both be active at once, so the
 * order the stylesheet applies them in does not matter.
 */
const SOLID_BELOW = 0.06;
const SOLID_ABOVE = 0.34;
const PALE_BELOW = 0.97;
const PALE_ABOVE = 0.998;
/** Settings can pin the glass to the tint it was given, whatever it is covering. */
let autoShade = true;
/** Set while a scene change has happened that no listener of ours would hear. */
let dirty = true;
let allDirty = true;
/** The running sampler's own "sample on the next frame", installed while it lives. */
let wake: (() => void) | null = null;

/**
 * Tells the sampler the scene changed. Everything it watches for itself — scroll, resize, media
 * events, mutations — marks this on its own; this is for the caller that changes the backdrop or
 * the tint, which are attributes on one element and raise no event at all.
 */
export function touchScene() {
  dirty = true;
  allDirty = true;
  // An animated value changes without any event of its own — the caller re-marks the scene every
  // few frames while it moves — so the next read has to happen now rather than at the cadence.
  wake?.();
}

/** Turns the glass's automatic light/dark off, or back on, from Settings. */
export function setAutoShade(on: boolean) {
  autoShade = on;
  if (!on) document.querySelectorAll<HTMLElement>("[data-glass-edge]").forEach((pane) => pane.style.removeProperty("--glass-shade"));
}
/** Each media slice is read as this many pixels square: the map text is scored against. */
const TILE = 16;

type Box = { x: number; y: number; width: number; height: number };
type Media = HTMLImageElement | HTMLVideoElement | HTMLCanvasElement;
type Scene = "fixed-shell" | "moving-page" | "nested-host" | "moving-media";
/** One media slice under a pane, flattened to a TILE x TILE brightness map. */
type Tile = { slice: Box; cells: Float32Array };
/** A flat painted layer under a pane: an opaque surface, or the page itself. */
type Layer = { box: Box; luma: number; alpha: number };

function overlap(a: Box, b: Box): Box | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

function naturalSize(element: Media) {
  if (element instanceof HTMLVideoElement) return { w: element.videoWidth, h: element.videoHeight };
  if (element instanceof HTMLImageElement) return { w: element.naturalWidth, h: element.naturalHeight };
  return { w: element.width, h: element.height };
}

/** The box the media actually paints: object-fit places the content inside the element's box. */
function contentBox(element: Media, box: Box): { box: Box; natural: { w: number; h: number } } | null {
  const natural = naturalSize(element);
  if (!natural.w || !natural.h) return null;
  const fit = getComputedStyle(element).objectFit;
  if (fit === "fill") return { box, natural };
  const scale = fit === "cover"
    ? Math.max(box.width / natural.w, box.height / natural.h)
    : Math.min(box.width / natural.w, box.height / natural.h);
  const width = natural.w * scale;
  const height = natural.h * scale;
  return { box: { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }, natural };
}

/**
 * An element's box is not what it paints: a cover laid out taller than the frame that holds it is
 * cut off by that frame, and the strip it would otherwise claim is the page showing through. The
 * visible box is the element's own, cut down by every ancestor that clips.
 */
function clipBox(element: HTMLElement, box: Box): Box | null {
  let clipped = box;
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.overflowX === "visible" && style.overflowY === "visible") continue;
    const rect = ancestor.getBoundingClientRect();
    const next = overlap(clipped, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    if (!next) return null;
    clipped = next;
  }
  return clipped;
}

/** Every element whose own text sits on the glass — the runs the ink has to keep readable. */
function textRuns(pane: HTMLElement): HTMLElement[] {
  const runs: HTMLElement[] = [];
  for (const element of Array.from(pane.querySelectorAll<HTMLElement>("*"))) {
    if (element.closest("svg")) continue;
    for (const node of Array.from(element.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent && node.textContent.trim()) {
        runs.push(element);
        break;
      }
    }
  }
  return runs;
}

/**
 * Starts the sampler against the studio's shell. The root is handed in, so the engine never has
 * to know the shell's class name; every pane is found by its `data-glass-edge` marker.
 */
export function startInkSampler(root: HTMLElement): () => void {
  const canvas = document.createElement("canvas");
  canvas.width = TILE;
  canvas.height = TILE;
  // CPU-backed: a 16x16 readback must never pull on the GPU pipeline.
  const acquired = canvas.getContext("2d", { willReadFrequently: true });
  if (!acquired) return () => {};
  const context: CanvasRenderingContext2D = acquired;

  /** What each run currently wears, so a read that barely moves it can be dropped. */
  const worn = new WeakMap<HTMLElement, { mix: number; solid: number; pale: number }>();
  /** The shade each pane currently wears, so the veil it paints can be un-shaded on the way back in. */
  const wornShade = new WeakMap<HTMLElement, number>();
  /** The dispersion gain each pane currently wears, so a scene that barely moves it can be dropped. */
  const wornGlow = new WeakMap<HTMLElement, number>();
  /** The mix each pane carries for the glyphs inside it that hold no text of their own. */
  const paneMixes = new WeakMap<HTMLElement, number>();
  const dirtyPanes = new Set<HTMLElement>();
  const runs = new WeakMap<HTMLElement, { stamp: number; found: HTMLElement[] }>();
  /** Bumped on every mutation: a pane's run list is re-scanned only when the DOM has moved. */
  let stamp = 0;
  let frame = 0;
  dirty = true;
  allDirty = true;

  function sceneOf(pane: HTMLElement): Scene {
    const value = pane.dataset.glassScene;
    if (value === "fixed-shell" || value === "moving-page" || value === "nested-host" || value === "moving-media") return value;
    return "moving-page";
  }

  function markPane(pane: HTMLElement) {
    dirtyPanes.add(pane);
    dirty = true;
  }

  function markAll() {
    document.querySelectorAll<HTMLElement>("[data-glass-edge]").forEach(markPane);
    dirty = true;
  }

  function markScroll(target: EventTarget | null) {
    const scroller = target instanceof HTMLElement ? target : null;
    if (!scroller) {
      document.querySelectorAll<HTMLElement>("[data-glass-edge]").forEach((pane) => {
        if (sceneOf(pane) !== "fixed-shell") markPane(pane);
      });
      return;
    }
    document.querySelectorAll<HTMLElement>("[data-glass-edge]").forEach((pane) => {
      const scene = sceneOf(pane);
      if (scene === "moving-page" || scene === "moving-media" || pane.contains(scroller) || scroller.contains(pane)) markPane(pane);
    });
  }

  /** Mean luminance of the media slice under the pane, or null if it cannot be read. */
  function tileOf(element: Media, content: Box, natural: { w: number; h: number }, slice: Box): Float32Array | null {
    const sx = ((slice.x - content.x) / content.width) * natural.w;
    const sy = ((slice.y - content.y) / content.height) * natural.h;
    const sw = (slice.width / content.width) * natural.w;
    const sh = (slice.height / content.height) * natural.h;
    try {
      context.drawImage(element, sx, sy, sw, sh, 0, 0, TILE, TILE);
    } catch {
      // A frame that is not decodable yet, or a source the canvas may not read: leave the ink alone.
      return null;
    }
    const { data } = context.getImageData(0, 0, TILE, TILE);
    const cells = new Float32Array(TILE * TILE);
    for (let i = 0; i < cells.length; i++) {
      const o = i * 4;
      cells[i] = (data[o] * 0.2126 + data[o + 1] * 0.7152 + data[o + 2] * 0.0722) / 255;
    }
    return cells;
  }

  /** The pane's own veil, resolved: the white wash every glyph in it is actually drawn on. */
  function veilOf(pane: HTMLElement): { luma: number; alpha: number } {
    const match = getComputedStyle(pane).backgroundColor.match(/^rgba?\(([^)]+)\)$/);
    if (!match) return { luma: 1, alpha: 0 };
    const [r, g, b, alpha = "1"] = match[1].split(",");
    return {
      luma: (Number(r) * 0.2126 + Number(g) * 0.7152 + Number(b) * 0.0722) / 255,
      alpha: Math.min(1, Math.max(0, Number(alpha))),
    };
  }

  /**
   * The pane's veil laid over a run's backdrop: what that run's glyphs are actually read against.
   * The pane's own shade darkens the veil first — the ink sits on the shaded glass, not on the
   * tint that was chosen.
   */
  function veilOver(veil: { luma: number; alpha: number }, backdrop: number, shade = 0): number {
    return veil.alpha * veil.luma * (1 - shade * SHADE_MAX) + (1 - veil.alpha) * backdrop;
  }

  /** How much of its tint's brightness a pane gives up over a backdrop this dark. */
  function shadeOf(luma: number): number {
    if (luma >= SHADE_DARK) return 0;
    if (luma <= SHADE_FLOOR) return 1;
    return (SHADE_DARK - luma) / (SHADE_DARK - SHADE_FLOOR);
  }

  /**
   * The scene a pane stands on. Inside the overlay it is the overlay; outside it, it is the overlay
   * all the same when the pane paints above it — the settings rail opens over a playing video, and
   * reads the same dark scene every pane of the overlay's own rail reads.
   */
  function layerOf(pane: HTMLElement, overlay: HTMLElement | null): HTMLElement | null {
    const own = pane.closest<HTMLElement>(VIDEO_LAYER);
    if (own || !overlay) return own;
    return Number(getComputedStyle(pane).zIndex) > Number(getComputedStyle(overlay).zIndex) ? overlay : null;
  }

  /**
   * The page's own brightness. It used to be the constant above, because the studio was always
   * paper; a chosen wallpaper can be any colour at all, so the shell publishes how bright its
   * backdrop is and every pane over the page is judged against that instead. Read once per tick,
   * not per pane, since it is one property on one element.
   */
  let pageLuma = PAGE_LUMA;

  function readPageLuma() {
    const value = Number.parseFloat(getComputedStyle(root).getPropertyValue("--shell-luma"));
    pageLuma = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : PAGE_LUMA;
  }

  /**
   * The opaque surfaces a pane can be standing on: the page's own cards. Without these a pane over
   * a white card on a dark wallpaper read the wallpaper and turned dark over something white —
   * the glass has to answer to whatever is actually under it, and a card is as much a part of that
   * scene as a photograph is.
   */
  const SURFACES = ".panel,.hero-panel,.asset-card,.project-card,.album-card,.album-detail,.track-row,.settings-card,.parameter-card,.upload-modal,.auth-modal,.dropzone,.empty-assets";

  /** Every surface's box, brightness and opacity, read once a tick for every pane to share. */
  function surfacesUnder(layer: HTMLElement | null): Layer[] {
    const found: Layer[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>(SURFACES))) {
      if (element.closest("[data-glass-edge]")) continue;
      if (element.closest(VIDEO_LAYER) !== layer) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 8 || box.height < 8) continue;
      const match = /^rgba?\(([^)]+)\)$/.exec(getComputedStyle(element).backgroundColor);
      if (!match) continue;
      const [r, g, b, alpha = "1"] = match[1].split(",");
      const opacity = Math.min(1, Math.max(0, Number(alpha)));
      if (!(opacity > 0.05)) continue;
      found.push({ box, luma: (Number(r) * 0.2126 + Number(g) * 0.7152 + Number(b) * 0.0722) / 255, alpha: opacity });
    }
    return found;
  }

  /** What the pane's glass is showing behind each text run: the visible media, then the baseline. */
  function paneTiles(pane: HTMLElement, rect: Box, media: Media[], layer: HTMLElement | null, surfaces: Layer[]): { baseline: number; tiles: Tile[] } {
    const baseline = layer ? OVERLAY_LUMA : pageLuma;
    const tiles: Tile[] = [];
    for (const element of media) {
      if (pane.contains(element)) continue;
      // Another pane's glass surface is a canvas, and an empty one reads as black — a pane
      // overlapping one would darken itself over nothing at all, and the whole page would go grey.
      // The overlay paints itself opaque over the page, so its panes never show the media behind
      // it — and the page's panes never show the overlay's.
      if (element.closest(VIDEO_LAYER) !== layer) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) continue;
      const content = contentBox(element, box);
      if (!content) continue;
      const painted = overlap(content.box, box);
      if (!painted) continue;
      if (!overlap(painted, rect)) continue;
      const visible = clipBox(element, painted);
      if (!visible) continue;
      const slice = overlap(visible, rect);
      if (!slice) continue;
      const cells = tileOf(element, content.box, content.natural, slice);
      if (cells) tiles.push({ slice, cells });
    }
    return { baseline, tiles };
  }

  /** The brightness behind one box: the page, then every surface over it, then the media's tiles. */
  function lumaOver(rect: Box, baseline: number, surfaces: Layer[], tiles: Tile[]): number {
    let value = baseline;
    const area = rect.width * rect.height;
    for (const surface of surfaces) {
      const inter = overlap(rect, surface.box);
      if (!inter) continue;
      const alpha = Math.min(1, (inter.width * inter.height) / area) * surface.alpha;
      value = alpha * surface.luma + (1 - alpha) * value;
    }
    // Media last: a cover sits inside its card, so it paints over it.
    let covered = 0;
    let weighted = 0;
    for (const tile of tiles) {
      const inter = overlap(rect, tile.slice);
      if (!inter) continue;
      const cellW = tile.slice.width / TILE;
      const cellH = tile.slice.height / TILE;
      const first = Math.max(0, Math.floor((inter.x - tile.slice.x) / cellW));
      const last = Math.min(TILE - 1, Math.ceil((inter.x + inter.width - tile.slice.x) / cellW) - 1);
      const top = Math.max(0, Math.floor((inter.y - tile.slice.y) / cellH));
      const bottom = Math.min(TILE - 1, Math.ceil((inter.y + inter.height - tile.slice.y) / cellH) - 1);
      for (let row = top; row <= bottom; row++) {
        for (let column = first; column <= last; column++) {
          const x = tile.slice.x + column * cellW;
          const y = tile.slice.y + row * cellH;
          const cell = overlap(inter, { x, y, width: Math.min(cellW, tile.slice.x + tile.slice.width - x), height: Math.min(cellH, tile.slice.y + tile.slice.height - y) });
          if (!cell) continue;
          const share = cell.width * cell.height;
          covered += share;
          weighted += share * tile.cells[row * TILE + column];
        }
      }
    }
    if (covered === 0) return value;
    const share = Math.min(1, covered / area);
    return share * (weighted / covered) + (1 - share) * value;
  }

  /** How far this run's ink has to travel toward its light counterpart for the backdrop it sits on. */
  function inkMix(luma: number): number {
    if (luma <= DARK_BELOW) return 1;
    if (luma >= LIGHT_ABOVE) return 0;
    return (LIGHT_ABOVE - luma) / (LIGHT_ABOVE - DARK_BELOW);
  }

  /** Writes a pane's shade, dead-banded like the ink so a drifting scene cannot flicker. */
  function wearShade(pane: HTMLElement, luma: number): number {
    if (!autoShade) return 0;
    const shade = shadeOf(luma);
    const state = wornShade.get(pane);
    if (state !== undefined && Math.abs(shade - state) < SHADE_STEP) return state;
    wornShade.set(pane, shade);
    pane.style.setProperty("--glass-shade", shade.toFixed(3));
    return shade;
  }

  /**
   * Writes a pane's dispersion gain: the measured brightness of what the pane covers, lifted onto
   * the floor, dead-banded like everything else. The rim map reads it straight off the inline
   * style on its own poll, so it is written even when the auto-shade is off, which is a setting
   * about the tint, not about the prism.
   */
  function wearGlow(pane: HTMLElement, luma: number): void {
    const glow = GLOW_FLOOR + (1 - GLOW_FLOOR) * Math.min(1, Math.max(0, luma));
    const state = wornGlow.get(pane);
    if (state !== undefined && Math.abs(glow - state) < SHADE_STEP) return;
    wornGlow.set(pane, glow);
    pane.style.setProperty("--glass-glow", glow.toFixed(3));
  }

  /** A straight ramp, 0 at or below `low` and 1 at or above `high`. */
  function rise(luma: number, low: number, high: number): number {
    if (luma <= low) return 0;
    if (luma >= high) return 1;
    return (luma - low) / (high - low);
  }

  function wear(element: HTMLElement, surface: number, backdrop: number) {
    const mix = inkMix(surface);
    const solid = 1 - rise(backdrop, SOLID_BELOW, SOLID_ABOVE);
    const pale = rise(backdrop, PALE_BELOW, PALE_ABOVE);
    const state = worn.get(element);
    if (state && Math.abs(mix - state.mix) < STEP && Math.abs(solid - state.solid) < STEP && Math.abs(pale - state.pale) < STEP) return;
    worn.set(element, { mix, solid, pale });
    element.dataset.ink = "";
    element.style.setProperty("--ink-mix", `${Math.round(mix * 100)}%`);
    element.style.setProperty("--ink-solid", `${Math.round(solid * 100)}%`);
    element.style.setProperty("--ink-pale", `${Math.round(pale * 100)}%`);
  }

  function tick() {
    frame = 0;
    if (document.hidden) return;
    const panes = Array.from(document.querySelectorAll<HTMLElement>("[data-glass-edge]"));
    if (panes.length === 0) {
      dirty = false;
      dirtyPanes.clear();
      return;
    }
    const media = Array.from(document.querySelectorAll<Media>("video,img,canvas"));
    // A playing video repaints the backdrop on its own, with no mutation and no scroll to
    // announce it, so it keeps the panes over it dirty for as long as it runs.
    const playing = media.some((element) => element instanceof HTMLVideoElement && !element.paused && element.readyState >= 2 && element.getBoundingClientRect().width > 0);
    if (allDirty) {
      panes.forEach((pane) => dirtyPanes.add(pane));
      allDirty = false;
    }
    const active = panes.filter((pane) => dirtyPanes.has(pane) || (playing && sceneOf(pane) === "moving-media"));
    if (active.length === 0) {
      dirty = false;
      return;
    }
    readPageLuma();
    const viewport: Box = { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight };
    const overlay = document.querySelector<HTMLElement>(VIDEO_LAYER);
    // Two scenes, each read once for every pane that belongs to it.
    const pageSurfaces = surfacesUnder(null);
    const overlaySurfaces = overlay ? surfacesUnder(overlay) : [];
    for (const pane of active) {
      const rect = pane.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) continue;
      if (!overlap(rect, viewport)) continue;
      let cached = runs.get(pane);
      if (!cached || cached.stamp !== stamp) {
        cached = { stamp, found: textRuns(pane) };
        runs.set(pane, cached);
      }
      // The glass itself follows its backdrop before any glyph is judged: a pane over something
      // dark gives up part of its tint's brightness, and the ink the pane carries is then read
      // against that darker surface. Both need the scene, so this runs even for a pane with no
      // text of its own.
      const paneLayer = layerOf(pane, overlay);
      const surfaces = paneLayer ? overlaySurfaces : pageSurfaces;
      const { baseline, tiles } = paneTiles(pane, rect, media, paneLayer, surfaces);
      const painted = veilOf(pane);
      const worn = wornShade.get(pane) ?? 0;
      // CSS already scaled the veil by the shade written last tick; undo that so the ramp is
      // always judged against the tint that was chosen rather than against its own last result.
      const veil = { luma: Math.min(1, painted.luma / (1 - worn * SHADE_MAX)), alpha: painted.alpha };
      const behind = lumaOver(rect, baseline, surfaces, tiles);
      const shade = wearShade(pane, behind);
      // The prism's gain, from the same measured scene — brighter backdrop, wider rainbow.
      wearGlow(pane, behind);
      // The pane carries a mix of its own as well as the shade: an icon has no text run to wear
      // one, and the bar's glyphs have to follow a black frame exactly as its title does.
      const paneMix = inkMix(veilOver(veil, behind, shade));
      if (Math.abs((paneMixes.get(pane) ?? -1) - paneMix) >= STEP) {
        paneMixes.set(pane, paneMix);
        pane.style.setProperty("--ink-mix", `${Math.round(paneMix * 100)}%`);
      }
      if (cached.found.length === 0) continue;
      for (const element of cached.found) {
        // A run half off the pane or the screen is judged by the part that shows.
        const inside = overlap(element.getBoundingClientRect(), rect);
        const shown = inside && overlap(inside, viewport);
        if (!shown) continue;
        const behind = lumaOver(shown, baseline, surfaces, tiles);
        wear(element, veilOver(veil, behind, shade), behind);
      }
    }
    dirty = false;
    dirtyPanes.clear();
  }

  function schedule() {
    if (!frame) frame = window.requestAnimationFrame(tick);
  }
  wake = schedule;

  const markDirty = () => { markAll(); };
  const onScroll = (event: Event) => { markScroll(event.target); };
  const markMoved = () => { stamp++; allDirty = true; markAll(); };
  window.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", markDirty);
  // A video that stops or jumps leaves a new frame on screen with nothing else to announce it,
  // and an image that arrives after its element was inserted is the same case for a cover or a
  // photo backdrop: the element was there (and sampled, empty) before it had any pixels in it.
  const mediaEvents: (keyof HTMLElementEventMap)[] = ["play", "pause", "seeked", "ended", "loadeddata", "load", "error"];
  for (const type of mediaEvents) document.addEventListener(type, markDirty, true);
  // React re-renders, panes opening and closing, media arriving: anything that can change a scene.
  const mutations = new MutationObserver(markMoved);
  mutations.observe(document.body, { childList: true, subtree: true });
  const timer = window.setInterval(schedule, SAMPLE_MS);
  schedule();

  return () => {
    if (wake === schedule) wake = null;
    window.clearInterval(timer);
    if (frame) window.cancelAnimationFrame(frame);
    mutations.disconnect();
    window.removeEventListener("scroll", onScroll, { capture: true });
    window.removeEventListener("resize", markDirty);
    for (const type of mediaEvents) document.removeEventListener(type, markDirty, true);
    document.querySelectorAll<HTMLElement>("[data-ink]").forEach((element) => {
      delete element.dataset.ink;
      element.style.removeProperty("--ink-mix");
      element.style.removeProperty("--ink-solid");
      element.style.removeProperty("--ink-pale");
    });
    document.querySelectorAll<HTMLElement>("[data-glass-edge]").forEach((pane) => {
      pane.style.removeProperty("--glass-shade");
      pane.style.removeProperty("--glass-glow");
      pane.style.removeProperty("--ink-mix");
    });
  };
}
