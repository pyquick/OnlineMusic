/**
 * Rim optics for the frosted panes.
 *
 * A pane's backdrop-filter bends only near its own rim, which is what makes a flat
 * sheet of frost read as a slab of thick glass. The bend is an SVG feDisplacementMap
 * driven by a displacement map the browser never has to recompute: R/G encode where each
 * rim pixel samples its backdrop from, so the interior of the map is exactly neutral
 * (offset 0). Because the map only depends on the pane's geometry, dragging a slider
 * rewrites a couple of attributes and nothing else — no canvas work, no capture, no
 * per-frame cost.
 *
 * The field itself is the single-refraction model of a real slab. Across a narrow band the
 * pane's outer face is a dome whose height follows a squircle, `h = (1 - (1 - t)^4)^(1/4)`
 * — the profile Apple's glass uses, because its slope leaves infinity at the rim and only
 * reaches zero where the surface levels off into the pane's flat top. A view ray arrives
 * along the view axis, so the angle it makes with that surface is `sin θ₁ = |∇h| / √(1+|∇h|²)`;
 * it refracts by Snell, `sin θ₂ = sin θ₁ / n`, crosses the glass, and leaves through the flat
 * underface displaced by `thickness · tan θ₂` — uphill, towards the pane's thick centre. The
 * map stores that sample direction, which is why `applyOptics`' scales are positive. Because
 * the slope is infinite at the rim, θ₁ there is 90° and the displacement saturates at
 * `tan(asin(1/n))`, so the bend peaks exactly at the edge — the earlier `f'/(1+f'²)` form
 * used by some Web ports drops to zero there, which is the one thing real glass never does.
 *
 * Nothing is displaced twice. One feDisplacementMap copies each backdrop pixel once, so no
 * colour can shift and no fringe can appear — the bend is a pure geometric move. It is also
 * bounded. The band is an absolute width in px, the same on every pane and on all four of its
 * edges, held to half the pane's short side so the bend is flat again by the middle (a pane may
 * read it at a multiple of the sliders — the player bar asks for three times the depth, a thin
 * strip needing a wider band to bend as visibly as a tall pane). The filter region is the
 * pane's own box and never a pixel more, and the pull is capped at a share of the band, so a
 * rim sample always lands inside the pane's own rim band — never on the flat interior past it,
 * and never on whatever lies beyond the glass.
 *
 * That last bound is what keeps the glass flat in the middle. The displaced sample position
 * across the band is `s(t) = t + k · c(t)` for `k = pull / band` and the dome's falloff `c`;
 * if `k` exceeds `1 / max|c'|` the curve turns back on itself, and a folded rim shows the
 * pane's interior pressed against the edge while that same interior still sits at its own
 * place — refraction at the edge *and* inside. The squircle's slope peaks at 3.03 (about a
 * tenth of the way into the band), so `k` stays under 0.33, and enlarging the band is what
 * lets the distortion slider travel further rather than the pull escaping the band. One pane
 * is let past it: the player bar, a 920×67 strip whose band half its height caps at 33.5px, so
 * the fold-free share leaves a 10px bend — a hairline on a strip that wide. It pulls 2.5×
 * deeper instead, ≈25px, and takes the fold that buys: its rim shows the strip's interior
 * pressed against the edge while the same interior still sits at its own place. The tall panes
 * keep the fold-free bound; only the bar runs at `k ≈ 0.75`.
 *
 * The bend is colour-blind unless asked. The Settings master dial splits it: the backdrop is cut
 * into its three channels, each displaced by its own scale — red reads shallower than the green,
 * the blue deeper, which is the order a prism separates them in — and the three images are put
 * back together with two `feBlend screen` passes. The recombination is exact, because each image
 * carries a single channel (screen adds them and nothing else), and the flat interior, where the
 * map is neutral, reassembles into the untouched backdrop. The split is scaled per pane by
 * `--glass-glow`, the brightness the ink sampler measured behind it, so the brightest scenes
 * disperse the most. At zero the filter is the same two nodes it has always been, and a pane pays
 * nothing for a rainbow it is not showing.
 *
 * All of that is Chromium's, because `backdrop-filter` takes a filter reference only there: Safari
 * cannot bend a backdrop, so none of this is attached on an engine that cannot use it. What a pane
 * loses there, a shaded rim stands in for — the shell is marked and CSS paints it from the same two
 * sliders (`--glass-band` and `--glass-pull`).
 */

