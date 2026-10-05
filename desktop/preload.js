/**
 * The one thing the page may learn about its shell. Nothing of Node crosses this bridge: the
 * page stays the same web client it is in a browser, and only needs to know that it is the
 * desktop app and which server it was built against — the app carries no server card, so this
 * address is the one every call goes to.
 */

const { contextBridge } = require("electron");

/**
 * The server the packaged app fetches from. `scripts/package-mac.mjs --server=<url>` replaces
 * this literal in the copy of this file that ships inside the bundle; the value here is the
 * repo default, the local Docker deployment, for running the shell straight from the source.
 */
const DEFAULT_SERVER_URL = "http://localhost:3000";

contextBridge.exposeInMainWorld(
  "studio",
  Object.freeze({
    isElectron: true,
    defaultServerUrl: DEFAULT_SERVER_URL,
  }),
);
