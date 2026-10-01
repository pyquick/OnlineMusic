/**
 * The studio's one way out to its own API.
 *
 * Every call the app makes — the session check, the asset index, an upload, a metadata save,
 * signing in and out — goes through here, so the things that must never be forgotten are decided
 * once instead of at each site: the session cookie rides along, a hung request gives up rather
 * than hanging the UI with it, a failed response becomes a typed error carrying the server's own
 * message, and a caller's own `AbortSignal` still wins.
 *
 * The asset index is the one deliberate exception (`apiStream` below): it is a streaming NDJSON
 * response the caller reads line by line, so it is handed back raw.
 */

/** How long a request may sit before it is abandoned. Long enough for a 250 MB upload to land. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** A failed call: `status` is the HTTP code, or 0 when the request never reached the server. */
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
  /** True when the server never answered — offline, refused, timed out. */
  get isNetwork() {
    return this.status === 0;
  }
}

type Options = {
  /** The caller's own cancellation, composed with the timeout. */
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Parsed and expected to fail quietly: 404 answers as null rather than throwing. */
  allow404?: boolean;
};

async function request<T>(method: string, path: string, body: unknown, options: Options): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort);

  let response: Response;
  try {
    const init: RequestInit = { method, credentials: "include", cache: "no-store", signal: controller.signal };
    if (body instanceof FormData) {
      // Never set a content-type by hand here: the boundary belongs to the browser.
      init.body = body;
    } else if (body !== undefined) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(body);
    }
    response = await fetch(path, init);
  } catch (error) {
    const aborted = controller.signal.aborted && !options.signal?.aborted;
    throw new ApiError(aborted ? "The request timed out." : "Could not reach the server.", 0);
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }

  if (options.allow404 && response.status === 404) return null as T;
  if (!response.ok) {
    // The API answers failures as {error}; fall back to the status line when it does not.
    const message = await response.json().then((payload: { error?: string }) => payload?.error).catch(() => undefined);
    throw new ApiError(message || `Request failed (${response.status})`, response.status);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  get: <T>(path: string, options: Options = {}) => request<T>("GET", path, undefined, options),
  post: <T>(path: string, body?: unknown, options: Options = {}) => request<T>("POST", path, body, options),
  put: <T>(path: string, body?: unknown, options: Options = {}) => request<T>("PUT", path, body, options),
  patch: <T>(path: string, body?: unknown, options: Options = {}) => request<T>("PATCH", path, body, options),
  delete: <T>(path: string, options: Options = {}) => request<T>("DELETE", path, undefined, options),
};

/**
 * A streaming endpoint, handed back raw: the asset index arrives as newline-delimited JSON and the
 * caller renders each line as it lands, which is the whole reason it is streamed. Errors are still
 * normalised, so a 401 fails the same way everywhere.
 */
export async function apiStream(path: string, options: Options = {}): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort);
  try {
    const response = await fetch(path, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new ApiError(`Request failed (${response.status})`, response.status);
    return response;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("Could not reach the server.", 0);
  } finally {
    window.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
