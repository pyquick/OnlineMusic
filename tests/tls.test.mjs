/**
 * The desktop shell's TLS policy: an https build accepts exactly its own host's certificate and
 * leaves the rest to Chromium, an http build installs nothing. Electron is not involved — the
 * policy is a plain function over the session object it is handed.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pinnedHttpsHost, installCertificatePolicy } = require("../desktop/tls.js");

/** A stand-in for an Electron session: records the proc it is given, and asks it on demand. */
function fakeSession() {
  const target = { setCertificateVerifyProc: (proc) => { target.proc = proc; } };
  return {
    target,
    decide: (hostname, verificationResult) => new Promise((resolve) => {
      if (!target.proc) throw new Error("no policy was installed");
      target.proc({ hostname, verificationResult }, resolve);
    }),
  };
}

describe("the desktop TLS policy", () => {
  test("only an https address pins a host", () => {
    assert.equal(pinnedHttpsHost("https://192.168.1.156:3000"), "192.168.1.156");
    assert.equal(pinnedHttpsHost("https://music.lan"), "music.lan");
    assert.equal(pinnedHttpsHost("http://192.168.1.156:3000"), null);
    assert.equal(pinnedHttpsHost("not a url"), null);
  });

  test("an http build leaves the session alone", () => {
    const session = fakeSession();
    assert.equal(installCertificatePolicy(session.target, "http://192.168.1.156:3000"), false);
    assert.equal(session.target.proc, undefined);
  });

  test("the pinned host is accepted; every other host goes back to chromium", async () => {
    const session = fakeSession();
    assert.equal(installCertificatePolicy(session.target, "https://music.lan:3000"), true);
    assert.equal(await session.decide("music.lan", "CERT_AUTHORITY_INVALID"), 0);
    assert.equal(await session.decide("music.lan", "CERT_REVOKED"), -3);
    assert.equal(await session.decide("elsewhere.example", "CERT_AUTHORITY_INVALID"), -3);
  });
});
