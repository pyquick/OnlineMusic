/**
 * A resolver hook, so the tests can import the app's modules as the app itself does.
 *
 * The bundler resolves `./assets` against `assets.ts` and `@/lib/glassEdge` against the repo
 * root; Node's ESM resolver does neither, and the source should not grow file extensions or
 * relative paths just to be testable. This adds the rules Node is missing — an extensionless
 * import tries .ts, .tsx, .mjs, .js and then a directory's index in turn, for relative and `@/`
 * specifiers alike. Node strips the types itself.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = new URL("../", import.meta.url);

function resolveFile(base) {
  for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
    const candidate = new URL(base.href + extension);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
    const candidate = new URL(base.href + "/index" + extension);
    if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
  }
  return null;
}

export async function resolve(specifier, context, next) {
  if (!path.extname(specifier)) {
    const base = specifier.startsWith("@/")
      ? new URL(specifier.slice(2), ROOT)
      : specifier.startsWith(".")
        ? new URL(specifier, context.parentURL)
        : null;
    if (base) {
      const hit = resolveFile(base);
      if (hit) return hit;
    }
  }
  return next(specifier, context);
}