/** Largest rim pull the slider can ask for, in CSS px. */
export const MAX_EDGE_OFFSET = 84;
/** Largest rim band the slider can ask for, in CSS px. */
export const MAX_BAND_PX = 84;
/**
 * The rainbow's ceiling: the deepest per-channel spread, as a share of the rim pull. The master
 * dial's 0–100% maps onto this, and the pane's measured brightness (`--glass-glow`) scales what is
 * left. Red displaces by `pull × (1 − spread)`, green by `pull`, blue by `pull × (1 + spread)`.
 */
export const MAX_DISPERSION = 0.3;
/**
 * The seven families a rim can belong to. Each one may carry its own base band/pull, so a card's
 * bend and a word chip's can be tuned apart from the panes': an element names its family in the
 * `--glass-group` custom property (the stylesheet sets it on the class lists), and the page hands
 * the per-group values here through `setGroups`. Anything unnamed, unknown, or without a value
 * follows the two sliders exactly as before.
 */
export type GlassGroup = "pane" | "card" | "button" | "field" | "chip" | "capsule" | "tile";
export type GlassGroupValues = Partial<Record<GlassGroup, { band: number; pull: number }>>;
const GLASS_GROUPS: readonly string[] = ["pane", "card", "button", "field", "chip", "capsule", "tile"];
/** Reads the family off an element's computed style; `--glass-group` inherits, so only a rimmed
    element's own value is meaningful — an unset one reads as the empty string and follows the
    sliders. */
function groupOf(style: CSSStyleDeclaration): GlassGroup | null {
  const raw = style.getPropertyValue("--glass-group").trim();
  return GLASS_GROUPS.includes(raw) ? (raw as GlassGroup) : null;
}
/**
 * The band never reaches past a pane's midline, so the bend is flat again by the middle whatever
 * the slider says: on a pane shorter than twice the band it is the pane that decides the width.
 */
const MAX_BAND_SHARE = 0.5;
/**
 * Deepest share of the band a rim sample may travel. Past `1 / max|c'| = 0.33` the sample
 * position across the band stops rising and folds, which reads as the interior appearing at
 * the edge; 0.30 keeps the slope positive where the dome is steepest without giving up reach.
 */
// The pull used to be held to 30% of the band so the sample never left the glass the band covers.
// The user lifted that (2026-10-01, "让它们(所有控件)的折射最高均能到84PX"): the strength slider
// reaches 84px on every control, and the only ceiling left is the band itself — the bend reads to
// the band's inner edge and no further, which is the geometry of the map, not a policy.
const MAX_PULL_SHARE = 1;
/**
 * And the share for a *boosted* pane — one that already reads the sliders at a multiple
 * (`data-glass-edge` above 1, which only the player bar sets). Such a pane is exactly the short
 * strip the fold-free share leaves nearly flat, so its pull is let 2.5× deeper: at the bar's
 * 33.5px band that is a 25px bend, bought with the fold the tall panes are held clear of.
 */
const BOOSTED_PULL_SHARE = MAX_PULL_SHARE * 2.5;
/** Map resolution relative to CSS px. The field is smooth and feDisplacementMap interpolates. */
const MAP_SCALE = 0.5;
/** Air on one side, and the glass the panes are pretending to be on the other. */
const IOR = 1.5;
/** tan(asin(1/n)) — the shift a grazing ray picks up per unit thickness, and the rim's ceiling. */
const MAX_BEND = 1 / Math.sqrt(IOR * IOR - 1);
/** Below this the pane is too small for a rim band to mean anything, and so is the band itself. */
const MIN_PANE = 24;
const MIN_BAND = 0.75;

const NS = "http://www.w3.org/2000/svg";

/** Signed distance to a rounded rectangle centred on the origin: negative inside. */
function roundedBoxDistance(px: number, py: number, halfWidth: number, halfHeight: number, radius: number) {
  const qx = Math.abs(px) - (halfWidth - radius);
  const qy = Math.abs(py) - (halfHeight - radius);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
}

