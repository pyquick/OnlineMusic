/**
 * The cross-origin contract's pure logic: which origins the server answers CORS for, when an
 * unsafe request is refused, and the session cookie's SameSite policy per request shape.
 */
import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { allowedOrigins, applyCors, denyCrossSite, isAllowedOrigin, optionsResponse, sessionCookie } from "../lib/cors.ts";

const SERVER = "http://localhost:3000";

/** A request shaped the way the routes see them: the Host header is the browser's authority. */
function makeRequest(method, { origin, host = "localhost:3000", proto } = {}) {
  const headers = { host };
  if (origin !== undefined) headers.origin = origin;
  if (proto !== undefined) headers["x-forwarded-proto"] = proto;
  return new Request(`${SERVER}/api/anything`, { method, headers });
}

beforeEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

describe("allowedOrigins", () => {
  test("unset or empty means no extra origins", () => {
    assert.deepEqual(allowedOrigins(), []);
    process.env.ALLOWED_ORIGINS = "  ,  ";
    assert.deepEqual(allowedOrigins(), []);
  });

  test("a list is split and trimmed, and any scheme survives", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:8080, app://bundle, https://music.example";
    assert.deepEqual(allowedOrigins(), ["http://localhost:8080", "app://bundle", "https://music.example"]);
  });
});

describe("isAllowedOrigin", () => {
  test("a request without an Origin is not a CORS request and passes", () => {
    assert.equal(isAllowedOrigin(makeRequest("GET")), true);
  });

  test("the server's own origin passes with no allowlist", () => {
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "http://localhost:3000" })), true);
    // The same origin over https, seen through the forwarded proto, is still the server's own.
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "https://localhost:3000", proto: "https" })), true);
    // A scheme change without the forwarded proto is a different origin to a browser.
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "https://localhost:3000" })), false);
  });

  test("a foreign origin passes only when allowlisted", () => {
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "http://localhost:8080" })), false);
    process.env.ALLOWED_ORIGINS = "http://localhost:8080";
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "http://localhost:8080" })), true);
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "http://localhost:9090" })), false);
  });

  test("the desktop app's origin is a first-class citizen", () => {
    process.env.ALLOWED_ORIGINS = "app://bundle";
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "app://bundle" })), true);
  });

  test("the opaque null origin is never answered CORS for", () => {
    assert.equal(isAllowedOrigin(makeRequest("GET", { origin: "null" })), true); // no usable origin → not a CORS request
    const response = applyCors(makeRequest("GET", { origin: "null" }), new Response("ok"));
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  });
});

describe("applyCors", () => {
  test("an allowed origin gets the exact echo, credentials and Vary — and nothing else moves", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:8080";
    const response = new Response("bytes", { status: 206, headers: { "Content-Range": "bytes 0-9/20", ETag: '"abc"' } });
    const applied = applyCors(makeRequest("GET", { origin: "http://localhost:8080" }), response);
    assert.equal(applied.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");
    assert.equal(applied.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.equal(applied.headers.get("Vary"), "Origin");
    assert.equal(applied.headers.get("Content-Range"), "bytes 0-9/20");
    assert.equal(applied.headers.get("ETag"), '"abc"');
    assert.equal(applied.status, 206);
  });

  test("a foreign, unlisted origin gets no CORS headers at all", () => {
    const response = applyCors(makeRequest("GET", { origin: "http://evil.example" }), new Response("ok"));
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
  });
});

describe("optionsResponse", () => {
  test("a preflight from an allowed origin is answered in full", () => {
    process.env.ALLOWED_ORIGINS = "http://localhost:8080";
    const response = optionsResponse(makeRequest("OPTIONS", { origin: "http://localhost:8080" }));
    assert.equal(response.status, 204);
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "http://localhost:8080");
    assert.equal(response.headers.get("Access-Control-Allow-Credentials"), "true");
    assert.ok(response.headers.get("Access-Control-Allow-Methods").includes("POST"));
    assert.ok(response.headers.get("Access-Control-Allow-Headers").includes("Content-Type"));
  });

  test("a preflight from nowhere is refused with no allowance", () => {
    const response = optionsResponse(makeRequest("OPTIONS", { origin: "http://evil.example" }));
    assert.equal(response.headers.has("Access-Control-Allow-Origin"), false);
    assert.equal(response.headers.has("Access-Control-Allow-Methods"), false);
  });
});

describe("denyCrossSite", () => {
  test("safe methods never trip the guard", () => {
    assert.equal(denyCrossSite(makeRequest("GET", { origin: "http://evil.example" })), false);
    assert.equal(denyCrossSite(makeRequest("HEAD", { origin: "http://evil.example" })), false);
  });

  test("an unsafe method from a foreign origin is refused", () => {
    assert.equal(denyCrossSite(makeRequest("POST", { origin: "http://evil.example" })), true);
    assert.equal(denyCrossSite(makeRequest("PATCH", { origin: "http://evil.example" })), true);
    assert.equal(denyCrossSite(makeRequest("DELETE", { origin: "http://evil.example" })), true);
  });

  test("same-origin, allowlisted and origin-less unsafe requests pass", () => {
    assert.equal(denyCrossSite(makeRequest("POST", { origin: "http://localhost:3000" })), false);
    assert.equal(denyCrossSite(makeRequest("POST")), false);
    process.env.ALLOWED_ORIGINS = "app://bundle";
    assert.equal(denyCrossSite(makeRequest("POST", { origin: "app://bundle" })), false);
  });
});

describe("sessionCookie", () => {
  test("same-origin over plain http keeps today's Lax, Secure-less cookie", () => {
    const cookie = sessionCookie(makeRequest("GET", { origin: "http://localhost:3000" }), "token", 31536000);
    assert.ok(cookie.startsWith("session=token; "));
    assert.ok(cookie.includes("SameSite=Lax"));
    assert.ok(!cookie.includes("Secure"));
    assert.ok(cookie.includes("Max-Age=31536000"));
  });

  test("cross-origin becomes None; Secure, which is what a browser needs to send it back", () => {
    const cookie = sessionCookie(makeRequest("GET", { origin: "app://bundle" }), "token");
    assert.ok(cookie.includes("SameSite=None"));
    assert.ok(cookie.includes("Secure"));
  });

  test("https requests are Secure even on their own origin", () => {
    const httpsRequest = new Request("https://localhost:3000/api/auth", { headers: { host: "localhost:3000", origin: "https://localhost:3000" } });
    const cookie = sessionCookie(httpsRequest, "token");
    assert.ok(cookie.includes("SameSite=Lax"));
    assert.ok(cookie.includes("Secure"));
  });

  test("behind a TLS proxy, the forwarded proto counts as https", () => {
    const cookie = sessionCookie(makeRequest("GET", { proto: "https" }), "token");
    assert.ok(cookie.includes("Secure"));
  });

  test("the clearing cookie keeps the policy and a zero Max-Age", () => {
    const cookie = sessionCookie(makeRequest("DELETE", { origin: "app://bundle" }), "", 0);
    assert.ok(cookie.startsWith("session=; "));
    assert.ok(cookie.includes("SameSite=None"));
    assert.ok(cookie.includes("Secure"));
    assert.ok(cookie.includes("Max-Age=0"));
  });
});
