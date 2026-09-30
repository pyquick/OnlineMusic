/**
 * A resolver hook, so the tests can import the app's modules as the app itself does.
 *
 * The bundler resolves `./assets` against `assets.ts`; Node's ESM resolver does not, and the
 * source should not grow file extensions just to be testable. This adds the one rule Node is
 * missing — an extensionless relative import tries .ts, .tsx, .mjs, .js in turn — and nothing
 * else. Node strips the types itself.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export async function resolve(specifier, context, next) {
  if (specifier.startsWith(".") && !path.extname(specifier)) {
    const base = new URL(specifier, context.parentURL);
    for (const extension of [".ts", ".tsx", ".mjs", ".js"]) {
      const candidate = new URL(base.href + extension);
      if (existsSync(fileURLToPath(candidate))) return { url: candidate.href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}
