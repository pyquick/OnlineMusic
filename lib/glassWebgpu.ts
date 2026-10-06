/// <reference types="@webgpu/types" />

/**
 * The edge refraction, in WebGPU — the option for engines that cannot bend a backdrop in CSS.
 *
 * `lib/glassEdge.ts` bends a backdrop by handing the engine an SVG `feDisplacementMap` inside the
 * pane's `backdrop-filter`. Chromium paints that; WebKit parses it and paints nothing — so on
 * Safari the glass has no bend at all unless something draws it. This module is that something:
 * the same refraction for an engine that cannot do it in CSS, drawn by a WGSL fragment shader —
 * squircle dome, Snell's law at IOR 1.5, the pull capped at a share of the band, the band capped
 * at half the pane's short side, all of it the SVG path's own maths, constant for constant — so
 * the two renderers show the same bend, and switching between them changes nothing but the engine.
 *
 * The rainbow is the same split here as there: three samples along the bend, red at the shallow
 * scale and blue at the deep one, each taking its own channel — scaled by the master dial and by
 * the ink sampler's measured `--glass-glow`, so the brightest backdrops disperse the most. At
 * zero the branch is skipped and the one fetch stands.
 *
 * Only the band is drawn. The pane keeps its `backdrop-filter: blur()`, which Safari does support,
 * so everything inside the band is the browser's own live backdrop, as sharp and as current as
 * Chromium's; the canvas paints from `inside == band` (where the displacement is zero, so the two
 * meet invisibly) out to the rim. That is the difference between this and a whole-surface capture:
 * nothing that moves under the pane can go stale except the band itself.
 *
 * The band's pixels have to come from somewhere, and a canvas cannot see the page behind it, so
 * the backdrop is rasterised: the DOM is cloned with its computed styles inlined, put through an
 * SVG `foreignObject` and drawn into a canvas. The raster covers a *band of the document* — the
 * screen plus a margin above and below — and the shader indexes it by the live scroll, so
 * scrolling costs a redraw rather than a rasterisation. The panes are left out of the clone so the
 * glass can never feed back into its own backdrop; captures are otherwise driven by DOM mutations,
 * video playback and the sliders' own parameters, all of which are free.
 *
 * The caller keeps the panes' HTML: this paints only the band, and the adaptive-ink sampler keeps
 * reading each pane's veil from the element's own background.
 *
 * It is an option, not the default: the stored "WebGPU rendering" switch asks for it, a
 * development build's `?glasswebgpu=1` compares the two, and WebKit — which has no other way to
 * bend a rim — takes it without being asked. Every other engine keeps the SVG map, which needs no
 * device, no capture and no clone of the page.
 */

import { MAX_BAND_PX, MAX_DISPERSION, MAX_EDGE_OFFSET, MAX_PULL_SHARE, type GlassGroup, type GlassGroupValues } from "./glassEdge";

/** The band's own cap: the two rims of a short pane must not meet in its middle. */
const MAX_BAND_SHARE = 0.5;
/** The player bar reads the sliders at 3× and pulls 2.5× deeper; see glassEdge.ts for why. */
const BOOSTED_PULL_SHARE = MAX_PULL_SHARE * 2.5;
/** Air on one side, and the glass the panes are pretending to be on the other. */
const IOR = 1.5;
/** tan(asin(1/n)) — the shift a grazing ray picks up per unit thickness. */
const MAX_BEND = 1 / Math.sqrt(IOR * IOR - 1);
/** The stylesheet's veil at clarity 0; the pane's own computed tint is what actually gets used. */
const VEIL_MAX = 0.88;
/** How much page above and below the screen the raster carries, as a share of its height. */
const BAND_MARGIN = 0.75;
/** How far the scroll may drift before the page's fixed layers stop lining up with the band. */
const BAND_DRIFT = 0.6;
/** The raster's densest useful scale: the screen's own, never beyond two. */
const MAX_RASTER_SCALE = 2;
/** How often the page may be rasterised back-to-back, in ms. */
const CAPTURE_INTERVAL = 200;
/** Idle polling: catches video playback, image loads and one-off animations. */
const POLL_INTERVAL = 400;
/** A pane below this is too small for a rim band to mean anything. */
const MIN_PANE = 24;
const MIN_BAND = 0.75;
/** How many rasterisations may fail before the CSS fallback takes over. */
const MAX_FAILURES = 3;
/** How much of the tint's brightness a full shade removes — the stylesheet's own factor. */
const SHADE_MAX = 0.85;

const NS = "http://www.w3.org/2000/svg";

/**
 * Whether this engine should bend its rims in WebGPU. WebKit must — it *accepts* `url()` in a
 * backdrop-filter list and then paints nothing for it, whatever its parser answered. Chromium has
 * the SVG map already and takes WebGPU only when asked for: the stored "WebGPU rendering" switch
 * (`enable`), or a development build's `?glasswebgpu=1`, which is how the two implementations are
 * compared. An engine with no `navigator.gpu` at all keeps the SVG path, and so does one whose
 * device never arrives — see `attachGlassWebgpu`.
 */
export function canUseWebgpuGlass(enable = false) {
  if (typeof document === "undefined" || typeof navigator === "undefined") return false;
  if (!("gpu" in navigator) || !navigator.gpu) return false;
  if (enable) return true;
  if (process.env.NODE_ENV !== "production" && /[?&]glasswebgpu\b/.test(window.location.search)) return true;
  return /apple/i.test(navigator.vendor ?? "");
}

/** The five sliders, as the shell has them. */
export type GlassParameters = {
  /** Blur in px, into the frost. */
  blur: number;
  /** 0–1: 1 is nearly clear glass, 0 an opaque milky pane. */
  clarity: number;
  /** Rim pull in px, before the pane's own multiplier. */
  offset: number;
  /** Band width in px, before the pane's own multiplier. */
  band: number;
  /** Corner-radius multiplier, as `--glass-radius` carries it. */
  radius: number;
  /** The master rainbow, 0–1: how far the sample separates per colour channel. */
  dispersion: number;
};

/**
 * The seven families a rim can belong to, read off `--glass-group` exactly as `lib/glassEdge.ts`
 * reads it, so both engines agree on which base band/pull a pane follows.
 */
const GLASS_GROUPS: readonly string[] = ["pane", "card", "button", "field", "chip", "capsule", "tile"];
function groupOf(style: CSSStyleDeclaration): GlassGroup | null {
  const raw = style.getPropertyValue("--glass-group").trim();
  return GLASS_GROUPS.includes(raw) ? (raw as GlassGroup) : null;
}

export type GlassWebgpuHandle = {
  setParameters(next: GlassParameters): void;
  /** Per-family base band/pull; a group's pane reads these instead of the two sliders. */
  setGroups(next: GlassGroupValues): void;
  /** Force a capture on the next tick — used when the caller knows the page just changed. */
  invalidate(): void;
  /** Redraw at the panes' current boxes without re-rasterising: for panes that moved silently. */
  refresh(): void;
  destroy(): void;
};

type Pane = {
  element: HTMLElement;
  canvas: HTMLCanvasElement;
  /** The WebGPU context the rim band is drawn into; null if the canvas cannot give one. */
  context: GPUCanvasContext | null;
  /** False until (or whenever) the context has been configured for the device's format. */
  configured: boolean;
  /** The bind group this pane draws with, and the frost texture it was built for. */
  bindGroup: GPUBindGroup | null;
  bindKey: string;
  /** This pane's own uniform block: 96 bytes, rewritten every frame it is drawn. */
  uniformBuffer: GPUBuffer | null;
  /** The band and pull this pane last drew with, in CSS px — what the capture needs to know how
      far into the pane its own rim can read. */
  bandCss: number;
  pullCss: number;
  /** `data-glass-edge` as a number: how much harder this pane reads both sliders. */
  boost: number;
  /** The family whose base band/pull this pane follows, or null for the global sliders. */
  group: GlassGroup | null;
  /** The pane's own ceilings in CSS px, from `--glass-band-cap` / `--glass-pull-cap`; 0 = none. */
  bandCap: number;
  pullCap: number;
  /** Border-box top-left within the viewport, in CSS px. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Corner radius of the padding box, in CSS px — what the canvas' surface must show. */
  radius: number;
  /** The pane's own tint alpha, read from the style the ink sampler also trusts. */
  veil: number;
  /** That tint's colour as 0–1 channels, before the ink sampler's shade is folded in per frame. */
  tint: number[];
  /** The saturation its backdrop-filter applies, so the band matches the interior's colours. */
  saturation: number;
};

