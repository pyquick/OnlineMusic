/**
 * The performance budget, checked against a real build: `next build && node scripts/budget.mjs`.
 *
 * The numbers are the ones docs/perf-baseline.md recorded, with a little headroom — a budget that
 * is already failing on the day it is written teaches nobody anything. It measures the *gzipped*
 * bytes the browser actually downloads for the studio route: the files the build manifest names
 * as that route's initial load, plus the stylesheet.
 *
 * The refactor's phases are what these guard: the first-load JavaScript (the surfaces moved out
 * of the page and onto dynamic imports) and the stylesheet (the tokens and the material rules).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const NEXT = path.join(process.cwd(), ".next");
const LIMITS = {
  initialJsGz: 135_000,   // measured 122.2 kB gz after P3.3
  // Measured 2026-10-01: 13.5 kB gz for the studio's own stylesheet (unchanged from the
  // now-playing baseline) plus ~1.9 kB gz for the lyrics feature's own file, which ships with
  // the now-playing/editor chunks and is only fetched when one of them is. The limit guards the
  // total, so it carries that feature's cost explicitly.
  // 2026-10-02: held at 18.0. The settings preview's mock scene briefly pushed the total to
  // 18.1 and the ceiling to 18.25; the scene then became a photograph (one rule), which put the
  // total back at 17.9 — so the 18.0 ceiling stands rather than keeping the raise.
  cssGz: 18_000,
  largestChunkGz: 58_000, // the shared vendor chunk, measured 53.7 kB gz
};

function gz(file) {
  return gzipSync(readFileSync(file)).length;
}
function nextStatic(urlPath) {
  // the manifest holds paths relative to .next/static, some with a leading .next/
  return path.join(NEXT, "static", urlPath.replace(/^\.next\/static\//, "").replace(/^static\//, ""));
}

if (existsSync(path.join(NEXT, "static", "development"))) {
  console.error("this is a development build (the dev server owns .next) — run `next build` first");
  process.exit(1);
}

let manifest;
try {
  manifest = JSON.parse(readFileSync(path.join(NEXT, "app-build-manifest.json"), "utf8"));
} catch {
  console.error("no build found — run `next build` first");
  process.exit(1);
}

// The app router keys this by route file, not by URL: what `/` loads is its own page plus the
// root layout, and a chunk reached by both is counted once.
const files = [...new Set([...(manifest.pages["/page"] ?? []), ...(manifest.pages["/layout"] ?? [])])];
if (files.length === 0) {
  console.error("the manifest lists no initial files for / — has the build finished?");
  process.exit(1);
}

let initialJsGz = 0;
let largest = { file: "", bytes: 0 };
for (const url of files) {
  if (!url.endsWith(".js")) continue;
  const bytes = gz(nextStatic(url));
  initialJsGz += bytes;
  if (bytes > largest.bytes) largest = { file: url, bytes };
}

const cssDir = path.join(NEXT, "static", "css");
let cssGz = 0;
for (const name of readdirSync(cssDir)) cssGz += gz(path.join(cssDir, name));

const rows = [
  ["initial JS (gz)", initialJsGz, LIMITS.initialJsGz],
  ["stylesheet (gz)", cssGz, LIMITS.cssGz],
  ["largest chunk (gz) — " + path.basename(largest.file), largest.bytes, LIMITS.largestChunkGz],
];

let failed = false;
for (const [label, value, limit] of rows) {
  const ok = value <= limit;
  if (!ok) failed = true;
  const pct = ((value / limit) * 100).toFixed(0);
  console.log(`${ok ? "ok  " : "OVER"} ${label.padEnd(46)} ${(value / 1000).toFixed(1)} kB / ${(limit / 1000).toFixed(1)} kB  (${pct}%)`);
}
console.log(`     ${files.length} initial-load files`);
process.exit(failed ? 1 : 0);
