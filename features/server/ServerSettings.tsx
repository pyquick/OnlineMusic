"use client";

import { useEffect, useState } from "react";
import { apiBase, readServerUrl, writeServerUrl } from "@/infrastructure/api/base";
import "./server.css";

/**
 * The card the server address is set from. The app is a client: accounts and media live on the
 * API server this field points at, and every call goes there. Empty follows the shell's default —
 * the page's own origin in a browser, `http://localhost:3000` in the desktop app — and changing
 * the address reloads the page so the session, the index and every URL start over against it.
 */
export default function ServerSettings() {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setValue(readServerUrl()); }, []);
  const effective = apiBase();
  const inDesktop = typeof window !== "undefined" && window.studio?.isElectron === true;

  function save() {
    const cleaned = value.trim();
    if (cleaned && !/^https?:\/\/.+/i.test(cleaned)) { setError("The address must be a full http:// or https:// URL."); return; }
    writeServerUrl(cleaned);
    window.location.reload();
  }

  function reset() {
    writeServerUrl("");
    window.location.reload();
  }

  return (
    <section className="settings-page">
      <div className="settings-card panel server-card" data-glass-edge="">
        <div className="panel-title"><h3>Server</h3></div>
        <div className="settings-page-body">
          <label>Server address
            <input className="server-field" type="text" value={value} spellCheck={false} autoComplete="off" placeholder={effective || (inDesktop ? "http://localhost:3000" : "Same origin as this page")} onChange={(event) => { setValue(event.target.value); setError(""); }} />
          </label>
          <p className="settings-hint">Where your account and media live — this app only ever fetches from here. Empty means the default: {inDesktop ? "the local server at http://localhost:3000" : "this page's own origin"}. The page reloads when the address changes.</p>
          {error && <p className="error-message">{error}</p>}
          <button className="save-button" onClick={save}>Save &amp; reload</button>
          <button className="ghost-button" data-glass-edge="" onClick={reset}>Use default</button>
        </div>
      </div>
    </section>
  );
}