/* ── the shader ─────────────────────────────────────────────────────────────────────────── */

/**
 * The pane's uniforms, in the order WGSL wants them: a vec3 aligns to 16, so the tint sits at
 * byte 80 with four floats of padding in front of it and one behind, and the block is 96 bytes —
 * one buffer per pane, written once per frame. 96, not the 80 the fields before the tint add up
 * to: a uniform binding is validated against the *whole* struct, and one byte short is not a
 * smaller uniform block but an invalid bind group — the write is dropped, `setBindGroup` faults,
 * and every pane silently draws nothing at all, which is exactly what the band did: the glass
 * stayed its own flat backdrop-filter with no bend in it anywhere. The TypeScript side fills a
 * `Float32Array(24)` with these same offsets.
 */
const PANE_UNIFORM_SIZE = 96;

const PANE_WGSL = `
struct Pane {
  size: vec2f,
  rasterSize: vec2f,
  rasterOrigin: vec2f,
  rasterRatio: f32,
  radius: f32,
  band: f32,
  pull: f32,
  veil: f32,
  saturation: f32,
  dispersion: f32,
  glow: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
  pad3: f32,
  tint: vec3f,
  pad4: f32,
};

@group(0) @binding(0) var<uniform> pane: Pane;
@group(0) @binding(1) var frosted: texture_2d<f32>;
@group(0) @binding(2) var frostedSampler: sampler;

struct VertexOut {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

// One triangle over the whole canvas: the pane's surface *is* the canvas, so the quad the GL path
// positioned inside a shared viewport is simply the canvas itself here.
@vertex
fn vs(@builtin(vertex_index) index: u32) -> VertexOut {
  var corners = array<vec2f, 3>(vec2f(-1., -1.), vec2f(3., -1.), vec2f(-1., 3.));
  let corner = corners[index];
  var out: VertexOut;
  out.uv = corner * .5 + .5;
  out.position = vec4f(corner, 0., 1.);
  return out;
}

const MAX_BEND = ${MAX_BEND.toFixed(12)};
const MAX_DISPERSION = ${MAX_DISPERSION.toFixed(3)};

fn roundedBoxDistance(p: vec2f, h: vec2f, r: f32) -> f32 {
  let q = abs(p) - (h - vec2f(r));
  let o = max(q, vec2f(0.));
  return length(o) + min(max(q.x, q.y), 0.) - r;
}
/** Squircle dome height across the bend: 0 where the outer face meets the rim, 1 where it levels. */
fn dome(t: f32) -> f32 { let k = 1. - t; return pow(max(0., 1. - k * k * k * k), .25); }
/** Refracted lateral shift per unit thickness: tan θ₂ for a ray arriving along the view axis. */
fn surfaceBend(t: f32) -> f32 {
  let r = dome(t) / (1. - t);
  let r6 = pow(r, 6.);
  let s1 = 1. / sqrt(1. + r6);
  let s2 = min(1., s1 / ${IOR.toFixed(2)});
  return s2 / sqrt(1. - s2 * s2);
}
/** CSS saturate(): lerp between the pixel's luma and the pixel, the same matrix the filter uses. */
fn saturateColor(color: vec3f, amount: f32) -> vec3f {
  return mix(vec3f(dot(color, vec3f(.213, .715, .072))), color, amount);
}

@fragment
fn fs(in: VertexOut) -> @location(0) vec4f {
  // Local space is the pane's own box with its origin at the bottom-left, y up — the same space
  // the GLSL drew in, so every constant below is the one the two renderers have always shared.
  let local = in.uv * pane.size;
  let halfSize = pane.size * .5;
  let inside = -roundedBoxDistance(local - halfSize, halfSize, pane.radius);
  // Only the rim band is drawn. Everything deeper is the pane's own backdrop-filter — live, and
  // sharper than anything this canvas could hold — so the surface stops exactly where the bend
  // does, and the two meet at a seam the optics cannot show: the displacement is zero there.
  if (inside < 0. || inside >= pane.band) { discard; }

  let bend = surfaceBend(inside / pane.band) / MAX_BEND;
  let dx = roundedBoxDistance(local - halfSize + vec2f(.5, 0.), halfSize, pane.radius)
         - roundedBoxDistance(local - halfSize - vec2f(.5, 0.), halfSize, pane.radius);
  let dy = roundedBoxDistance(local - halfSize + vec2f(0., .5), halfSize, pane.radius)
         - roundedBoxDistance(local - halfSize - vec2f(0., .5), halfSize, pane.radius);
  // The gradient of the distance field points out of the pane, so the ray is bent along its
  // negative: inward, through the bevel, exactly as the SVG map's normal points.
  let inward = -normalize(vec2f(dx, dy) + vec2f(1e-6));

  // The raster's index origin is top-left, so y flips here and nowhere else — including in the
  // displacement, which is computed in this bottom-up space: minus y is down the raster. The
  // raster is its own resolution (a CSS px per texel, however dense the screen), so both the
  // pixel's position and the bend it carries are converted into raster pixels here.
  // The sample may travel inward, but never past the band's own inner edge: band - inside is how
  // much glass is left between this pixel and the flat middle. Past that the mapping used to
  // fold back on itself — the same backdrop sampled twice, from two depths at once — and the rim
  // tore: a bar over a photograph came back as horizontal streaks rather than a bend. Clamping the
  // reach keeps the mapping monotonic (the innermost pixels all read the band's inner edge, which
  // is flat anyway), so the band can only ever show the ring it is drawn on.
  let reach = min(bend * pane.pull, pane.band - inside);
  let shift = vec2f(inward.x, -inward.y) * reach;
  // The pane-relative position in device px, converted to raster px, and only then moved into the
  // raster's own frame: rasterOrigin is already in raster px, and folding it into the same
  // multiply would scale it a second time — the sample would land elsewhere entirely and the rim
  // would read as a flat wash with no bend in it at all.
  let origin = vec2f(local.x, pane.size.y - local.y) * pane.rasterRatio + pane.rasterOrigin;
  let maxPx = pane.rasterSize - vec2f(1.);
  // The rainbow: the master dial scaled by this pane's measured brightness (glow) splits the
  // sample per channel — red reads shallower than the green, the blue deeper, the order a prism
  // separates them in. At zero the single fetch stands, so a pane pays nothing for a rainbow it
  // is not showing. Each fetch is clamped into the texture on its own: at the band's strongest
  // bend a channel's sample would otherwise run off the raster where a rim meets its edge.
  var color: vec3f;
  let spread = pane.dispersion * pane.glow * MAX_DISPERSION;
  if (spread > .002) {
    let redPx = clamp(origin + shift * (1. - spread) * pane.rasterRatio, vec2f(0.), maxPx);
    let greenPx = clamp(origin + shift * pane.rasterRatio, vec2f(0.), maxPx);
    let bluePx = clamp(origin + shift * (1. + spread) * pane.rasterRatio, vec2f(0.), maxPx);
    color = vec3f(
      textureSampleLevel(frosted, frostedSampler, redPx / pane.rasterSize, 0.).r,
      textureSampleLevel(frosted, frostedSampler, greenPx / pane.rasterSize, 0.).g,
      textureSampleLevel(frosted, frostedSampler, bluePx / pane.rasterSize, 0.).b);
  } else {
    let rasterPx = clamp(origin + shift * pane.rasterRatio, vec2f(0.), maxPx);
    color = textureSampleLevel(frosted, frostedSampler, rasterPx / pane.rasterSize, 0.).rgb;
  }
  // Both material terms the pane's own backdrop-filter adds, in its order: the blur is the
  // texture's, then the saturation, then the veil the pane lays over it.
  color = saturateColor(color, pane.saturation);
  // The pane's own tint, already darkened by whatever shade the ink sampler measured behind it,
  // so the band and the flat middle it meets are painted with the same colour. The canvas is
  // premultiplied and this alpha is 1, so the band cannot pick up a grey wash of its own.
  return vec4f(mix(color, pane.tint, pane.veil), 1.);
}
`;

