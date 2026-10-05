/**
 * Where the studio's API lives.
 *
 * The client ships without a server of its own and carries no card to point it somewhere: every
 * call goes out to the server its build was pointed at.
 *
 *  - a browser page follows its own origin ("" means "same origin", the classic same-server
 *    deployment, and every relative path stays untouched);
 *  - the desktop .app has no meaningful origin of its own — its pages load from the bundled
 *    `app://bundle` — so it follows the address the shell baked in at packaging time
 *    (`scripts/package-mac.mjs --server=<url>` lands in preload.js). A `serverUrl` an older
 *    build may have left in the settings blob is ignored, as is anything else: the address is
 *    the build's to name, and nothing in the page can change it.
 *
 * The value is read synchronously on every call: it is at most one small property read, so
 * caching would only add staleness.
 */
/** What the desktop shell's preload script exposes (see desktop/preload.js). */
declare global {
  interface Window {
    studio?: { isElectron?: boolean; defaultServerUrl?: string };
  }
}

/** The desktop app's fallback server (running the shell from the repo): the local Docker deployment. */
const ELECTRON_DEFAULT = "http://localhost:3000";

/** An address, trimmed and validated; "" when it cannot be used. */
function cleanUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : "";
}

/** The server origin every API call goes to; "" means the page's own origin. */
export function apiBase(): string {
  if (typeof window !== "undefined" && window.studio?.isElectron) {
    return cleanUrl(window.studio.defaultServerUrl || "") || ELECTRON_DEFAULT;
  }
  return "";
}

/**
 * Prefixes the studio's own API paths with the configured server. Only `/api/` paths are touched:
 * blob URLs, data URIs and external media pass through untouched.
 */
export function resolveApiUrl(path: string): string {
  const base = apiBase();
  if (!base || !path.startsWith("/api/")) return path;
  return base + path;
}