/** Squircle height across the dome: 0 where it meets the outer face, 1 where the top goes flat. */
function surfaceHeight(across: number) {
  const k = 1 - across;
  const k4 = k * k * k * k;
  return Math.pow(Math.max(0, 1 - k4), 0.25);
}

/**
 * Lateral shift of a refracted view ray, per unit of glass thickness: `tan θ₂` for a ray that
 * arrives along the view axis. Written through the inverse slope `r = h / (1 - t)` rather than
 * the slope itself, which is infinite at the rim: `sin θ₁ = 1 / √(1 + r⁶)` is finite there and
 * saturates to 90°, so the rim keeps the strongest bend instead of dividing by zero.
 */
function surfaceBend(across: number) {
  const r = surfaceHeight(across) / (1 - across);
  const r6 = Math.pow(r, 6);
  const sin1 = 1 / Math.sqrt(1 + r6);
  const sin2 = Math.min(1, sin1 / IOR);
  return sin2 / Math.sqrt(1 - sin2 * sin2);
}

/**
 * Renders the displacement map as a PNG data URI. R and G hold the unit sample direction
 * towards the pane's interior, scaled by the refracted bend (127.5 = no offset), which is
 * exactly what feDisplacementMap reads when scale is applied:
 * offset = scale * (channel / 255 - 0.5).
 */
function buildMap(width: number, height: number, radius: number, band: number) {
  const mapWidth = Math.max(8, Math.round(width * MAP_SCALE));
  const mapHeight = Math.max(8, Math.round(height * MAP_SCALE));
  const canvas = document.createElement("canvas");
  canvas.width = mapWidth;
  canvas.height = mapHeight;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const image = context.createImageData(mapWidth, mapHeight);
  const data = image.data;
  const stepX = width / mapWidth;
  const stepY = height / mapHeight;
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  let offset = 0;
  for (let y = 0; y < mapHeight; y++) {
    const py = (y + 0.5) * stepY - halfHeight;
    for (let x = 0; x < mapWidth; x++) {
      const px = (x + 0.5) * stepX - halfWidth;
      const distance = roundedBoxDistance(px, py, halfWidth, halfHeight, radius);
      // Only the dome moves a ray; the flat top and everything beyond the rim stays neutral.
      const depth = -distance;
      let bend = 0;
      let inwardX = 0;
      let inwardY = 0;
      if (depth >= 0 && depth < band) {
        bend = surfaceBend(depth / band) / MAX_BEND;
        // Central difference on the distance field gives the outward normal everywhere,
        // including the corners, where a straight edge's normal would be wrong. The sample
        // travels the other way: uphill, towards the pane's centre.
        const dx = roundedBoxDistance(px + 0.5, py, halfWidth, halfHeight, radius) - roundedBoxDistance(px - 0.5, py, halfWidth, halfHeight, radius);
        const dy = roundedBoxDistance(px, py + 0.5, halfWidth, halfHeight, radius) - roundedBoxDistance(px, py - 0.5, halfWidth, halfHeight, radius);
        const length = Math.hypot(dx, dy) || 1;
        inwardX = -dx / length;
        inwardY = -dy / length;
      }
      data[offset] = Math.round(127.5 + 127.4 * bend * inwardX);
      data[offset + 1] = Math.round(127.5 + 127.4 * bend * inwardY);
      data[offset + 2] = 128;
      data[offset + 3] = 255;
      offset += 4;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL("image/png");
}

function parseRadius(value: string, limit: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 0), limit) : 0;
}

/**
 * Whether this engine can bend a backdrop with an SVG filter. Chromium can — `backdrop-filter`
 * takes a `url()` there as an extension — while WebKit's grammar is filter functions only, so a
 * map has nowhere to attach and the rim would stay flat. Safari is not left with nothing: the
 * shell is marked instead and CSS shades the rim, which is the one part of the optics a shadow
 * can stand in for.
 *
 * The parse alone does not answer the question, which is why the vendor is asked too: WebKit
 * *accepts* `url()` in a backdrop-filter list and then paints no bend for it, so `CSS.supports`
 * says yes on the one engine that cannot. Measured on Safari 27.2 over hard stripes, with the
 * app's own numbers: `blur(12px) saturate(170%)` softened an edge to a thirty-fifth of its slope,
 * while the same list with `url(#t)` appended left the stripes pixel-identical to an unfiltered
 * pane — a filter the engine cannot paint costs the whole declaration, blur included. Only the
 * `-webkit-` twin keeps Safari's frost today, and that is why nothing may write the reference
 * there: the rim has to be judged on what gets painted rather than on what parses.
 */