/** Separable Gaussian: 13 taps spaced by `spacing`, sigma fixed at 3 — spread = 3·spacing. */
const BLUR_WGSL = `
struct Blur {
  texel: vec2f,
  direction: vec2f,
  spacing: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var source: texture_2d<f32>;
@group(0) @binding(1) var sourceSampler: sampler;
/* Not "target": WGSL reserves the word, and a shader that will not build makes an *invalid*
   compute pipeline — see the compile check below, which is what catches that. */
@group(0) @binding(2) var dest: texture_storage_2d<rgba8unorm, write>;
@group(0) @binding(3) var<uniform> blur: Blur;

const W = array<f32, 7>(0.214607, 0.205036, 0.177247, 0.138812, 0.098409, 0.062348, 0.035669);
const TEXELS = 7u;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(dest);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  let uv = (vec2f(id.xy) + vec2f(.5)) / vec2f(dims);
  var sum = textureSampleLevel(source, sourceSampler, uv, 0.).rgb * W[0];
  var total = W[0];
  for (var i = 1u; i < TEXELS; i += 1u) {
    let step = blur.direction * blur.texel * blur.spacing * f32(i);
    sum += (textureSampleLevel(source, sourceSampler, uv + step, 0.).rgb
          + textureSampleLevel(source, sourceSampler, uv - step, 0.).rgb) * W[i];
    total += W[i] * 2.;
  }
  textureStore(dest, vec2i(id.xy), vec4f(sum / total, 1.));
}
`;

/* ── the capture: the page as one raster ────────────────────────────────────────────────── */
/* ── the capture: the page as one raster ────────────────────────────────────────────────── */

/* No font inlining here any more. A rasterised SVG may not fetch anything, which is why the
   page's webfonts used to be followed and carried as data URIs — but the studio now sets its type
   in the system face, and a system face is already there inside a foreignObject. One less network
   round trip on the first capture, and one less way for the raster to disagree with the page. */

/** Properties that decide where a box sits; the clone carries an absolute rect instead. */
const SKIP_STYLE = new Set([
  "position", "left", "top", "right", "bottom", "inset", "margin", "margin-top", "margin-right",
  "margin-bottom", "margin-left", "transform", "translate", "scale", "rotate", "z-index", "float",
  "gap", "row-gap", "column-gap", "flex", "flex-basis", "flex-grow", "flex-shrink", "align-items",
  "justify-content", "align-self", "order", "grid-area", "transition", "animation", "will-change",
]);

const COPY_STYLE = [
  "display", "flex-direction", "flex-wrap", "box-sizing", "width", "height", "overflow",
  "background", "background-color", "background-image", "background-size", "background-position",
  "background-repeat", "border", "border-radius", "box-shadow", "opacity", "visibility", "color",
  "font", "font-family", "font-size", "font-weight", "line-height", "letter-spacing", "text-align",
  "text-overflow", "white-space", "word-break", "text-shadow", "filter", "object-fit",
  "object-position", "padding", "padding-top", "padding-right", "padding-bottom", "padding-left",
  "aspect-ratio", "mix-blend-mode", "isolation", "text-decoration", "fill", "stroke",
];

const DEFAULT_STYLE = new Set([
  "none", "normal", "auto", "0px", "rgba(0, 0, 0, 0)", "visible", "static", "block", "1", "0",
  "start", "nowrap", "left", "0s", "0deg", "1px", "row", "fill", "pointer", "0%", "0 0 auto",
]);

/** Where an element sat, and how far its padding box is inset from that box. */
type Box = { rect: DOMRect; borderLeft: number; borderTop: number };
type Clone = { entity: HTMLElement; snapshots: Map<Element, Box>; holders: Map<Element, Element> };

/**
 * Reads every visible element's computed style once, then rebuilds the page as an
 * absolutely-positioned tree that can survive serialisation into an SVG. Every copy is a
 * containing block for its own children, so each one is placed relative to the parent's padding
 * box — the same box `left`/`top` are measured from — rather than to the viewport, which would
 * add every ancestor's offset a second time.
 *
 * `originY` is the raster's own top edge as a viewport coordinate — negative whenever the band
 * starts above the screen. The clone reproduces a band of the page rather than the screen, so a
 * scroll moves the sampling instead of requiring a new texture.
 *
 * An element marked `data-raster-fill` is the exception: it is the page's backdrop, which is
 * fixed to the screen and must not travel with the scroll. Its copy is stretched over the whole
 * band and its background is drawn at the size and offset that put the screen's own view of it
 * exactly where the screen has it — so the part of the band the viewport can actually show is
 * pixel-correct, and the rest of the band (which only the sampling ever reaches, and only until
 * the next capture) carries the same backdrop rather than a flat hole.
 */
