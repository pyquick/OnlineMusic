/**
 * The dependency rules the refactor is meant to keep, checked rather than trusted.
 *
 * Run with `node scripts/architecture.mjs`. No dependencies: this reads the source with regexes
 * over import specifiers, which is enough for rules that are about *which folder may name which*,
 * and it fails loudly with the offending file and line.
 *
 * The rules, and why:
 *   1. Nothing but the app may import the app — features are composed by the page, not aware of it.
 *   2. shared/, design-system/ and infrastructure/ may not import a feature: a feature uses them,
 *      never the other way round.
 *   3. The server's data layer (lib/) may not import React — it runs on the server.
 *   4. Features may only reach each other through their index (`@/features/name`), so the files
 *      inside a feature stay its own business.
 *   5. No cycles anywhere in the project's own modules.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC = ["app", "features", "shared", "design-system", "infrastructure", "lib"];
const IMPORT = /(?:^|\n)\s*(?:import|export)[^;]*?from\s+["']([^"']+)["']/g;

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const files = SRC.flatMap((dir) => {
  try { return walk(path.join(ROOT, dir)); } catch { return []; }
});
const relative = (file) => path.relative(ROOT, file);

/** Every import specifier in a file, as { specifier, line }. */
function importsOf(file) {
  const source = readFileSync(file, "utf8");
  const out = [];
  for (const match of source.matchAll(IMPORT)) {
    const line = source.slice(0, match.index).split("\n").length;
    out.push({ specifier: match[1], line });
  }
  return out;
}

/** The project path an import points at, or null when it is a package. */
function resolveSpecifier(file, specifier) {
  if (specifier.startsWith("@/")) return specifier.slice(2);
  if (specifier.startsWith(".")) return path.relative(ROOT, path.resolve(path.dirname(file), specifier));
  return null;
}

const failures = [];
const graph = new Map();

for (const file of files) {
  const from = relative(file);
  const edges = [];
  for (const { specifier, line } of importsOf(file)) {
    const target = resolveSpecifier(file, specifier);
    if (!target) continue;
    edges.push(target);
    const where = `${from}:${line}`;

    if (!from.startsWith("app/") && target.startsWith("app/")) {
      failures.push(`1. ${where} imports the app (${specifier}) — only app/ may do that`);
    }
    if (/^(shared|design-system|infrastructure)\//.test(from) && target.startsWith("features/")) {
      failures.push(`2. ${where} imports a feature (${specifier}) — that direction is backwards`);
    }
    if (from.startsWith("lib/") && /^(react|react-dom|next\/)/.test(specifier)) {
      failures.push(`3. ${where} imports ${specifier} — lib/ is server-side`);
    }
    const fromFeature = from.match(/^features\/([^/]+)\//);
    const toFeature = target.match(/^features\/([^/]+)\//);
    if (fromFeature && toFeature && fromFeature[1] !== toFeature[1]) {
      const rest = target.slice(`features/${toFeature[1]}`.length);
      if (rest !== "" && rest !== "/index") {
        failures.push(`4. ${where} reaches into ${specifier} — cross-feature imports go through the feature's index`);
      }
    }
  }
  graph.set(from, edges);
}

// 5. cycles: a file-level graph, built by resolving each specifier the way the bundler would
// (exact, +.ts, +.tsx, /index.ts, /index.tsx) and walked depth-first.
function resolveToFile(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(ROOT, specifier.slice(2))
    : path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, base + ".ts", base + ".tsx", path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
    try { if (statSync(candidate).isFile()) return candidate; } catch { /* not this one */ }
  }
  return null;
}

const fileGraph = new Map();
for (const file of files) {
  const edges = [];
  for (const { specifier } of importsOf(file)) {
    if (!specifier.startsWith(".") && !specifier.startsWith("@/")) continue;
    const target = resolveToFile(file, specifier);
    if (target) edges.push(target);
  }
  fileGraph.set(file, edges);
}

const done = new Set();
const onPath = new Set();
const path_ = [];
function walkForCycles(file) {
  if (done.has(file)) return null;
  if (onPath.has(file)) return [...path_.slice(path_.indexOf(file)), file].map(relative).join(" -> ");
  onPath.add(file); path_.push(file);
  for (const next of fileGraph.get(file) ?? []) {
    const cycle = walkForCycles(next);
    if (cycle) return cycle;
  }
  onPath.delete(file); path_.pop(); done.add(file);
  return null;
}
for (const file of fileGraph.keys()) {
  const cycle = walkForCycles(file);
  if (cycle) { failures.push(`5. import cycle: ${cycle}`); break; }
}

if (failures.length) {
  console.error("architecture check failed:\n" + failures.map((f) => "  " + f).join("\n"));
  process.exit(1);
}
console.log(`architecture ok — ${files.length} files, ${[...graph.values()].flat().length} internal imports, no rule broken`);