function canBendBackdrop() {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return false;
  const vendor = typeof navigator === "undefined" ? "" : navigator.vendor;
  if (/apple/i.test(vendor ?? "")) return false;
  return CSS.supports("backdrop-filter", "url(#glass-edge)");
}

type Pane = {
  element: HTMLElement;
  /** The family whose base band/pull this pane follows, or null for the global sliders. */
  group: GlassGroup | null;
  filter: SVGFilterElement;
  image: SVGFEImageElement;
  displacement: SVGFEDisplacementMapElement;
  /** Geometry the current map was built for; a change means the map must be redrawn. */
  geometry: string;
  width: number;
  height: number;
  /** How far the rim band reaches in from the edge, in px — a share of the pane, so it moves with the slider. */
  band: number;
  /**
   * How much harder this pane reads both sliders than the others, from `data-glass-edge="3"`.
   * The player bar is a wide, thin strip, and a band as narrow as the tall panes' leaves a
   * hairline of bend along its edges, so it asks for three times the depth to bend as visibly —
   * and, being the only pane above 1, it is also the one allowed the deeper `BOOSTED_PULL_SHARE`.
   */
  scale: number;
  /**
   * A pane may name its own ceilings, in CSS px, in `--glass-band-cap` and `--glass-pull-cap`.
   * The pill's bubble is a tile barely 60px tall: a band the sliders would be happy to give the
   * tall panes swallows it whole, so it asks for a bend no deeper than 13px and a pull no
   * stronger than 9px whatever the sliders say. 0 means no cap of its own.
   */
  bandCap: number;
  pullCap: number;
  /** The dispersion branch's three channel displacements, built the first time the rainbow is on. */
  split: { red: SVGFEDisplacementMapElement; green: SVGFEDisplacementMapElement; blue: SVGFEDisplacementMapElement } | null;
  /** The `--glass-glow` the scales were last applied for, so the poll only redraws on a change. */
  glow: string;
};

/** The handle the two Settings sliders drive, and the pane teardown that goes with it. */
export type GlassEdgeHandle = {
  setOffset(next: number): void;
  setRefraction(next: number): void;
  /** The master rainbow, 0–1: how far each colour channel of the rim's bend separates. */
  setDispersion(next: number): void;
  /** Per-family base band/pull; a group's pane reads these instead of the two sliders. */
  setGroups(next: GlassGroupValues): void;
  destroy(): void;
};

/**
 * Watches every `[data-glass-edge]` pane under `root` and keeps its rim filter in sync with
 * the pane's size and the two sliders. Returns the handle those sliders drive.
 */
