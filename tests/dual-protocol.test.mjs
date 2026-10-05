/**
 * The container's front door answers both protocols on one port: the first byte of a connection
 * says which one it is. This starts the real `scripts/serve-https.mjs` against a stand-in
 * backend and asks both doors — including a POST body, since a peeked byte that never made it
 * back into the stream would show up here first.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const SCRIPT = fileURLToPath(new URL("../scripts/serve-https.mjs", import.meta.url));

/** What stands in for the standalone Next server: it reports what the front door forwarded. */
const BACKEND = `
const http = require("node:http");
http.createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({
      proto: request.headers["x-forwarded-proto"],
      host: request.headers.host,
      method: request.method,
      body: Buffer.concat(chunks).toString(),
    }));
  });
}).listen(Number(process.env.PORT), process.env.HOSTNAME || "127.0.0.1");
`;

/** A port nothing is listening on: bind to 0, note the number, let it go. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

/** One request, resolved with the status and the whole body. */
function ask(url, { method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const send = url.startsWith("https:") ? httpsRequest : httpRequest;
    const request = send(url, { method, rejectUnauthorized: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

/** Polls until the front door answers, so no assertion races the boot. */
async function waitForDoor(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try { await ask(`http://127.0.0.1:${port}/health`); return; }
    catch (error) {
      if (Date.now() > deadline) throw new Error(`the front door never opened (${error.message})`);
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

describe("the container's front door", () => {
  test("answers http and https on the same port", async (t) => {
    try { execFileSync("openssl", ["version"], { stdio: "ignore" }); }
    catch { t.skip("openssl is not installed — the certificate cannot be generated"); return; }

    const dir = mkdtempSync(path.join(tmpdir(), "onlinemusic-dual-"));
    writeFileSync(path.join(dir, "server.js"), BACKEND);
    const port = await freePort();
    const backendPort = await freePort();
    // `detached` puts the script and the backend it spawns in one process group, so cleanup can
    // end both: killing only the script would orphan the backend, whose inherited stdio would
    // then keep this test's pipes open forever.
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: dir,
      detached: true,
      env: {
        ...process.env,
        PORT: String(port),
        TLS_BACKEND_PORT: String(backendPort),
        AUTH_DATA_DIR: path.join(dir, "data"),
        TLS_HOSTS: "127.0.0.1",
        TLS_DISABLE: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let logs = "";
    child.stdout.on("data", (chunk) => { logs += chunk; });
    child.stderr.on("data", (chunk) => { logs += chunk; });
    // SIGTERM first, so the script can take its backend down the way a container stop would;
    // SIGKILL of the whole group is the guarantee, not the courtesy.
    t.after(() => new Promise((resolve) => {
      const kill = (signal) => { try { process.kill(-child.pid, signal); } catch { child.kill(signal); } };
      child.once("exit", resolve);
      kill("SIGTERM");
      const force = setTimeout(() => kill("SIGKILL"), 1000);
      child.once("exit", () => clearTimeout(force));
      setTimeout(resolve, 3000).unref?.();
    }));

    try { await waitForDoor(port); }
    catch (error) { throw new Error(`${error.message}\nfront door said:\n${logs || "(nothing)"}`); }

    const plain = await ask(`http://127.0.0.1:${port}/api/auth`);
    assert.equal(plain.status, 200);
    assert.equal(JSON.parse(plain.body).proto, "http");

    const secure = await ask(`https://127.0.0.1:${port}/api/auth`);
    assert.equal(secure.status, 200);
    const forwarded = JSON.parse(secure.body);
    assert.equal(forwarded.proto, "https");
    assert.equal(forwarded.host, `127.0.0.1:${port}`, "the original Host survives the TLS front door");

    const posted = await ask(`https://127.0.0.1:${port}/api/auth`, { method: "POST", body: "hello front door" });
    assert.equal(posted.status, 200);
    assert.equal(JSON.parse(posted.body).body, "hello front door");
  });
});
