/**
 * The container's front door: HTTP and HTTPS on the same $PORT, the standalone Next server
 * behind it.
 *
 * The standalone server speaks plain http and Next's production CLI has no TLS switch, so the
 * deployment terminates TLS here instead of in a second container: this process spawns
 * `node server.js` on a loopback port, waits until it answers, then fronts it on the published
 * port — the compose mapping stays 3000:3000. The front door reads the first byte of every
 * connection to tell the two protocols apart (0x16 starts a TLS ClientHello, anything else is a
 * plain request), so one port answers `https://host:3000` and `http://host:3000` alike —
 * an old client that still says http keeps working, and neither protocol needs a second port.
 * Each request is labelled with the protocol it arrived on (`x-forwarded-proto`), which
 * lib/cors.ts reads to decide the session cookie's Secure flag and its same-origin check.
 *
 * The certificate comes from TLS_CERT_FILE/TLS_KEY_FILE when they are provided; otherwise a
 * self-signed pair is generated once into the data volume, covering TLS_HOSTS (comma-separated,
 * default `localhost,127.0.0.1`). A browser warns about that certificate once; the desktop .app
 * accepts it for the host it was packaged against (see desktop/tls.js). TLS_DISABLE=1 keeps the
 * old plain-http-only behaviour for anyone who wants it.
 */
import { execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { connect, createServer as createNetServer } from "node:net";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import path from "node:path";

const PORT = Number(process.env.PORT || 3000);
const BACKEND_PORT = Number(process.env.TLS_BACKEND_PORT || 3001);
const SERVER = path.join(process.cwd(), "server.js");
const DISABLED = /^(1|true|yes)$/i.test(process.env.TLS_DISABLE || "");
/** The first byte of a TLS ClientHello: the records of both TLS 1.2 and 1.3 start with it. */
const TLS_HANDSHAKE = 0x16;

const dataDir = process.env.AUTH_DATA_DIR || "/app/data";
const certFile = process.env.TLS_CERT_FILE || path.join(dataDir, "certs", "cert.pem");
const keyFile = process.env.TLS_KEY_FILE || path.join(dataDir, "certs", "key.pem");

if (DISABLED) {
  console.log("TLS_DISABLE is set — serving plain http");
  const plain = spawn(process.execPath, [SERVER], { env: process.env, stdio: "inherit" });
  plain.on("exit", (code) => process.exit(code ?? 1));
} else {
  ensureCertificate();
  serveBoth();
}

/** Generates the self-signed pair once; a mounted pair is used as-is. */
function ensureCertificate() {
  if (existsSync(certFile) && existsSync(keyFile)) return;
  const hosts = (process.env.TLS_HOSTS || "localhost,127.0.0.1")
    .split(",").map((host) => host.trim()).filter(Boolean);
  const altNames = hosts
    .map((host) => `${/^[\d.]+$/.test(host) || host.includes(":") ? "IP" : "DNS"}:${host}`)
    .join(",");
  mkdirSync(path.dirname(certFile), { recursive: true });
  mkdirSync(path.dirname(keyFile), { recursive: true });
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-days", "3650",
      "-keyout", keyFile, "-out", certFile,
      "-subj", `/CN=${hosts[0]}`, "-addext", `subjectAltName=${altNames}`,
    ], { stdio: "ignore" });
    chmodSync(keyFile, 0o600);
    console.log(`generated a self-signed certificate for ${hosts.join(", ")} (${certFile})`);
  } catch (error) {
    console.error(`could not generate a certificate (${error.message}).`);
    console.error("Mount TLS_CERT_FILE/TLS_KEY_FILE, or set TLS_DISABLE=1 to serve plain http.");
    process.exit(1);
  }
}

/** Starts the Next server on loopback and fronts it with the protocol-aware listener. */
function serveBoth() {
  const backend = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(BACKEND_PORT), HOSTNAME: "127.0.0.1" },
    stdio: "inherit",
  });
  backend.on("exit", (code) => { console.error(`the Next server exited (${code})`); process.exit(code ?? 1); });

  const tlsOptions = { key: readFileSync(keyFile), cert: readFileSync(certFile) };
  const secure = createHttpsServer(tlsOptions, proxyTo("https"));
  const plain = createHttpServer(proxyTo("http"));

  // One port, two protocols. `read(1)` peeks the socket without switching it to flowing mode;
  // the peeked byte goes back with unshift, and the socket itself becomes the connection of
  // whichever server it belongs to. Node upgrades a socket to a TLSSocket by feeding the bytes
  // still buffered on it into the TLS engine, so the peeked ClientHello is not lost — but only
  // as long as nothing resumes the socket first, which is why there is no resume() here. The
  // protocol server attaches its own reader: 'data' for plain http, the TLS parser for https.
  const front = createNetServer((socket) => {
    socket.on("error", () => socket.destroy());
    // A connection that never says anything is dropped instead of held: the peek needs a byte,
    // and both protocols send theirs immediately (a ClientHello, or a request line).
    socket.setTimeout(30000, () => socket.destroy());
    const decide = () => {
      const first = socket.read(1);
      if (first === null) { socket.once("readable", decide); return; }
      socket.setTimeout(0);
      socket.unshift(first);
      if (first[0] === TLS_HANDSHAKE) secure.emit("connection", socket);
      else plain.emit("connection", socket);
    };
    decide();
  });

  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => { front.close(); secure.close(); plain.close(); backend.kill(signal); process.exit(0); });
  }

  ready().then(() => {
    front.listen(PORT, "0.0.0.0", () => {
      console.log(`ready on 0.0.0.0:${PORT} — https and http on the same port (Next behind it on 127.0.0.1:${BACKEND_PORT})`);
    });
  }).catch((error) => { console.error(error.message); process.exit(1); });
}

/** The one proxy both front doors use; `proto` is what lib/cors.ts reads for cookies and CORS. */
function proxyTo(proto) {
  return (request, response) => {
    const upstream = httpRequest({
      host: "127.0.0.1",
      port: BACKEND_PORT,
      method: request.method,
      path: request.url,
      // The original Host is preserved: lib/cors.ts compares it against the browser's Origin.
      headers: { ...request.headers, "x-forwarded-proto": proto, "x-forwarded-for": request.socket.remoteAddress || "" },
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.pipe(response);
    });
    upstream.on("error", () => {
      if (!response.headersSent) response.writeHead(502, { "content-type": "text/plain" });
      response.end("The studio server is not reachable.");
    });
    request.pipe(upstream);
  };
}

/** Resolves when the backend accepts a connection: no request should meet a boot-time 502. */
function ready(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const socket = connect({ host: "127.0.0.1", port: BACKEND_PORT }, () => { socket.destroy(); resolve(); });
      socket.on("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("the Next server did not start within 30s"));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}