export function attachGlassEdge(root: HTMLElement): GlassEdgeHandle {
  // No map, no panes, no observers where the bend cannot exist: the mark on the shell is the whole
  // of the work, and the sliders keep meaning something through the custom properties the page
  // already writes for the shaded rim. Chrome never sees the mark.
  if (!canBendBackdrop()) {
    root.classList.add("glass-rim-fallback");
    return {
      setOffset() {},
      setRefraction() {},
      setDispersion() {},
      setGroups() {},
      destroy() { root.classList.remove("glass-rim-fallback"); },
    };
  }
  root.classList.remove("glass-rim-fallback");

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("aria-hidden", "true");
  // No display:none — an SVG that is not rendered is not a reliable filter source.
  svg.style.cssText = "position:absolute;width:0;height:0;overflow:hidden";
  document.body.appendChild(svg);

  const panes = new Map<HTMLElement, Pane>();
  const mapCache = new Map<string, string>();
  const sizes = new ResizeObserver(() => schedule());
  let offset = 0;
  /** The master rainbow, 0–1; 0 keeps every pane on the plain colour-blind displacement. */
  let dispersion = 0;
  /** Band width in CSS px, before a pane's own multiplier — an absolute size, not a share. */
  let bandPx = 0;
  /** The corner-radius multiplier as last read: a change to it reshapes every map's corners. */
  /** The per-family base band/pull the page last handed in; empty = everything follows the sliders. */
  let groups: GlassGroupValues = {};
  let index = 0;
  let frame = 0;

  /**
   * Builds the dispersion branch into the pane's filter, or takes it back out. Off, the filter is
   * the two nodes it has always been, so a pane pays nothing for a rainbow it is not showing. On,
   * a `feColorMatrix` isolates each channel of the backdrop, each isolated image is displaced by
   * its own scale, and two `feBlend screen` passes put them back together — exact, because each
   * displaced image carries one channel and nothing else. The nodes are kept on the pane once
   * built, so only the first crossing of zero costs the rebuild.
   */
  function useSplit(pane: Pane, on: boolean) {
    if (on === (pane.split !== null)) return;
    if (!on) {
      // The branch is gone from the filter, so the pane must stop believing it is there: a
      // stale non-null `split` made the next turn-on a no-op, and the scales landed on nodes
      // that had already been detached.
      pane.split = null;
      pane.filter.replaceChildren(pane.image, pane.displacement);
      return;
    }
    const channel = (keep: number, name: string) => {
      const matrix = document.createElementNS(NS, "feColorMatrix");
      matrix.setAttribute("in", "SourceGraphic");
      matrix.setAttribute("type", "matrix");
      // One is kept, the others are zeroed — and the 1 lands in the kept channel's *own*
      // column: a row is `[r g b a 0]`, so keeping green is `0 1 0 0 0`, never `1 0 0 0 0`.
      // (That first-column form read red for every channel, and a rim recombined from three
      // copies of the red channel is a rim that has lost its colour — the glass went grey.)
      const row = (channel: number) => (channel === keep ? [0, 1, 2].map((c) => (c === channel ? "1" : "0")).join(" ") + " 0 0" : "0 0 0 0 0");
      matrix.setAttribute("values", `${[0, 1, 2].map(row).join(" ")} 0 0 0 1 0`);
      matrix.setAttribute("result", `${name}Src`);
      const displace = document.createElementNS(NS, "feDisplacementMap");
      displace.setAttribute("in", `${name}Src`);
      displace.setAttribute("in2", "map");
      displace.setAttribute("xChannelSelector", "R");
      displace.setAttribute("yChannelSelector", "G");
      displace.setAttribute("scale", "0");
      displace.setAttribute("result", `${name}Disp`);
      return { matrix, displace };
    };
    const red = channel(0, "red");
    const green = channel(1, "green");
    const blue = channel(2, "blue");
    const blend = (first: string, second: string, result: string) => {
      const node = document.createElementNS(NS, "feBlend");
      node.setAttribute("in", first);
      node.setAttribute("in2", second);
      node.setAttribute("mode", "screen");
      if (result) node.setAttribute("result", result);
      return node;
    };
    pane.filter.replaceChildren(
      pane.image,
      red.matrix, red.displace,
      green.matrix, green.displace,
      blue.matrix, blue.displace,
      blend("redDisp", "greenDisp", "rgDisp"),
      blend("rgDisp", "blueDisp", ""),
    );
    pane.split = { red: red.displace, green: green.displace, blue: blue.displace };
  }

  /**
   * Writes the sliders into the pane's filter. The map is unchanged, so this is the whole
   * per-move cost of the distortion slider: one `scale` attribute (three when the rainbow is on).
   * `scale` is twice the pixel offset the rim pulls with, and the map already points at the
   * sample, so it stays positive.
   *
   * The pull is held to a share of the band, so a sample only ever reads the glass the band
   * covers. Deeper and it would land on the pane's flat interior, folding the rim — that
   * interior would show squeezed against the edge and at its own place at once. On a pane whose
   * band is too narrow for the slider's px it is the band that wins, which is the point: a
   * stronger bend is asked for by widening the band, not by letting it run past the band. The
   * share is the boosted one on a pane that reads the sliders at a multiple — the player bar —
   * where that fold is taken deliberately for the 25px a short strip cannot reach otherwise.
   */
  function applyOptics(pane: Pane) {
    const share = pane.scale > 1 ? BOOSTED_PULL_SHARE : MAX_PULL_SHARE;
    const base = (pane.group && groups[pane.group]?.pull) ?? offset;
    const pull = Math.min(base * pane.scale, pane.band * share, pane.pullCap > 0 ? pane.pullCap : Infinity);
    if (pull < 0.5 || pane.band < MIN_BAND) {
      pane.element.style.removeProperty("--glass-edge-filter");
      return;
    }
    // The rainbow: the master dial, scaled by the brightness the sampler measured behind this
    // pane (1 while nothing has measured it yet). Red travels shallower than the green, the blue
    // deeper — and the band's flat interior, where the map is neutral, reassembles untouched.
    const raw = pane.element.style.getPropertyValue("--glass-glow");
    pane.glow = raw;
    const parsed = Number.parseFloat(raw);
    const glow = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 1;
    const spread = dispersion * MAX_DISPERSION * glow;
    const scale = pull * 2;
    if (spread > 0.002) {
      useSplit(pane, true);
      pane.split!.red.setAttribute("scale", String(scale * (1 - spread)));
      pane.split!.green.setAttribute("scale", String(scale));
      pane.split!.blue.setAttribute("scale", String(scale * (1 + spread)));
    } else {
      useSplit(pane, false);
      pane.displacement.setAttribute("scale", String(scale));
    }
    pane.element.style.setProperty("--glass-edge-filter", `url(#${pane.filter.id})`);
  }

  /** The sampler writes `--glass-glow` on its own clock; this carries a change into the scales. */
  function syncGlow() {
    if (dispersion <= 0) return;
    panes.forEach((pane) => {
      if (pane.element.style.getPropertyValue("--glass-glow") === pane.glow) return;
      applyOptics(pane);
    });
  }

  function createPane(element: HTMLElement) {
    const id = `glass-edge-${index++}`;
    const filter = document.createElementNS(NS, "filter");
    filter.setAttribute("id", id);
    filter.setAttribute("filterUnits", "userSpaceOnUse");
    filter.setAttribute("color-interpolation-filters", "sRGB");
    const image = document.createElementNS(NS, "feImage");
    image.setAttribute("preserveAspectRatio", "none");
    image.setAttribute("result", "map");
    const displacement = document.createElementNS(NS, "feDisplacementMap");
    displacement.setAttribute("in", "SourceGraphic");
    displacement.setAttribute("in2", "map");
    displacement.setAttribute("xChannelSelector", "R");
    displacement.setAttribute("yChannelSelector", "G");
    displacement.setAttribute("scale", "0");
    filter.append(image, displacement);
    svg.appendChild(filter);
    // The attribute is the multiplier itself, so `data-glass-edge` alone means the plain 1×.
    const scale = Number(element.dataset.glassEdge) || 1;
    // The ceilings are read once, with the multiplier: they are part of what a pane *is*, and a
    // stylesheet that moved them at runtime would be asking for a map rebuild nobody announced.
    const style = getComputedStyle(element);
    const cap = (name: string) => { const value = Number.parseFloat(style.getPropertyValue(name)); return Number.isFinite(value) && value > 0 ? value : 0; };
    const pane: Pane = { element, group: groupOf(style), filter, image, displacement, geometry: "", width: 0, height: 0, band: 0, scale: Math.max(1, scale), bandCap: cap("--glass-band-cap"), pullCap: cap("--glass-pull-cap"), split: null, glow: "" };
    sizes.observe(element);
    applyOptics(pane);
    return pane;
  }

  function destroyPane(pane: Pane) {
    sizes.unobserve(pane.element);
    pane.element.style.removeProperty("--glass-edge-filter");
    pane.filter.remove();
  }

  function measure(pane: Pane) {
    const { element } = pane;
    // offsetWidth/Height, not getBoundingClientRect: the bar and panel entrances animate
    // scale, and a transformed rect would rebuild the map on every animation frame.
    const width = element.offsetWidth;
    const height = element.offsetHeight;
    pane.width = width;
    pane.height = height;
    // The band is an absolute width — the same number of px on a wide bar and a tall panel, so
    // the slider means one thing. Only a pane too short to hold it twice over narrows it, and
    // that cap is what keeps the bend flat again by the middle: half the short side is where the
    // two rims would otherwise meet. The pane's own multiplier deepens the band and the pull
    // together, so the bend keeps its shape — only reaches further. `--glass-band-cap` is the
    // pane's own ceiling, for a tile the sliders' band would otherwise swallow whole.
    const base = (pane.group && groups[pane.group]?.band) ?? bandPx;
    const band = Math.min(base * pane.scale, Math.min(width, height) * MAX_BAND_SHARE, pane.bandCap > 0 ? pane.bandCap : Infinity);
    pane.band = band;
    if (width < MIN_PANE || height < MIN_PANE || band < MIN_BAND) {
      pane.geometry = "";
      return;
    }
    // The computed radius is only read when the key changes: it costs a style flush, and the
    // size plus the radius multiplier already say whether the corners can have moved.
    const style = getComputedStyle(element);
    const limit = Math.min(width, height) / 2;
    const radius = Math.min(
      parseRadius(style.borderTopLeftRadius, limit),
      parseRadius(style.borderTopRightRadius, limit),
      parseRadius(style.borderBottomRightRadius, limit),
      parseRadius(style.borderBottomLeftRadius, limit),
    );
    const key = `${width}x${height}x${radius.toFixed(2)}x${band.toFixed(2)}`;
    if (key === pane.geometry) return;
    const uri = mapCache.get(key) ?? buildMap(width, height, radius, band);
    if (!uri) return;
    mapCache.set(key, uri);
    pane.geometry = key;
    pane.image.setAttribute("href", uri);
    // The region is the pane's own box: the bend is defined only across the glass, so there
    // is no image of the rim for anything outside the pane to sample or show.
    pane.filter.setAttribute("x", "0");
    pane.filter.setAttribute("y", "0");
    pane.filter.setAttribute("width", String(width));
    pane.filter.setAttribute("height", String(height));
  }

  function sync() {
    const found = new Set(root.querySelectorAll<HTMLElement>("[data-glass-edge]"));
    panes.forEach((pane, element) => {
      if (found.has(element) && element.isConnected) return;
      destroyPane(pane);
      panes.delete(element);
    });
    found.forEach((element) => {
      const pane = panes.get(element) ?? createPane(element);
      panes.set(element, pane);
      measure(pane);
      // Re-assert the wiring: if anything cleared the pane's inline filter, this puts it back
      // without a slider move. Setting an attribute to its current value is a no-op.
      applyOptics(pane);
    });
  }

  function schedule() {
    if (frame) return;
    frame = window.requestAnimationFrame(() => {
      frame = 0;
      sync();
    });
  }

  const mutations = new MutationObserver(schedule);
  mutations.observe(root, { childList: true, subtree: true });
  window.addEventListener("resize", schedule);
  // The dispersion gain is measured by the ink sampler on its own 250ms clock and announced by
  // nothing the engine would hear, so it is polled — a handful of inline-style reads.
  const glowPoll = window.setInterval(syncGlow, 400);
  schedule();

  return {
    setOffset(next: number) {
      offset = Math.max(0, Math.min(MAX_EDGE_OFFSET, next));
      panes.forEach(applyOptics);
    },
    /**
     * The band lives inside the map, so this one does redraw it — but the map is a fraction of
     * the pane's pixels and the slider steps in whole px, so a drag rebuilds a handful of small
     * canvases rather than the frame.
     */
    setRefraction(next: number) {
      bandPx = Math.max(0, Math.min(MAX_BAND_PX, next));
      panes.forEach((pane) => {
        measure(pane);
        applyOptics(pane);
      });
    },
    /** The master rainbow. Only the scale attributes move; the maps are geometry and stay put. */
    setDispersion(next: number) {
      dispersion = Math.min(1, Math.max(0, next));
      panes.forEach((pane) => applyOptics(pane));
    },
    /** The per-family bases: a pane reads its own family's values instead of the sliders. The
        band lives inside the map, so this redraws like the refraction slider does. */
    setGroups(next: GlassGroupValues) {
      groups = { ...next };
      panes.forEach((pane) => {
        measure(pane);
        applyOptics(pane);
      });
    },
    destroy() {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearInterval(glowPoll);
      mutations.disconnect();
      sizes.disconnect();
      window.removeEventListener("resize", schedule);
      panes.forEach(destroyPane);
      panes.clear();
      mapCache.clear();
      svg.remove();
    },
  };
}
