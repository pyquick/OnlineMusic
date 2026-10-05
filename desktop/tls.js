/**
 * The TLS policy for the packaged server.
 *
 * A LAN server is usually behind Caddy's `tls internal` — a self-signed certificate Chromium
 * refuses (ERR_CERT_AUTHORITY_INVALID), which would leave the app unable to reach the very
 * server it was built for. The shell therefore accepts the certificate of that one host without
 * a trusted chain, and hands every other host back to Chromium's own verification: the
 * exemption is pinned to the address baked in at packaging time, so it can never widen into a
 * general "ignore TLS errors" switch. A revoked certificate is refused even for that host.
 *
 * An http server needs no policy at all — `pinnedHttpsHost` answers null and nothing is
 * installed, leaving plain-http builds exactly as they were.
 *
 * `scripts/package-mac.mjs --server=<url>` rewrites the literal below in the copy of this file
 * that ships inside the bundle; the value here is the repo default, the local Docker deployment.
 */
const DEFAULT_SERVER_URL = "http://localhost:3000";

/** The host the exemption covers: the build's own server, when it is https; null otherwise. */
function pinnedHttpsHost(raw = DEFAULT_SERVER_URL) {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname ? url.hostname : null;
  } catch {
    return null;
  }
}

/**
 * Installs the policy on a session — the app's default one. Answers whether anything was
 * installed: an http build leaves the session untouched. `raw` is a parameter so the tests can
 * exercise both kinds of build; the packaged app always uses the baked address.
 */
function installCertificatePolicy(target, raw = DEFAULT_SERVER_URL) {
  const host = pinnedHttpsHost(raw);
  if (!host) return false;
  target.setCertificateVerifyProc((request, callback) => {
    // 0 accepts this request; -3 is "use Chromium's own answer" for everything else.
    const ours = request.hostname === host && !String(request.verificationResult).includes("REVOKED");
    callback(ours ? 0 : -3);
  });
  return true;
}

module.exports = { DEFAULT_SERVER_URL, pinnedHttpsHost, installCertificatePolicy };
