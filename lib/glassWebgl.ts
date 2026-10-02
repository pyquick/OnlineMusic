/**
 * The edge refraction, in WebGL.
 *
 * `lib/glassEdge.ts` bends a backdrop by handing the engine an SVG `feDisplacementMap` inside the
 * pane's `backdrop-filter`. Chromium paints that; WebKit parses it and paints nothing. This module
 * is the same refraction for an engine that cannot do it in CSS: a fragment shader draws the rim
 * band — squircle dome, Snell's law at IOR 1.5, the pull capped at a share of the band, the band
 * capped at half the pane's short side, all of it the SVG path's own maths, constant for constant
 * — and the two engines therefore show the same bend.
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
 */

import { MAX_BAND_PX, MAX_EDGE_OFFSET, type GlassGroup, type GlassGroupValues } from "./glassEdge";

/** The band's own cap: the two rims of a short pane must not meet in its middle. */
const MAX_BAND_SHARE = 0.5;
/** Deepest share of the band a rim sample may travel — the fold bound the tall panes keep. */
const MAX_PULL_SHARE = 0.3;
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
 * Whether this engine should bend its rims in WebGL. WebKit must — it *accepts* `url()` in a
 * backdrop-filter list and then paints nothing for it, whatever its parser answered. Chromium has
 * the SVG map already, and only opts in from a development build with `?glasswebgl=1`, which is
 * how the two implementations are compared before the WebGL one is relied on anywhere else.
 */
export function canUseWebglGlass() {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    if (!canvas.getContext("webgl2")) return false;
  } catch {
    return false;
  }
  if (process.env.NODE_ENV !== "production" && /[?&]glasswebgl\b/.test(window.location.search)) return true;
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