function buildClone(root: HTMLElement, originY: number, bandHeight: number, skip: (element: Element) => boolean, muted: (element: Element) => boolean = () => false, inset: (element: Element) => number = () => 0): Clone {
  const snapshots = new Map<Element, Box>();
  const styles = new Map<Element, string>();
  // One read pass with no writes in between: nothing here forces a second style flush.
  Array.from(root.querySelectorAll("*")).forEach((element) => {
    if (skip(element)) return;
    const rect = element.getBoundingClientRect();
    const computed = getComputedStyle(element);
    snapshots.set(element, {
      rect,
      borderLeft: parseFloat(computed.borderLeftWidth) || 0,
      borderTop: parseFloat(computed.borderTopWidth) || 0,
    });
    if (rect.width < 1 && rect.height < 1) return;
    let style = "";
    for (const property of COPY_STYLE) {
      if (SKIP_STYLE.has(property)) continue;
      const value = computed.getPropertyValue(property);
      if (!value || DEFAULT_STYLE.has(value)) continue;
      style += `${property}:${value};`;
    }
    styles.set(element, style);
  });

  const entity = document.createElement("div");
  entity.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
  // The root's own paint travels with it, exactly like every child's: the shell's background is a
  // gradient (its computed background-color is transparent), and without it the raster would be
  // a transparent hole wherever a pane does not cover page content.
  const rootStyle = getComputedStyle(root);
  let own = "";
  for (const property of COPY_STYLE) {
    const value = rootStyle.getPropertyValue(property);
    if (!value || DEFAULT_STYLE.has(value)) continue;
    own += `${property}:${value};`;
  }
  // Padding and border are zeroed: the clone's children are placed from this box' padding box,
  // which has to sit exactly on the viewport origin for their rects to keep their meaning.
  entity.setAttribute("style", `${own}position:absolute;left:0;top:0;width:100%;height:100%;padding:0;border:0`);
  const holders = new Map<Element, Element>();
  holders.set(root, entity);

  const walk = (element: Element) => {
    const parent = holders.get(element);
    if (!parent) return;
    // Children of the clone's root land on the raster's own top edge, not on the viewport's.
    const origin = snapshots.get(element);
    const originTop = origin ? origin.rect.top + origin.borderTop : originY;
    for (const child of Array.from(element.childNodes)) {
      // Text is content, not decoration: a clone of elements alone rasterises every label,
      // heading and track name into nothing but its box.
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        if (text.trim()) parent.appendChild(document.createTextNode(text));
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const node = child as Element;
      if (skip(node)) continue;
      const box = snapshots.get(node);
      if (!box) continue;
      const name = node.tagName.toUpperCase();
      const left = box.rect.left - (origin ? origin.rect.left + origin.borderLeft : 0);
      const fill = node.hasAttribute("data-raster-fill");
      const top = fill ? originY - (origin ? origin.rect.top + origin.borderTop : 0) : box.rect.top - originTop;
      if (node.namespaceURI === NS && name !== "IMG") {
        // An SVG subtree keeps its markup: it cannot be re-created as HTML elements.
        parent.insertAdjacentHTML("beforeend", new XMLSerializer().serializeToString(node));
        const inserted = parent.lastElementChild;
        if (inserted) {
          holders.set(node, inserted);
          for (const grandchild of Array.from(node.children)) holders.set(grandchild, inserted);
        }
        continue;
      }
      const copy = document.createElement(name.toLowerCase());
      // A media element is swapped for an <img> by the caller; keep the box either way.
      if (name === "IMG" || name === "VIDEO" || name === "CANVAS") copy.setAttribute("data-media", name);
      let style = `${styles.get(node) ?? ""}position:absolute;left:${left}px;top:${top}px;width:${box.rect.width}px;height:${(fill ? bandHeight : box.rect.height)}px;`;
      // A pane contributes its *content* to the raster and nothing else. The glass itself — the
      // veil, the hairline, the shadow, the frost — is paint the page would not have if the pane
      // were absent, and a raster that carried it would be sampled through the pane's own veil:
      // milkier, and twice as thick as the same pane in Chromium. What must stay is what is
      // inside the pane, because the panes that overlap it sample exactly that.
      if (muted(node)) style += "background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;";
      // Its own rim may not read the pane's *content* either. The shader bounds a rim sample to
      // the band it is drawn on, and the band runs from the edge inward — straight over the
      // padding, where a bar's title, a card's heading or a chip's label sits. Left in, that
      // content comes back a second time, displaced, under the real thing: the doubled title the
      // WebGPU rim was showing. The clip takes it out of the raster over the reach a rim sample
      // can travel; what is left in that ring is the page behind the pane, which is what the
      // map-based renderer reads there too.
      const rim = inset(node);
      if (rim > 0) style += `clip-path:inset(${rim.toFixed(2)}px);`;
      // The backdrop's own background is laid out against the screen, not the element: pinned to
      // the size it has on screen and offset so its top edge sits where the viewport's top edge
      // is, then repeated to fill the rest of the band.
      if (fill) style += `background-size:${box.rect.width}px ${box.rect.height}px;background-position:0 ${-originY}px;background-repeat:repeat;background-attachment:scroll;`;
      copy.setAttribute("style", style);
      copy.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
      parent.appendChild(copy);
      holders.set(node, copy);
      walk(node);
    }
  };
  walk(root);
  return { entity, snapshots, holders };
}

/** A media element's own pixels: a video's frame, an image's file, a canvas' backing store. */
function naturalSize(element: Element) {
  if (element instanceof HTMLVideoElement) return { width: element.videoWidth, height: element.videoHeight };
  if (element instanceof HTMLImageElement) return { width: element.naturalWidth, height: element.naturalHeight };
  const canvas = element as HTMLCanvasElement;
  return { width: canvas.width, height: canvas.height };
}

/** One `object-position` term: a share of the free space, a length from the start edge, or a
    keyword — the same reading `background-position` gives the same grammar. */
function positionTerm(raw: string, free: number) {
  const value = raw.trim();
  if (value.endsWith("%")) return (parseFloat(value) / 100) * free;
  if (value === "top" || value === "left") return 0;
  if (value === "bottom" || value === "right") return free;
  const length = parseFloat(value);
  return Number.isFinite(length) ? length : free / 2;
}

/**
 * Converts one media element to a data URI of what the element actually *shows*; null when its
 * pixels cannot be read.
 *
 * The copy is the element's own box, not its file: an `<img>` whose computed `object-fit` is
 * `cover` — every cover in this studio, and the settings preview's photograph — shows a crop of
 * its file, and `drawImage(element, 0, 0)` copies the *top-left corner* of that file instead. The
 * raster then holds a different part of the picture than the screen does, and a rim sampling it
 * refracts content that is not the backdrop at all: the band stops matching the pane it has to
 * meet, which reads as a smudge rather than a bend. So the fit is applied here the way the browser
 * applies it — cover, contain, none, scale-down and fill, with `object-position` placing the paint
 * inside the box — and the canvas is the element's own box, so the clone holds exactly the pixels
 * the element has on screen.
 */
