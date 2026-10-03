/**
 * The desktop shell: a window around the bundled static export.
 *
 * The UI (out/, produced by `npm run build:client`) is served over a privileged `app://bundle`
 * scheme rather than loaded from a file path. Two reasons: a file:// page carries the opaque
 * "null" origin, which no CORS allowlist can name cleanly, and a custom scheme registered as
 * `standard` gets a real, stable origin — `app://bundle` — that the API server's ALLOWED_ORIGINS
 * can accept once and for all. It is deliberately NOT registered as `secure`: a non-secure
 * context is never asked to block mixed content, so the app can fetch a plain-http LAN server
 * (http://192.168.x.x) as freely as an https one.
 *
 * The page is otherwise exactly the web client: nothing of Node crosses the bridge except the
 * one flag and the default server address (see preload.js).
 */

const { app, BrowserWindow, net, protocol } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Must run before app is ready.
protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

const OUT_DIR = path.join(__dirname, "out");

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};

/** app://bundle/<path> → out/<path>, never outside out/. */
function serve(request) {
  const { pathname } = new URL(request.url);
  let relative = decodeURIComponent(pathname);
  if (relative === "/" || relative.endsWith("/")) relative += "index.html";
  const filePath = path.normalize(path.join(OUT_DIR, relative));
  if (filePath !== OUT_DIR && !filePath.startsWith(OUT_DIR + path.sep)) {
    return new Response("not found", { status: 404 });
  }
  return net.fetch(pathToFileURL(filePath).toString()).then((response) => {
    const headers = new Headers(response.headers);
    const ext = path.extname(filePath).toLowerCase();
    if (!headers.has("content-type") && MIME[ext]) headers.set("content-type", MIME[ext]);
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    title: "onlineMusic",
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: "#f6f7fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  window.loadURL("app://bundle/index.html");
}

app.whenReady().then(() => {
  protocol.handle("app", serve);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