export type GlassWebglHandle = {
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
  /** The 2D context the rendered surface is blitted into; null if the canvas cannot give one. */
  context: CanvasRenderingContext2D | null;
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

const VERTEX_SOURCE = `#version 300 es
in vec2 corner;
uniform vec4 rect;    // x, y (bottom-left), width, height — canvas device px
uniform vec2 view;    // canvas size in device px
out vec2 uv;          // 0..1 across the pane
void main() {
  uv = corner * .5 + .5;
  vec2 pixel = rect.xy + uv * rect.zw;
  gl_Position = vec4(pixel / view * 2. - 1., 0., 1.);
}`;

const FRAGMENT_SOURCE = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;

uniform sampler2D frosted;   // the raster, blurred, at full resolution
uniform vec2 rasterSize;     // the raster's size in texels
uniform vec2 rasterOrigin;   // the raster's top-left corner, in the raster's own frame
uniform float rasterRatio;   // raster px per canvas px
uniform vec2 view;           // canvas size in device px
uniform vec4 rect;           // x, y (bottom-left), width, height — canvas device px
uniform float radius;        // padding-box corner radius, device px
uniform float band;          // band width, device px
uniform float pull;          // rim pull, device px
uniform float veil;          // veil alpha at this clarity
uniform vec3 tint;           // the colour that veil lays down, shade already folded in
uniform float saturation;    // the saturate() the pane's own backdrop-filter applies

const float MAX_BEND = ${MAX_BEND.toFixed(12)};

float roundedBoxDistance(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - (h - r);
  vec2 o = max(q, 0.);
  return length(o) + min(max(q.x, q.y), 0.) - r;
}
/** Squircle dome height across the bend: 0 where the outer face meets the rim, 1 where it levels. */
float dome(float t) { float k = 1. - t; return pow(max(0., 1. - k * k * k * k), .25); }
/** Refracted lateral shift per unit thickness: tan θ₂ for a ray arriving along the view axis. */
float surfaceBend(float t) {
  float r = dome(t) / (1. - t);
  float r6 = pow(r, 6.);
  float s1 = 1. / sqrt(1. + r6);
  float s2 = min(1., s1 / ${IOR.toFixed(2)});
  return s2 / sqrt(1. - s2 * s2);
}
/** The raster is the viewport at device resolution: one canvas pixel is one raster pixel. */
bool insideRaster(vec2 rasterPx) {
  return all(greaterThanEqual(rasterPx, vec2(0.))) && all(lessThan(rasterPx, rasterSize));
}
/** CSS saturate(): lerp between the pixel's luma and the pixel, the same matrix the filter uses. */
vec3 saturate(vec3 color, float amount) {
  return mix(vec3(dot(color, vec3(.213, .715, .072))), color, amount);
}

void main() {
  // Local space is the pane's own box with its origin at the bottom-left, y up.
  vec2 local = uv * rect.zw;
  // Not named half: that word is reserved in GLSL ES, and the compiler only says so at run time.
  vec2 halfSize = rect.zw * .5;
  float inside = -roundedBoxDistance(local - halfSize, halfSize, radius);
  // Only the rim band is drawn. Everything deeper is the pane's own backdrop-filter — live, and
  // sharper than anything this canvas could hold — so the surface stops exactly where the bend
  // does, and the two meet at a seam the optics cannot show: the displacement is zero there.
  if (inside < 0. || inside >= band) discard;

  float bend = surfaceBend(inside / band) / MAX_BEND;
  float dx = roundedBoxDistance(local - halfSize + vec2(.5, 0.), halfSize, radius)
           - roundedBoxDistance(local - halfSize - vec2(.5, 0.), halfSize, radius);
  float dy = roundedBoxDistance(local - halfSize + vec2(0., .5), halfSize, radius)
           - roundedBoxDistance(local - halfSize - vec2(0., .5), halfSize, radius);
  // The gradient of the distance field points out of the pane, so the ray is bent along its
  // negative: inward, through the bevel, exactly as the SVG map's normal points.
  vec2 inward = -normalize(vec2(dx, dy) + 1e-6);

  // Canvas device px, origin bottom-left, from the pane's own bottom-left.
  vec2 panePx = rect.xy + local;
  // The raster's index origin is top-left, so y flips here and nowhere else — including in the
  // displacement, which is computed in this bottom-up space: minus y is down the raster. The
  // raster itself is a band of the document, so its scroll is added here, read fresh every frame,
  // which is what lets the glass follow a scroll without being re-rasterised for it.
  // The raster is its own resolution (a CSS px per texel, however dense the screen), so both the
  // pixel's position and the bend it carries are converted into raster pixels here.
  vec2 shift = vec2(inward.x, -inward.y) * bend * pull;
  vec2 rasterPx = (vec2(panePx.x, view.y - panePx.y) + shift) * rasterRatio + rasterOrigin;
  rasterPx = clamp(rasterPx, vec2(0.), rasterSize - vec2(1.));
  // Both material terms the pane's own backdrop-filter adds, in its order: the blur is the
  // texture's, then the saturation, then the veil the pane lays over it.
  vec3 color = saturate(texture(frosted, rasterPx / rasterSize).rgb, saturation);
  // The pane's own tint, already darkened by whatever shade the ink sampler measured behind it,
  // so the band and the flat middle it meets are painted with the same colour.
  outColor = vec4(mix(color, tint, veil), 1.);
}`;

/* ── GL helpers ─────────────────────────────────────────────────────────────────────────── */

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

function link(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  if (!program) throw new Error("program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  return program;
}

const BLIT_VERTEX = `#version 300 es
in vec2 corner;
out vec2 uv;
void main() { uv = corner * .5 + .5; gl_Position = vec4(corner, 0., 1.); }`;

/** Separable Gaussian: 13 taps spaced by `spacing`, kernel sigma fixed at 3 — spread = 3·spacing. */
const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 outColor;
uniform sampler2D source;
uniform vec2 texel;      // 1 / target size
uniform vec2 direction;  // (1,0) or (0,1)
uniform float spacing;   // in texels
const float W[7] = float[7](0.214607, 0.205036, 0.177247, 0.138812, 0.098409, 0.062348, 0.035669);
void main() {
  vec3 sum = texture(source, uv).rgb * W[0];
  float total = W[0];
  for (int i = 1; i < 7; i++) {
    vec2 step = direction * texel * spacing * float(i);
    sum += (texture(source, uv + step).rgb + texture(source, uv - step).rgb) * W[i];
    total += W[i] * 2.;
  }
  outColor = vec4(sum / total, 1.);
}`;

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
function buildClone(root: HTMLElement, originY: number, bandHeight: number, skip: (element: Element) => boolean, muted: (element: Element) => boolean = () => false): Clone {
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
      // A pane that has another pane inside it is kept in the raster — a bubble nested in a pill
      // has nothing to bend otherwise, since the pill it sits on would be cut out of the scene —
      // but only its children are wanted: its own veil, border and shadow are dropped so the
      // nested glass reads what the host is showing rather than the host's own paint.
      if (muted(node)) style += "background:transparent!important;background-image:none!important;box-shadow:none!important;border-color:transparent!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;";
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

/** Converts one media element to a data URI; null when its pixels cannot be read. */
function mediaToDataUri(element: Element) {
  try {
    const width = element instanceof HTMLVideoElement ? element.videoWidth : element.clientWidth;
    const height = element instanceof HTMLVideoElement ? element.videoHeight : element.clientHeight;
    if (!width || !height) return null;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(element as CanvasImageSource, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

/* ── the renderer ──────────────────────────────────────────────────────────────────────── */

type Surface = {
  texture: WebGLTexture;
  scratch: WebGLTexture;
  framebuffer: WebGLFramebuffer;
  scratchFramebuffer: WebGLFramebuffer;
  width: number;
  height: number;
  /** The blurred copy of the raster, and the blur key that produced it. */
  frost: WebGLTexture | null;
  frostFramebuffer: WebGLFramebuffer | null;
  frostKey: string;
};

export function attachGlassWebgl(root: HTMLElement, initial: GlassParameters): GlassWebglHandle | null {
  if (!canUseWebglGlass()) return null;
  const viewport = document.createElement("canvas");
  viewport.setAttribute("aria-hidden", "true");
  const gl = viewport.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false, depth: false, stencil: false, powerPreference: "high-performance" });
  if (!gl) return null;

  let program: WebGLProgram;
  let blurProgram: WebGLProgram;
  try {
    program = link(gl, VERTEX_SOURCE, FRAGMENT_SOURCE);
    blurProgram = link(gl, BLIT_VERTEX, BLUR_FRAGMENT);
  } catch {
    return null;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);

  // A lost context cannot be drawn from: the panes go back to the CSS rim rather than sit blank.
  viewport.addEventListener("webglcontextlost", (event) => {
    event.preventDefault();
    fail();
  }, false);

  const panes = new Map<HTMLElement, Pane>();
  const sizes = new ResizeObserver(() => { measurePanes(); render(); });
  let parameters: GlassParameters = { ...initial };
  /** The per-family base band/pull the page last handed in; empty = everything follows the sliders. */
  let groups: GlassGroupValues = {};
  let surface: Surface | null = null;
  let rasterWidth = 0;
  let rasterHeight = 0;
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

  root.classList.add("glass-webgl");
  root.classList.remove("glass-rim-fallback");

  /* ── textures ── */

  function makeTexture(width: number, height: number) {
    const target = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, target);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, width, height, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return target;
  }

  function attachFramebuffer(target: WebGLTexture) {
    const buffer = gl!.createFramebuffer()!;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, buffer);
    gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, target, 0);
    return buffer;
  }

  function dropSurface() {
    if (!surface) return;
    gl!.deleteTexture(surface.texture);
    gl!.deleteTexture(surface.scratch);
    if (surface.frost) gl!.deleteTexture(surface.frost);
    gl!.deleteFramebuffer(surface.framebuffer);
    gl!.deleteFramebuffer(surface.scratchFramebuffer);
    if (surface.frostFramebuffer) gl!.deleteFramebuffer(surface.frostFramebuffer);
    surface = null;
  }

  function drawQuad(target: WebGLFramebuffer | null, width: number, height: number, source: WebGLProgram, setup: () => void) {
    // The blur passes fill whole textures: a scissor box left over from the last pane would
    // clip them, and the frost would be blank wherever that pane did not happen to be.
    gl!.disable(gl!.SCISSOR_TEST);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, target);
    gl!.viewport(0, 0, width, height);
    gl!.useProgram(source);
    gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
    const corner = gl!.getAttribLocation(source, "corner");
    gl!.enableVertexAttribArray(corner);
    gl!.vertexAttribPointer(corner, 2, gl!.FLOAT, false, 0, 0);
    setup();
    gl!.drawArrays(gl!.TRIANGLES, 0, 6);
  }

  function makeSurface(width: number, height: number): Surface {
    const texture = makeTexture(width, height);
    const scratch = makeTexture(width, height);
    return {
      texture,
      scratch,
      width,
      height,
      framebuffer: attachFramebuffer(texture),
      scratchFramebuffer: attachFramebuffer(scratch),
      frost: null,
      frostFramebuffer: null,
      frostKey: "",
    };
  }

  /**
   * Uploads the raster at full resolution. There is no mip pyramid behind it: the band magnifies
   * this texture where the bend is strongest, and a halved level turns that magnification into
   * visible blocks — the whole reason a rim looked like a smear of grey squares.
   */
  function buildSurface(raster: HTMLCanvasElement) {
    dropSurface();
    const next = makeSurface(raster.width, raster.height);
    gl!.bindTexture(gl!.TEXTURE_2D, next.texture);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, false);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, raster);
    surface = next;
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
  }

  /**
   * Blurs the raster into the frost texture — two separable passes, cached until the radius or the
   * raster changes, so every pane shares one blur per capture.
   */
  function frost(blurPx: number) {
    const target = surface;
    if (!target) return null;
    const key = blurPx.toFixed(2);
    if (target.frost && target.frostKey === key) return target.frost;
    const frosted = target.frost ?? makeTexture(target.width, target.height);
    const frostedFramebuffer = target.frostFramebuffer ?? attachFramebuffer(frosted);
    target.frost = frosted;
    target.frostFramebuffer = frostedFramebuffer;
    // CSS `blur(r)` is a Gaussian with standard deviation r/2, and it is one pass; this is two,
    // whose σ add in quadrature — so each carries r/(2√2) and the pair lands exactly on the CSS
    // kernel. The taps are 3σ wide, giving σ/3 = r/(6√2) of spacing, in the raster's own texels.
    const spacing = Math.max(0.35, blurPx / (6 * Math.SQRT2));
    const pass = (from: WebGLTexture, framebuffer: WebGLFramebuffer, direction: [number, number]) => {
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, from);
      drawQuad(framebuffer, target.width, target.height, blurProgram, () => {
        gl!.uniform1i(gl!.getUniformLocation(blurProgram, "source"), 0);
        gl!.uniform2f(gl!.getUniformLocation(blurProgram, "texel"), 1 / target.width, 1 / target.height);
        gl!.uniform2f(gl!.getUniformLocation(blurProgram, "direction"), direction[0], direction[1]);
        gl!.uniform1f(gl!.getUniformLocation(blurProgram, "spacing"), spacing);
      });
    };
    pass(target.texture, target.scratchFramebuffer, [1, 0]);
    pass(target.scratch, frostedFramebuffer, [0, 1]);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
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
      // A void element — an <input> — cannot host the surface canvas the WebGL path inserts, and
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
        context: canvas.getContext("2d"),
        boost: Math.max(1, Number(element.dataset.glassEdge) || 1),
        group: groupOf(style),
        bandCap: cap("--glass-band-cap"),
        pullCap: cap("--glass-pull-cap"),
        x: 0, y: 0, width: 0, height: 0,
        radius: Math.max(0, outer - border),
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

  function draw() {
    const raster = surface;
    if (destroyed || !raster) return;
    // A pane may have moved since the last frame (scroll, an entry animation); the surface is
    // sampled from the raster by viewport position, so it can never be drawn from a stale box.
    measurePanes();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(window.innerWidth * dpr));
    const height = Math.max(1, Math.round(window.innerHeight * dpr));
    if (viewport.width !== width || viewport.height !== height) {
      viewport.width = width;
      viewport.height = height;
    }
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, width, height);
    gl!.disable(gl!.SCISSOR_TEST);
    gl!.clearColor(0, 0, 0, 0);
    gl!.clear(gl!.COLOR_BUFFER_BIT);
    gl!.enable(gl!.BLEND);
    gl!.blendFunc(gl!.ONE, gl!.ONE_MINUS_SRC_ALPHA);

    /** The blur passes borrow the context; this is what has to be true to draw a pane again. */
    function bindPane() {
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
      gl!.viewport(0, 0, width, height);
      gl!.useProgram(program);
      gl!.bindBuffer(gl!.ARRAY_BUFFER, quad);
      const corner = gl!.getAttribLocation(program, "corner");
      gl!.enableVertexAttribArray(corner);
      gl!.vertexAttribPointer(corner, 2, gl!.FLOAT, false, 0, 0);
    }

    panes.forEach((pane) => {
      const canvas = pane.canvas;
      const context = pane.context;
      const clear = () => context?.clearRect(0, 0, canvas.width, canvas.height);
      if (!pane.width || !pane.height || pane.width < MIN_PANE || pane.height < MIN_PANE) { clear(); return; }
      if (pane.x + pane.width <= 0 || pane.y + pane.height <= 0 || pane.x >= window.innerWidth || pane.y >= window.innerHeight) { clear(); return; }
      // The surface is drawn at the canvas' own size: measurePanes rounded the pane's box once,
      // and the blit below has to land on those same pixels.
      const paneWidth = canvas.width;
      const paneHeight = canvas.height;
      const scale = pane.boost;
      const baseBand = (pane.group && groups[pane.group]?.band) ?? parameters.band;
      const band = Math.min(baseBand * scale * dpr, Math.min(paneWidth, paneHeight) * MAX_BAND_SHARE, pane.bandCap > 0 ? pane.bandCap * dpr : Infinity);
      if (band < MIN_BAND) { clear(); return; }
      const share = scale > 1 ? BOOSTED_PULL_SHARE : MAX_PULL_SHARE;
      const basePull = (pane.group && groups[pane.group]?.pull) ?? Math.max(0, parameters.offset);
      const pull = Math.min(basePull * scale * dpr, band * share, pane.pullCap > 0 ? pane.pullCap * dpr : Infinity);
      // The blur lives in the raster's texels, which are CSS px wide whatever the screen is.
      const frosted = frost(Math.max(0, parameters.blur) * rasterScale);

      // The pane's box in framebuffer pixels, and the part of it the viewport shows: a pane
      // hanging off an edge still has its off-screen rows cleared out of its own canvas.
      const originX = Math.round(pane.x * dpr);
      const originY = Math.round(pane.y * dpr);
      const left = Math.max(0, originX);
      const top = Math.max(0, originY);
      const right = Math.min(width, originX + paneWidth);
      const bottom = Math.min(height, originY + paneHeight);

      // frost() may have run blur passes, which leave their own program, viewport and
      // framebuffer behind — the pane's own state has to be taken back before touching uniforms.
      bindPane();
      // GL's origin is bottom-left; the pane's top edge in that space is height - originY.
      gl!.uniform4f(gl!.getUniformLocation(program, "rect"), originX, height - originY - paneHeight, paneWidth, paneHeight);
      gl!.uniform2f(gl!.getUniformLocation(program, "view"), width, height);
      gl!.uniform2f(gl!.getUniformLocation(program, "rasterSize"), rasterWidth, rasterHeight);
      gl!.uniform1f(gl!.getUniformLocation(program, "rasterRatio"), rasterScale / dpr);
      // Read from the live scroll, not from the capture: this is what makes a scroll cost a
      // redraw and nothing else.
      gl!.uniform2f(gl!.getUniformLocation(program, "rasterOrigin"),
        (window.scrollX - rasterLeft) * rasterScale,
        (window.scrollY - rasterTop) * rasterScale);
      // A radius past half the short side is clamped by the browser when it paints the box — a
      // 999px pill is a capsule, not a shape with no corners — and the distance field has to be
      // clamped the same way. Unclamped, the rounded box has no interior at all and every
      // fragment fails the band test: the pane draws nothing, which is exactly what a pill and
      // its bubble, both 999px, were doing. Both terms are device px: the field is built from
      // halfSize, which is the pane's box in device px.
      const halfShort = Math.min(paneWidth, paneHeight) / 2;
      gl!.uniform1f(gl!.getUniformLocation(program, "radius"), Math.min(pane.radius * dpr, halfShort));
      gl!.uniform1f(gl!.getUniformLocation(program, "band"), band);
      gl!.uniform1f(gl!.getUniformLocation(program, "pull"), pull);
      gl!.uniform1f(gl!.getUniformLocation(program, "veil"), pane.veil);
      // The ink sampler darkens a pane's tint as its backdrop darkens, and it does that on its
      // own 250ms clock — the handle never hears about it. Reading the property the sampler wrote
      // here, from the pane's inline style (no style flush, no getComputedStyle) is what keeps the
      // band in step with the interior CSS is painting this frame.
      const shade = Number(pane.element.style.getPropertyValue("--glass-shade")) || 0;
      const tint = pane.tint;
      const lit = 1 - Math.min(1, Math.max(0, shade)) * SHADE_MAX;
      gl!.uniform3f(gl!.getUniformLocation(program, "tint"), tint[0] * lit, tint[1] * lit, tint[2] * lit);
      gl!.uniform1f(gl!.getUniformLocation(program, "saturation"), pane.saturation);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, frosted);
      gl!.uniform1i(gl!.getUniformLocation(program, "frosted"), 0);
      if (right <= left || bottom <= top) { clear(); return; }
      // Scissored to the pane's own box, so two panes that overlap cannot bleed into each
      // other's canvas: each region is cleared and redrawn for the pane that owns it.
      gl!.enable(gl!.SCISSOR_TEST);
      gl!.scissor(left, height - bottom, right - left, bottom - top);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLES, 0, 6);
      if (context) {
        context.clearRect(0, 0, paneWidth, paneHeight);
        // Only the band is copied: the interior is transparent by design (the pane's own
        // backdrop-filter shows there), and on a tall pane that is most of the canvas — this runs
        // on every frame of a scroll, so the rectangles it moves matter.
        const thickness = Math.min(Math.round(band), paneHeight);
        const box = (x0: number, y0: number, x1: number, y1: number) => {
          const sx = Math.max(left, x0);
          const sy = Math.max(top, y0);
          const ex = Math.min(right, x1);
          const ey = Math.min(bottom, y1);
          if (ex <= sx || ey <= sy) return;
          context.drawImage(viewport, sx, sy, ex - sx, ey - sy, sx - originX, sy - originY, ex - sx, ey - sy);
        };
        box(originX, originY, originX + paneWidth, originY + thickness);
        box(originX, originY + paneHeight - thickness, originX + paneWidth, originY + paneHeight);
        box(originX, originY + thickness, originX + thickness, originY + paneHeight - thickness);
        box(originX + paneWidth - thickness, originY + thickness, originX + paneWidth, originY + paneHeight - thickness);
      }
    });
    gl!.disable(gl!.SCISSOR_TEST);
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
    // A pane with another pane inside it stays in the raster (its paint dropped, its contents
    // kept): that nesting is the whole reason a bubble in the pill can bend anything at all.
    const hosts = new Set<Element>();
    surfaces.forEach((element) => {
      if (element.querySelector("[data-glass-edge]")) hosts.add(element);
    });
    const clone = buildClone(root, bandTop - scrollY, bandHeight,
      (element) => (surfaces.has(element) && !hosts.has(element)) || (element instanceof HTMLCanvasElement && canvases.has(element)),
      (element) => hosts.has(element));
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
      try {
        const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
        image = await load(url);
        URL.revokeObjectURL(url);
      } catch {
        return null;
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
  function fail() {
    failures += 1;
    if (failures < MAX_FAILURES) return;
    root.classList.remove("glass-webgl");
    root.classList.add("glass-rim-fallback");
    destroy();
  }

  async function runCapture() {
    if (destroyed) return;
    if (capturing) { captureQueued = true; return; }
    capturing = true;
    try {
      const raster = await capture();
      if (destroyed) return;
      if (!raster) { fail(); return; }
      failures = 0;
      rasterWidth = raster.width;
      rasterHeight = raster.height;
      lastSignature = signature();
      lastCaptureAt = performance.now();
      captureScrollY = window.scrollY;
      buildSurface(raster);
      render();
    } catch {
      fail();
    } finally {
      capturing = false;
      if (captureQueued) {
        captureQueued = false;
        requestCapture();
      }
    }
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
    void runCapture();
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
    panes.forEach((pane) => pane.canvas.remove());
    panes.clear();
    dropSurface();
    viewport.remove();
    root.classList.remove("glass-webgl");
  }

  syncPanes();
  measurePanes();
  watch();
  void runCapture();

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
