/**
 * The cross-origin contract the client is served under.
 *
 * The studio ships as a client that fetches its API: same-origin when the server also hosts the
 * page (the classic Docker deployment), or cross-origin when the page lives elsewhere — the
 * desktop .app (its pages load from `app://bundle`) or a separately hosted static export. The
 * rules below are what lets a browser (or the app's engine) accept the responses and carry the
 * session cookie across that boundary:
 *
 *  - CORS with credentials is answered only for a request whose Origin is the server's own or is
 *    named in `ALLOWED_ORIGINS` (comma-separated). The origin is echoed exactly — `*` and
 *    credentials cannot mix — and nothing else on the response is touched, so Range, ETag and
 *    streaming headers pass through untouched.
 *  - An unsafe method carrying a foreign Origin is refused outright: the CSRF guard. Same-origin
 *    form posts and requests without an Origin (curl, plain media tags) are left to the route's
 *    own auth, exactly as before.
 *  - The session cookie is SameSite=Lax for same-origin, and becomes `SameSite=None; Secure` the
 *    moment the request is cross-origin or behind https — so a browser will both store it and
 *    send it back. The logout cookie uses the same policy, or it could not overwrite its twin.
 *
 * This file is pure web-standard code — no Node, no React — so the API routes and the unit tests
 * share it unchanged.
 */

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const PREFLIGHT_HEADERS: Record<string, string> = {
  // Content-Type is the only header the client ever sets by hand (JSON bodies); the boundary of
  // a multipart upload belongs to the browser and needs no allowance.
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

/** The origins the operator has accepted, from `ALLOWED_ORIGINS` (comma-separated, any scheme). */
export function allowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS?.trim() || "";
  if (!raw) return [];
  return raw.split(",").map((entry) => entry.trim()).filter(Boolean);
}

/**
 * The request's Origin, normalised; null when it carries none (or the opaque "null" origin).
 * http(s) origins are URL-normalised (no trailing slash); anything else — the desktop app's
 * `app://bundle` is an opaque origin to the URL parser — is kept verbatim, since that exact
 * string is what the allowlist names.
 */
export function originOf(request: Request): string | null {
  const header = request.headers.get("origin");
  if (!header || header === "null") return null;
  const trimmed = header.trim();
  try {
    const url = new URL(trimmed);
    return url.protocol === "http:" || url.protocol === "https:" ? url.origin : trimmed;
  } catch {
    return null;
  }
}

/**
 * Whether an origin is the server's own, scheme and all — a browser treats a scheme change as
 * cross-origin too. The Host header and the forwarded proto are the authority: behind a TLS
 * proxy `request.url` is the internal http address while Host still names what the browser
 * asked for.
 */
export function isSameOrigin(request: Request, origin: string): boolean {
  const host = request.headers.get("host") || new URL(request.url).host;
  const scheme = request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "");
  try {
    const parsed = new URL(origin);
    return parsed.host === host && parsed.protocol === `${scheme}:`;
  } catch {
    return false;
  }
}

/** True when the request's Origin is one the server answers CORS for. */
export function isAllowedOrigin(request: Request): boolean {
  const origin = originOf(request);
  if (!origin) return true; // not a CORS request at all
  if (isSameOrigin(request, origin)) return true;
  return allowedOrigins().includes(origin);
}

/**
 * Adds the CORS approval to a response, only when the request deserves it. It appends rather
 * than rebuilds: every header the route set — ETag, Content-Range, Content-Disposition, the
 * streaming type — stays exactly as it was.
 */
export function applyCors(request: Request, response: Response): Response {
  const origin = originOf(request);
  if (!origin || !isAllowedOrigin(request)) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.append("Vary", "Origin");
  return response;
}

/** The preflight answer: 204 with the CORS approval and the methods/headers allowance. */
export function optionsResponse(request: Request): Response {
  const response = new Response(null, { status: 204 });
  applyCors(request, response);
  if (response.headers.has("Access-Control-Allow-Origin")) {
    for (const [name, value] of Object.entries(PREFLIGHT_HEADERS)) response.headers.set(name, value);
  }
  return response;
}

/** The CSRF guard: an unsafe method carrying a foreign Origin is refused by the route. */
export function denyCrossSite(request: Request): boolean {
  if (!UNSAFE_METHODS.has(request.method)) return false;
  const origin = originOf(request);
  return !!origin && !isAllowedOrigin(request);
}

/**
 * The session cookie, with the SameSite policy the request calls for: Lax on its own origin,
 * `SameSite=None; Secure` across origins or behind https. The Secure flag is what browsers
 * require of a None cookie — and `http://localhost` still accepts Secure cookies, being a
 * trustworthy origin. `maxAgeSeconds` undefined omits Max-Age (a session cookie); 0 deletes.
 */
export function sessionCookie(request: Request, token: string, maxAgeSeconds?: number): string {
  const origin = originOf(request);
  const crossOrigin = !!origin && !isSameOrigin(request, origin);
  const https = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  const attributes = [`session=${token}`, "Path=/", "HttpOnly", `SameSite=${crossOrigin ? "None" : "Lax"}`];
  if (crossOrigin || https) attributes.push("Secure");
  if (maxAgeSeconds !== undefined) attributes.push(`Max-Age=${maxAgeSeconds}`);
  return attributes.join("; ");
}
