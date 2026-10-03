/**
 * The one thing the page may learn about its shell. Nothing of Node crosses this bridge: the
 * page stays the same web client it is in a browser, and only needs to know that it is the
 * desktop app (so an unset server address falls back to the local deployment).
 */

const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld(
  "studio",
  Object.freeze({
    isElectron: true,
    defaultServerUrl: "http://localhost:3000",
  }),
);