function mediaToDataUri(element: Element) {
  try {
    const natural = naturalSize(element);
    const boxWidth = element.clientWidth;
    const boxHeight = element.clientHeight;
    if (!natural.width || !natural.height || !boxWidth || !boxHeight) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(boxWidth));
    canvas.height = Math.max(1, Math.round(boxHeight));
    const context = canvas.getContext("2d");
    if (!context) return null;
    const style = getComputedStyle(element);
    const fit = style.objectFit || "fill";
    const contain = Math.min(boxWidth / natural.width, boxHeight / natural.height);
    const scale = fit === "cover" ? Math.max(boxWidth / natural.width, boxHeight / natural.height)
      : fit === "contain" ? contain
        : fit === "none" ? 1
          : fit === "scale-down" ? Math.min(1, contain)
            : null;
    // `fill` (and any keyword a future engine adds) is the one case with no fitting: the file is
    // stretched to the box, which is exactly what the element paints.
    const drawn = scale === null
      ? { width: boxWidth, height: boxHeight }
      : { width: natural.width * scale, height: natural.height * scale };
    // A single `object-position` term sets the horizontal one and centres the other, the same rule
    // `background-position` keeps.
    const terms = (style.objectPosition || "50% 50%").split(" ");
    const left = positionTerm(terms[0] ?? "50%", boxWidth - drawn.width);
    const top = positionTerm(terms[1] ?? "50%", boxHeight - drawn.height);
    context.drawImage(element as CanvasImageSource, left, top, drawn.width, drawn.height);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/* ── the renderer ──────────────────────────────────────────────────────────────────────── */

export function attachGlassWebgpu(
  root: HTMLElement,
  initial: GlassParameters,
  enable = false,
  onUnavailable?: () => void,
): GlassWebgpuHandle | null {
  if (!canUseWebgpuGlass(enable)) return null;
  const gpu = navigator.gpu;
  if (!gpu) return null;

  /**
   * The device arrives asynchronously, so the engine is attached empty and fills itself in: the
   * panes get their canvases only once there is something to draw with, which is also why the
   * stylesheet's `.glass-webgpu` class is not set until then. A device that never arrives (or a
   * shader that will not build) hands the caller back to the SVG map through `onUnavailable`,
   * rather than leaving panes with a canvas nobody paints.
   */
  let device: GPUDevice | null = null;
  let panePipeline: GPURenderPipeline | null = null;
  let blurPipeline: GPUComputePipeline | null = null;
  let blurModule: GPUShaderModule | null = null;
  let sampler: GPUSampler | null = null;
  let canvasFormat: GPUTextureFormat = "bgra8unorm";
  /** The blur's two directions, one uniform block each so both passes encode into one submit. */
  let blurHorizontal: GPUBuffer | null = null;
  let blurVertical: GPUBuffer | null = null;

  const panes = new Map<HTMLElement, Pane>();
  const sizes = new ResizeObserver(() => { measurePanes(); render(); });
  let parameters: GlassParameters = { ...initial };
  /** The per-family base band/pull the page last handed in; empty = everything follows the sliders. */
  let groups: GlassGroupValues = {};
  let surface: Raster | null = null;
  /**
   * Which raster the panes' cached bind groups were built for. A pane holds its bind group until
   * something in the key changes, and the key used to be the blur radius plus the raster's *size*
   * — both of which are the *same* after the next capture, because every capture of the same page
   * has the same dimensions. So from the second capture on, every pane drew with a bind group
   * still pointing at the frost texture of the raster that had just been destroyed: a submit that
   * references a destroyed texture is rejected whole, and the band stopped painting altogether —
   * silently, since the error only ever reached the device's own `uncapturederror` event. A
   * capture is a new generation and the key carries its number, so a stale group can never outlive
   * its texture.
   */
  let surfaceGeneration = 0;
  /** The document rectangle the raster covers, and how many device px it has per CSS px. */
  let rasterLeft = 0;
  let rasterTop = 0;
  let rasterBottom = 0;
  let rasterScale = 1;
  let captureScrollY = 0;
  let frame = 0;
  let capturing = false;
  let captureQueued = false;
  let destroyed = false;
  let failures = 0;
  let lastCaptureAt = 0;
  let lastSignature = "";
  let pending = 0;

  /* ── textures ── */

  /** The raster and its blurred copy: one pair per capture, reused until the raster changes. */
  type Raster = {
    texture: GPUTexture;
    scratch: GPUTexture;
    frost: GPUTexture | null;
    frostKey: string;
    width: number;
    height: number;
  };

  function makeTexture(width: number, height: number, usage: GPUTextureUsageFlags) {
    return device!.createTexture({
      size: [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))],
      format: "rgba8unorm",
      usage,
    });
  }

  function freeSurface(value: Raster) {
    value.texture.destroy();
    value.scratch.destroy();
    value.frost?.destroy();
  }

  function dropSurface() {
    if (!surface) return;
    freeSurface(surface);
    surface = null;
  }

  /**
   * Uploads the raster at full resolution. There is no mip pyramid behind it: the band magnifies
   * this texture where the bend is strongest, and a halved level turns that magnification into
   * visible blocks — the whole reason a rim looked like a smear of grey squares. The copy is a
   * queue operation, so the raster never waits on the CPU.
   */
  function buildSurface(raster: HTMLCanvasElement) {
    if (!device) return false;
    const max = device.limits.maxTextureDimension2D;
    if (raster.width > max || raster.height > max) return false;
    try {
      const texture = makeTexture(raster.width, raster.height, GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING);
      device.queue.copyExternalImageToTexture({ source: raster }, { texture }, [raster.width, raster.height]);
      const scratch = makeTexture(raster.width, raster.height, GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING);
      dropSurface();
      surface = { texture, scratch, frost: null, frostKey: "", width: raster.width, height: raster.height };
      surfaceGeneration += 1;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Blurs the raster into the frost texture — two separable passes, cached until the radius or the
   * raster changes, so every pane shares one blur per capture. Both passes ride one command
   * buffer: nothing here reads the GPU back, so the frame's cost is a dispatch, not a stall.
   */
  function frost(blurPx: number): GPUTexture | null {
    const target = surface;
    if (!device || !blurPipeline || !sampler || !target || !blurHorizontal || !blurVertical) return null;
    const key = blurPx.toFixed(2);
    if (target.frost && target.frostKey === key) return target.frost;
    const frosted = target.frost ?? makeTexture(target.width, target.height, GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING);
    target.frost = frosted;
    // CSS `blur(r)` is a Gaussian whose standard deviation *is* r (CSS filter effects), and this
    // is two passes whose σ add in quadrature, so each pass must carry r/√2. The 13-tap kernel
    // below is Gaussian to σ ≈ 2.824 taps (its second moment: 2·Σwᵢi² / Σwᵢ = 7.98), so one
    // tap-step of σ is blurPx / (2.824·√2) = blurPx / 3.99 — hence the /4. The divisor used to be
    // 6√2, which put the whole two-pass σ at 0.47·r: the band was frostier than CSS asked for at
    // every radius, sharper than the pane's own interior it has to meet, and the seam between the
    // two read as a band of its own along the rim.
    const spacing = Math.max(0.35, blurPx / 4);
    const write = (buffer: GPUBuffer, direction: [number, number]) => {
      device!.queue.writeBuffer(buffer, 0, new Float32Array([1 / target.width, 1 / target.height, direction[0], direction[1], spacing, 0, 0, 0]));
    };
    write(blurHorizontal, [1, 0]);
    write(blurVertical, [0, 1]);
    const layout = blurPipeline.getBindGroupLayout(0);
    const group = (source: GPUTexture, destination: GPUTexture, buffer: GPUBuffer) => device!.createBindGroup({
      layout,
      entries: [
        { binding: 0, resource: source.createView() },
        { binding: 1, resource: sampler! },
        { binding: 2, resource: destination.createView() },
        { binding: 3, resource: { buffer } },
      ],
    });
    const encoder = device.createCommandEncoder();
    const pass = (bind: GPUBindGroup) => {
      const compute = encoder.beginComputePass();
      compute.setPipeline(blurPipeline!);
      compute.setBindGroup(0, bind);
      compute.dispatchWorkgroups(Math.ceil(target.width / 8), Math.ceil(target.height / 8));
      compute.end();
    };
    pass(group(target.texture, target.scratch, blurHorizontal));
    pass(group(target.scratch, frosted, blurVertical));
    device.queue.submit([encoder.finish()]);
    target.frostKey = key;
    return frosted;
  }

  /* ── panes ── */

  /**
   * The pane's tint and saturation, straight off the element. The shader could recompute the veil
   * from the clarity slider, but the dense panes override the stylesheet's formula, and the band
   * has to match the live interior it meets — so it reads what the pane actually paints, exactly
   * like inkSampler reads the same background.
   */
  function paneMaterial(element: HTMLElement) {
    const style = getComputedStyle(element);
    const tint = /rgba?\(([^)]*)\)/.exec(style.backgroundColor);
    const parts = tint ? tint[1].split(/[,/]/).map((part) => parseFloat(part)) : [];
    const alpha = parts.length > 3 ? parts[3] : 1;
    // The tint is read from the channel variables the stylesheet paints with, never back out of
    // the resolved background: that background already carries the ink sampler's shade, and
    // taking it as the tint would bake the shade in — the band would then be shaded a second time
    // and would stay dark long after the backdrop it was measured against had gone light. This
    // also lets the tint change without a re-read of the pane.
    const channel = (name: string, fallback: number) => {
      const value = parseFloat(style.getPropertyValue(name));
      return Number.isFinite(value) ? Math.min(255, Math.max(0, value)) / 255 : fallback;
    };
    const channels = [channel("--glass-tint-r", 1), channel("--glass-tint-g", 1), channel("--glass-tint-b", 1)];
    const filter = style.backdropFilter || style.getPropertyValue("-webkit-backdrop-filter") || "";
    const saturate = /saturate\(([\d.]+)(%?)\)/.exec(filter);
    const amount = saturate ? parseFloat(saturate[1]) / (saturate[2] ? 100 : 1) : 1;
    return {
      veil: Number.isFinite(alpha) ? Math.min(1, Math.max(0, alpha)) : VEIL_MAX,
      saturation: Number.isFinite(amount) && amount > 0 ? amount : 1,
      tint: channels,
    };
  }

  function syncPanes() {
    // Nothing to dress the panes with until the device exists: a canvas no one paints would be a
    // bare element in the pane's layout, and the class that positions it is not set yet either.
    if (!device) return false;
    let added = false;
    const found = new Set(root.querySelectorAll<HTMLElement>("[data-glass-edge]"));
    panes.forEach((pane, element) => {
      if (found.has(element) && element.isConnected) return;
      sizes.unobserve(element);
      pane.canvas.remove();
      panes.delete(element);
    });
    found.forEach((element) => {
      if (panes.has(element)) return;
      // A void element — an <input> — cannot host the surface canvas this path inserts, and
      // the CSS it would need is set on the element itself; the SVG path (Chromium) handles it,
      // and on Safari the field simply keeps its flat material rather than throwing mid-sync.
      if (element instanceof HTMLInputElement) return;
      added = true;
      const canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      canvas.className = "glass-surface";
      element.insertBefore(canvas, element.firstChild);
      const style = getComputedStyle(element);
      const outer = Math.min(
        parseFloat(style.borderTopLeftRadius) || 0,
        parseFloat(style.borderTopRightRadius) || 0,
        parseFloat(style.borderBottomLeftRadius) || 0,
        parseFloat(style.borderBottomRightRadius) || 0,
      );
      const border = parseFloat(style.borderLeftWidth) || 0;
      // The pane's own ceilings, in CSS px — the same pair lib/glassEdge.ts reads. 0 means none.
      const cap = (name: string) => { const value = Number.parseFloat(style.getPropertyValue(name)); return Number.isFinite(value) && value > 0 ? value : 0; };
      panes.set(element, {
        element,
        canvas,
        context: canvas.getContext("webgpu"),
        configured: false,
        bindGroup: null,
        bindKey: "",
        uniformBuffer: null,
        boost: Math.max(1, Number(element.dataset.glassEdge) || 1),
        group: groupOf(style),
        bandCap: cap("--glass-band-cap"),
        pullCap: cap("--glass-pull-cap"),
        x: 0, y: 0, width: 0, height: 0,
        radius: Math.max(0, outer - border),
        bandCss: 0,
        pullCss: 0,
        ...paneMaterial(element),
      });
      sizes.observe(element);
    });
    if (added) measurePanes();
    return added;
  }

  function measurePanes() {
    const dpr = window.devicePixelRatio || 1;
    panes.forEach((pane) => {
      // offsetWidth/Height, never a transformed rect: several panes animate scale on entry.
      pane.width = pane.element.offsetWidth;
      pane.height = pane.element.offsetHeight;
      const box = pane.element.getBoundingClientRect();
      pane.x = box.left;
      pane.y = box.top;
      const width = Math.max(1, Math.round(pane.width * dpr));
      const height = Math.max(1, Math.round(pane.height * dpr));
      if (pane.canvas.width !== width || pane.canvas.height !== height) {
        pane.canvas.width = width;
        pane.canvas.height = height;
        // A resized canvas hands back a fresh drawing buffer, so the context has to be told the
        // configuration again before the next frame draws into it.
        pane.configured = false;
      }
    });
  }

  function render() {
    if (destroyed || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      draw();
    });
  }

  /**
   * One frame: every pane's rim band, drawn into its own canvas. The panes are gathered into a
   * single command buffer and submitted once, so a page of twelve panes costs one submit, not
   * twelve — and nothing is read back, which is what lets the frame end without a stall.
   */
  function draw() {
    const raster = surface;
    const gpuDevice = device;
    const pipeline = panePipeline;
    const frostedSampler = sampler;
    if (destroyed || !raster || !gpuDevice || !pipeline || !frostedSampler) return;
    // A pane may have moved since the last frame (scroll, an entry animation); the surface is
    // sampled from the raster by viewport position, so it can never be drawn from a stale box.
    measurePanes();
    const dpr = window.devicePixelRatio || 1;
    // The blur lives in the raster's texels, which are CSS px wide whatever the screen is.
    const frosted = frost(Math.max(0, parameters.blur) * rasterScale);
    if (!frosted) return;
    const bindKey = `${surfaceGeneration}|${raster.frostKey}|${raster.width}x${raster.height}`;
    const encoder = gpuDevice.createCommandEncoder();

    panes.forEach((pane) => {
      const context = pane.context;
      if (!context) return;
      const paneWidth = pane.canvas.width;
      const paneHeight = pane.canvas.height;
      /** Cleared, not drawn: the interior is the pane's own live backdrop-filter. */
      const clearOnly = () => {
        const attachment: GPURenderPassColorAttachment = { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } };
        const pass = encoder.beginRenderPass({ colorAttachments: [attachment] });
        pass.end();
      };
      if (!pane.configured) {
        context.configure({ device: gpuDevice, format: canvasFormat, alphaMode: "premultiplied" });
        pane.configured = true;
      }
      if (!pane.width || !pane.height || pane.width < MIN_PANE || pane.height < MIN_PANE) { clearOnly(); return; }
      if (pane.x + pane.width <= 0 || pane.y + pane.height <= 0 || pane.x >= window.innerWidth || pane.y >= window.innerHeight) { clearOnly(); return; }
      const scale = pane.boost;
      const baseBand = (pane.group && groups[pane.group]?.band) ?? parameters.band;
      const band = Math.min(baseBand * scale * dpr, Math.min(paneWidth, paneHeight) * MAX_BAND_SHARE, pane.bandCap > 0 ? pane.bandCap * dpr : Infinity);
      if (band < MIN_BAND) { clearOnly(); return; }
      pane.bandCss = band / dpr;
      const share = scale > 1 ? BOOSTED_PULL_SHARE : MAX_PULL_SHARE;
      const basePull = (pane.group && groups[pane.group]?.pull) ?? Math.max(0, parameters.offset);
      const pull = Math.min(basePull * scale * dpr, band * share, pane.pullCap > 0 ? pane.pullCap * dpr : Infinity);
      pane.pullCss = pull / dpr;

      // The pane's own uniforms. The tint is read from the channel variables the stylesheet
      // paints with and darkened by the shade the ink sampler measured, exactly as the GL path
      // did: taking the resolved background instead would bake the shade in twice and leave the
      // band grey long after the backdrop under it had gone light.
      const shade = Number(pane.element.style.getPropertyValue("--glass-shade")) || 0;
      const lit = 1 - Math.min(1, Math.max(0, shade)) * SHADE_MAX;
      const glow = Number.parseFloat(pane.element.style.getPropertyValue("--glass-glow"));
      // A radius past half the short side is clamped by the browser when it paints the box — a
      // 999px pill is a capsule, not a shape with no corners — and the distance field has to be
      // clamped the same way. Unclamped, the rounded box has no interior at all and every
      // fragment fails the band test: the pane draws nothing, which is what a pill and its
      // bubble, both 999px, were doing.
      const halfShort = Math.min(paneWidth, paneHeight) / 2;
      const values = new Float32Array(24);
      values[0] = paneWidth;
      values[1] = paneHeight;
      values[2] = raster.width;
      values[3] = raster.height;
      // The pane's own top-left in the raster's frame, in raster pixels: the live scroll, never
      // the capture's, which is what makes a scroll cost a redraw and nothing else.
      values[4] = (pane.x + window.scrollX - rasterLeft) * rasterScale;
      values[5] = (pane.y + window.scrollY - rasterTop) * rasterScale;
      values[6] = rasterScale / dpr;
      values[7] = Math.min(pane.radius * dpr, halfShort);
      values[8] = band;
      values[9] = pull;
      values[10] = pane.veil;
      values[11] = pane.saturation;
      values[12] = Math.min(1, Math.max(0, parameters.dispersion));
      values[13] = Number.isFinite(glow) ? Math.min(1, Math.max(0, glow)) : 1;
      values[20] = pane.tint[0] * lit;
      values[21] = pane.tint[1] * lit;
      values[22] = pane.tint[2] * lit;
      const buffer = pane.uniformBuffer ?? gpuDevice.createBuffer({ size: PANE_UNIFORM_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      pane.uniformBuffer = buffer;
      gpuDevice.queue.writeBuffer(buffer, 0, values);

      if (!pane.bindGroup || pane.bindKey !== bindKey) {
        pane.bindGroup = gpuDevice.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: { buffer } },
            { binding: 1, resource: frosted.createView() },
            { binding: 2, resource: frostedSampler },
          ],
        });
        pane.bindKey = bindKey;
      }
      // Cleared first and drawn over: the canvas is the pane's whole box, so the pass covers it
      // and there is nothing to scissor — the shader discards everything inside the band's edge.
      const attachment: GPURenderPassColorAttachment = { view: context.getCurrentTexture().createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } };
      const pass = encoder.beginRenderPass({ colorAttachments: [attachment] });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, pane.bindGroup!);
      pass.draw(3);
      pass.end();
    });

    gpuDevice.queue.submit([encoder.finish()]);
  }

  /* ── capture ── */

  /**
   * How far from a pane the raster can still be read: the band's own width, plus the pull that
   * shifts the sample inward, plus the blur's spread (three σ = 1.5 × the blur radius, in CSS px).
   */
  function panesReach() {
    const reach = Math.max(parameters.band * 3, 82) + Math.max(0, parameters.offset * 3) + Math.max(0, parameters.blur) * 1.5 + 24;
    return panes.size ? Array.from(panes.values()).map((pane) => ({
      left: pane.x - reach,
      top: pane.y - reach,
      right: pane.x + pane.width + reach,
      bottom: pane.y + pane.height + reach,
    })) : [];
  }

  function overlaps(boxes: { left: number; top: number; right: number; bottom: number }[], rect: DOMRect) {
    for (const box of boxes) {
      if (rect.right > box.left && rect.left < box.right && rect.bottom > box.top && rect.top < box.bottom) return true;
    }
    return false;
  }

  /**
   * Whether the band on hand can still answer for the screen. Scrolling within it is free — the
   * shader samples it by document position — but leaving it, or drifting far enough that the
   * page's own fixed layers (the ambient orbs) no longer line up, needs a fresh raster.
   */
  function outOfBand() {
    const scrollY = window.scrollY;
    if (window.scrollX !== rasterLeft) return true;
    if (scrollY < rasterTop || scrollY + window.innerHeight > rasterBottom) return true;
    return Math.abs(scrollY - captureScrollY) > window.innerHeight * BAND_DRIFT;
  }

  /** Everything that changes what the backdrop looks like, cheaply hashed. */
  function signature() {
    const parts = [
      `${window.devicePixelRatio}|${window.innerWidth}x${window.innerHeight}`,
    ];
    Array.from(document.querySelectorAll("video")).forEach((video) => parts.push(video.paused ? "p" : video.currentTime.toFixed(2)));
    panes.forEach((pane) => parts.push(`${pane.width}x${pane.height}`));
    return parts.join("|");
  }

  async function capture(): Promise<HTMLCanvasElement | null> {
    const dpr = Math.min(MAX_RASTER_SCALE, window.devicePixelRatio || 1);
    const width = window.innerWidth;
    const height = window.innerHeight;
    // The band of page this raster covers: the screen, plus enough above and below that ordinary
    // scrolling is served from the same texture. Only a page that changes underneath, or a scroll
    // past the margins, is worth another raster.
    const scrollY = window.scrollY;
    const documentHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight, height);
    const margin = Math.round(height * BAND_MARGIN);
    const bandTop = Math.max(0, Math.min(scrollY - margin, documentHeight - height - margin));
    const bandBottom = Math.min(documentHeight, Math.max(scrollY + height + margin, bandTop + height));
    const bandHeight = Math.max(height, bandBottom - bandTop);
    const canvases = new Set<HTMLCanvasElement>();
    const surfaces = new Set<Element>();
    panes.forEach((pane) => { canvases.add(pane.canvas); surfaces.add(pane.element); });
    // The panes are left out of the clone — never hidden in the live page, so the browser never
    // paints a frame without them, and the raster can never contain the last capture. What is
    // dropped is the pane itself, not just its surface: the raster has to be the page *behind*
    // the glass, and a clone that carried the pane's own tint would be sampled through the
    // pane's own veil, milkier and twice as thick as the same pane in Chromium.
    //
    // Every pane is dropped, including one that holds another pane. Keeping a host's children so
    // a nested bubble had something to bend was tried and is worse: the *host's own* rim then
    // samples its own contents, so a bar's title and its controls come back a second time,
    // displaced, under the real ones — the double exposure a rim is least allowed to show. What
    // the nested panes lose instead is the host's own surface: their band reads the page behind
    // the host rather than the host's veil, a difference the veil they sit under mostly hides.
    /** How far into its own box a pane's rim can read, in CSS px. */
    const rimReader = (element: Element) => {
      const pane = panes.get(element as HTMLElement);
      if (!pane) return 0;
      // A pane the last frame did not draw has no measured band yet; the sliders are the best
      // guess then, and a capture after the first frame has the real pair.
      const band = pane.bandCss || parameters.band;
      const pull = pane.pullCss || parameters.offset;
      return Math.max(0, band + pull);
    };
    const clone = buildClone(root, bandTop - scrollY, bandHeight,
      (element) => element instanceof HTMLCanvasElement && canvases.has(element),
      (element) => surfaces.has(element),
      rimReader);
    const { entity, snapshots, holders } = clone;

    // Media becomes data URIs: a rasterised <img> with a relative src is a hole in Safari. Only
    // the media a pane can actually sample is worth encoding — a canvas round trip and a PNG
    // encode per cover on the page is the most expensive thing this capture does, and the rest of
    // the raster is behind nothing.
    const jobs: Promise<void>[] = [];
    const reach = panesReach();
    snapshots.forEach(({ rect }, element) => {
      const name = element.tagName.toUpperCase();
      if (name !== "IMG" && name !== "VIDEO" && name !== "CANVAS") return;
      if (!overlaps(reach, rect)) return;
      const copy = holders.get(element);
      if (!copy) return;
      if (name === "IMG") {
        // A data URI needs no round trip through a canvas — and a clone that kept the original
        // (relative) src would be a hole in the raster, so it is copied over as it stands.
        const source = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src;
        if (source.startsWith("data:")) { copy.setAttribute("src", source); return; }
        const uri = mediaToDataUri(element);
        if (uri) (copy as HTMLImageElement).setAttribute("src", uri);
        else copy.setAttribute("data-glass-hole", "");
        return;
      }
      jobs.push(Promise.resolve().then(() => {
        const uri = mediaToDataUri(element);
        const replacement = document.createElement("img");
        replacement.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        replacement.setAttribute("style", copy.getAttribute("style") ?? "");
        replacement.setAttribute("width", String(Math.max(1, Math.round(rect.width))));
        replacement.setAttribute("height", String(Math.max(1, Math.round(rect.height))));
        if (uri) replacement.setAttribute("src", uri);
        else replacement.setAttribute("data-glass-hole", "");
        copy.replaceWith(replacement);
      }));
    });
    await Promise.all(jobs);

    // What the document paints behind the shell: the colour on html/body, which the root clone
    // does not cover (the shell starts at the viewport, the page behind it is the document's own).
    const pageStyle = getComputedStyle(document.documentElement);
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(bandHeight * dpr));
    const wrapper = document.createElement("div");
    wrapper.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
    // The device scale is a *transform on the content*, never a viewBox: WebKit draws HTML inside a
    // foreignObject at its own size and ignores the viewBox that would have scaled it, which left
    // the raster a quarter-size copy of the page in one corner. The SVG is already in device
    // pixels, so scaling the clone is the only thing left to do.
    wrapper.setAttribute("style", `position:relative;width:${width}px;height:${bandHeight}px;overflow:hidden;` +
      `transform:scale(${dpr});transform-origin:0 0;background:${pageStyle.backgroundColor || "#fff"}`);
    wrapper.appendChild(entity);

    const xml = new XMLSerializer().serializeToString(wrapper);
    const svg = `<svg xmlns="${NS}" width="${pixelWidth}" height="${pixelHeight}">` +
      `<foreignObject x="0" y="0" width="${pixelWidth}" height="${pixelHeight}">${xml}</foreignObject></svg>`;

    const raster = document.createElement("canvas");
    raster.width = pixelWidth;
    raster.height = pixelHeight;
    const load = (uri: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("raster"));
      image.src = uri;
    });
    let image: HTMLImageElement;
    try {
      image = await load(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    } catch {
      let url: string | null = null;
      try {
        url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        image = await load(url);
      } catch {
        return null;
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
    const context = raster.getContext("2d");
    if (!context) return null;
    try {
      context.drawImage(image, 0, 0, raster.width, raster.height);
    } catch {
      return null;
    }
    // Committed only now: a failed capture must leave the working band where it was.
    rasterLeft = window.scrollX;
    rasterTop = bandTop;
    rasterBottom = bandTop + bandHeight;
    rasterScale = dpr;
    return raster;
  }

  /** Anything that leaves the glass unpainted, counted: three in a row and CSS takes over. */
  /** The rim cannot be drawn at all: hand the page back to the CSS/SVG fallback for good. */
  function giveUp() {
    root.classList.remove("glass-webgpu");
    root.classList.add("glass-rim-fallback");
    destroy();
    onUnavailable?.();
  }

  /** A capture or a draw failed — the first few are worth riding out, then the fallback stands. */
  function fail() {
    failures += 1;
    if (failures < MAX_FAILURES) return;
    giveUp();
  }

  function runCapture() {
    if (destroyed || !device) return;
    if (capturing) { captureQueued = true; return; }
    capturing = true;
    void capture().then((raster) => {
      if (destroyed) return;
      if (!raster) { fail(); return; }
      failures = 0;
      lastSignature = signature();
      lastCaptureAt = performance.now();
      captureScrollY = window.scrollY;
      if (!buildSurface(raster)) { fail(); return; }
      render();
    }).catch(() => {
      fail();
    }).finally(() => {
      capturing = false;
      if (captureQueued) {
        captureQueued = false;
        requestCapture();
      }
    });
  }

  /**
   * A capture request never vanishes: an early call parks on a timer instead of being dropped,
   * so the last scroll event of a flick still gets its raster and the glass cannot be left
   * showing a frame from the middle of the gesture.
   */
  function requestCapture() {
    if (destroyed) return;
    if (capturing) { captureQueued = true; return; }
    const wait = CAPTURE_INTERVAL - (performance.now() - lastCaptureAt);
    if (wait > 0) {
      if (!pending) pending = window.setTimeout(() => { pending = 0; requestCapture(); }, wait);
      return;
    }
    runCapture();
  }

  /* ── wiring ── */

  const poll = window.setInterval(() => {
    if (signature() === lastSignature) return;
    requestCapture();
  }, POLL_INTERVAL);

  // On the document, in the capture phase: much of what moves behind a pane does so inside an
  // inner scroller (the track list, the lyrics body), and those events never reach the window.
  // Scrolling inside the band only redraws; the raster is a slice of the document, so the glass
  // follows the page the way a backdrop-filter does, without a rasterisation per frame.
  const onScroll = () => {
    measurePanes();
    render();
    if (outOfBand()) requestCapture();
  };
  const onResize = () => { measurePanes(); requestCapture(); render(); };
  // The page itself changed, so the raster is out of date — panes that appear or leave are the
  // only case that also needs syncing. (The ink sampler rewrites styles, not structure.)
  const mutations = new MutationObserver(() => { syncPanes(); measurePanes(); render(); requestCapture(); });
  const observed = new WeakSet<Element>();
  function watch() {
    [root, ...Array.from(root.querySelectorAll(".content-area, .video-overlay"))].forEach((target) => {
      if (observed.has(target)) return;
      observed.add(target);
      mutations.observe(target, { childList: true, subtree: true });
    });
  }

  document.addEventListener("scroll", onScroll, { passive: true, capture: true });
  window.addEventListener("resize", onResize);
  const settle = window.setInterval(() => { syncPanes(); measurePanes(); watch(); render(); }, 600);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    window.clearInterval(poll);
    window.clearInterval(settle);
    if (pending) window.clearTimeout(pending);
    document.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    mutations.disconnect();
    sizes.disconnect();
    if (frame) window.cancelAnimationFrame(frame);
    panes.forEach((pane) => { pane.canvas.remove(); pane.uniformBuffer?.destroy(); });
    panes.clear();
    dropSurface();
    blurHorizontal?.destroy();
    blurVertical?.destroy();
    blurHorizontal = null;
    blurVertical = null;
    device?.destroy();
    device = null;
    root.classList.remove("glass-webgpu");
  }

  // The device first: until it exists there is nothing to draw with, so the panes keep the CSS rim
  // (the class that dresses their surface canvases is not set yet) and a device that never arrives
  // hands the caller straight back to the SVG map.
  watch();
  void gpu.requestAdapter({ powerPreference: "high-performance" })
    .then((adapter) => adapter?.requestDevice() ?? null)
    .then(async (next) => {
      if (!next) { giveUp(); return; }
      if (destroyed) { next.destroy(); return; }
      device = next;
      canvasFormat = gpu.getPreferredCanvasFormat();
      const paneModule = device.createShaderModule({ code: PANE_WGSL });
      const info = await paneModule.getCompilationInfo();
      if (info.messages.some((message) => message.type === "error")) throw new Error("pane shader");
      panePipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { module: paneModule, entryPoint: "vs" },
        fragment: { module: paneModule, entryPoint: "fs", targets: [{ format: canvasFormat }] },
        primitive: { topology: "triangle-list" },
      });
      blurModule = device.createShaderModule({ code: BLUR_WGSL });
      // Both modules are read before anything is built from them. The blur one had no check at
      // all, and that is how a single reserved word — the storage texture was called `target` —
      // turned the whole renderer into a silent no-op: nothing throws, the module simply makes an
      // *invalid* pipeline, and an invalid pipeline poisons every command buffer it is recorded
      // into, so the frame's submit is rejected whole and the band never paints a pixel. The blur
      // rides in the same command buffer as every pane, which is why a fault here read as "the
      // glass has no refraction at all" rather than as a missing frost.
      const blurInfo = await blurModule.getCompilationInfo();
      if (blurInfo.messages.some((message) => message.type === "error")) throw new Error("blur shader");
      blurPipeline = device.createComputePipeline({ layout: "auto", compute: { module: blurModule, entryPoint: "main" } });
      sampler = device.createSampler({ magFilter: "linear", minFilter: "linear", addressModeU: "clamp-to-edge", addressModeV: "clamp-to-edge" });
      blurHorizontal = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      blurVertical = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      root.classList.add("glass-webgpu");
      root.classList.remove("glass-rim-fallback");
      syncPanes();
      measurePanes();
      render();
      void runCapture();
    })
    .catch(() => giveUp());

  return {
    setParameters(next: GlassParameters) {
      parameters = { ...next };
      // The material is CSS, and clarity just rewrote it — re-read before the next frame draws.
      panes.forEach((pane) => { Object.assign(pane, paneMaterial(pane.element)); });
      render();
    },
    /** The per-family bases: a pane reads its own family's values instead of the sliders. */
    setGroups(next: GlassGroupValues) {
      groups = { ...next };
      render();
    },
    invalidate() { requestCapture(); },
    // A redraw at the panes' current boxes, with the raster it already holds — for a pane that
    // moved without any event the browser would tell us about (a CSS translate on the pill's
    // bubble). Never a re-rasterisation: that would cost a page capture per frame of a drag.
    // The material is re-read on the way through as well: the pill's bubble slides and changes
    // its veil between states, all of it in CSS and none of it announced, and a band still painted
    // with the veil the pane wore a moment ago would part company with the interior it meets.
    refresh() {
      measurePanes();
      panes.forEach((pane) => { Object.assign(pane, paneMaterial(pane.element)); });
      render();
    },
    destroy,
  };
}
