/**
 * Where the studio's API lives.
 *
 * The client ships without a server of its own: every call goes out to the API server the user
 * pointed the app at. The address lives in the settings blob (`serverUrl`, see `SETTINGS_STORAGE_KEY`)
 * next to the other preferences, so the settings card and the API layer read the one source.
 *
 * The default differs by shell:
 *  - a browser page follows its own origin (an empty URL means "same origin", the classic
 *    same-server deployment, and every relative path stays untouched);
 *  - the desktop .app has no meaningful origin of its own — its pages load from the bundled
 *    `app://bundle` — so the shell's preload bridge supplies the fallback `http://localhost:3000`.
 *
 * The value is read synchronously on every call: it is one small JSON parse, and the settings
 * card reloads the page after a change, so caching would only add staleness.
 */
import { SETTINGS_STORAGE_KEY } from "@/shared/utilities/settings";

/** What the desktop shell's preload script exposes (see desktop/preload.js). */
declare global {
  interface Window {
    studio?: { isElectron?: boolean; defaultServerUrl?: string };
  }
}

/** The desktop app's default server: the local Docker deployment. */
const ELECTRON_DEFAULT = "http://localhost:3000";

/** A user-supplied address, trimmed and validated; "" when it cannot be used. */
function cleanUrl(value: string): string {
  const url = value.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : "";
}

/** Reads the configured server from the settings blob; "" when none is set (or the blob is bad). */
export function readServerUrl(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return "";
    const data = JSON.parse(raw) as Record<string, unknown>;
    return typeof data.serverUrl === "string" ? cleanUrl(data.serverUrl) : "";
  } catch {
    return "";
  }
}

/** Writes the server URL into the blob without touching the fields the other systems own. */
export function writeServerUrl(url: string) {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const data = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...data, serverUrl: url }));
  } catch {
    // A blob nothing can parse: replacing it with the one field is the only write that can succeed.
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ serverUrl: url }));
  }
}

/** The server origin every API call goes to; "" means the page's own origin. */
export function apiBase(): string {
  const configured = readServerUrl();
  if (configured) return configured;
  if (typeof window !== "undefined" && window.studio?.isElectron) {
    return cleanUrl(window.studio.defaultServerUrl || ELECTRON_DEFAULT);
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
