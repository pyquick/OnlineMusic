/**
 * Assembles the macOS app from the Electron template, by hand: no packager dependency.
 *
 * `npm run package:mac` first builds the static export (`out/`), then this script:
 *   1. copies node_modules/electron/dist/Electron.app to dist/onlineMusic.app,
 *   2. drops the shell (desktop/) and the exported UI into Contents/Resources/app/, baking the
 *      `--server=<url>` address into preload.js (the address the page reads) and tls.js (the
 *      certificate policy an https address needs); without the flag the shell keeps its local
 *      default,
 *   3. rewrites the identity in Info.plist (name, bundle id, icon) with PlistBuddy,
 *   4. renders desktop/icon.svg into an .icns through sips + iconutil,
 *   5. ad-hoc signs the bundle so Gatekeeper leaves a locally built app alone.
 *
 * Everything used is already on a Mac (PlistBuddy, sips, iconutil, codesign); the icon
 * is a nice-to-have and the script finishes without it rather than failing.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const APP_NAME = "onlineMusic";
const TARGET = path.join(ROOT, "dist", `${APP_NAME}.app`);
const TEMPLATE = path.join(ROOT, "node_modules", "electron", "dist", "Electron.app");
const OUT_DIR = path.join(ROOT, "out");
/** The server the packaged app will fetch from; "" leaves the shell's own default in place. */
const SERVER_URL = readServerFlag();

if (!existsSync(TEMPLATE)) {
  console.error("Electron is not installed — run `npm install` first.");
  process.exit(1);
}
if (!existsSync(path.join(OUT_DIR, "index.html"))) {
  console.error("No static export found — run `npm run build:client` first.");
  process.exit(1);
}

rmSync(TARGET, { recursive: true, force: true });
mkdirSync(path.dirname(TARGET), { recursive: true });
// macOS cp -R keeps symlinks as symlinks; Node's cpSync dereferences link chains into absolute
// paths pointing back at node_modules, which both breaks the bundle and its signature seal.
execFileSync("cp", ["-R", TEMPLATE, TARGET]);
relinkAbsoluteSymlinks(TARGET);

// The app itself: the shell files plus the exported UI, in Electron's default app directory.
const resources = path.join(TARGET, "Contents", "Resources");
rmSync(path.join(resources, "default_app.asar"), { force: true });
const appDir = path.join(resources, "app");
mkdirSync(appDir, { recursive: true });
cpSync(path.join(ROOT, "desktop", "main.js"), path.join(appDir, "main.js"));
cpSync(path.join(ROOT, "desktop", "package.json"), path.join(appDir, "package.json"));
for (const file of ["preload.js", "tls.js"]) writeShellFile(file, path.join(appDir, file));
cpSync(OUT_DIR, path.join(appDir, "out"), { recursive: true });

buildIcon(resources);

// The identity: the menu-bar name, the bundle id, and the version.
const plist = path.join(TARGET, "Contents", "Info.plist");
const PLIST_BUDDY = "/usr/libexec/PlistBuddy";
for (const [key, value] of [
  ["CFBundleDisplayName", APP_NAME],
  ["CFBundleName", APP_NAME],
  ["CFBundleIdentifier", "io.github.pyquick.onlinemusic"],
  ["CFBundleShortVersionString", "0.1.0"],
  ["CFBundleVersion", "0.1.0"],
  ["CFBundleIconFile", `${APP_NAME}.icns`],
]) {
  execFileSync(PLIST_BUDDY, ["-c", `Set :${key} ${value}`, plist]);
}
// The template's team id is Apple's, not this app's; an ad-hoc signature must not carry it.
// (Newer templates may not have the key at all — nothing to delete is not an error.)
try { execFileSync(PLIST_BUDDY, ["-c", "Delete :ElectronTeamID", plist], { stdio: "ignore" }); } catch { /* no such key */ }

execFileSync("codesign", ["--force", "--deep", "--sign", "-", TARGET]);
console.log(`packaged ${TARGET}${SERVER_URL ? ` (server ${SERVER_URL})` : ""}`);

/**
 * The `--server=<url>` flag (also accepted as `--server <url>`), read from the end so a later
 * occurrence wins: `npm run package:mac -- --server=http://elsewhere:3000` overrides the address
 * the script itself passes. The address must be a full http:// or https:// URL.
 */
function readServerFlag() {
  const argv = process.argv.slice(2);
  let value = "";
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--server") { value = argv[index + 1] ?? ""; index += 1; }
    else if (argv[index].startsWith("--server=")) value = argv[index].slice("--server=".length);
  }
  value = value.trim().replace(/\/+$/, "");
  if (value && !/^https?:\/\/[^/]+/i.test(value)) {
    console.error(`--server must be a full http:// or https:// address (got "${value}")`);
    process.exit(1);
  }
  return value;
}

/** Copies a shell file into the bundle, with its default server swapped for the flag's address. */
function writeShellFile(name, target) {
  const source = readFileSync(path.join(ROOT, "desktop", name), "utf8");
  if (!SERVER_URL) { writeFileSync(target, source); return; }
  const literal = /const DEFAULT_SERVER_URL = "[^"]*";/;
  if (!literal.test(source)) {
    console.error(`desktop/${name} no longer carries a DEFAULT_SERVER_URL literal — the --server flag cannot be applied.`);
    process.exit(1);
  }
  const line = `const DEFAULT_SERVER_URL = ${JSON.stringify(SERVER_URL)};`;
  const baked = source.replace(/const DEFAULT_SERVER_URL = "[^"]*";/, () => line);
  writeFileSync(target, baked);
}

/** Any symlink a copy step resolved into an absolute path is re-pointed inside the bundle. */
function relinkAbsoluteSymlinks(where) {
  for (const entry of readdirSync(where)) {
    const full = path.join(where, entry);
    if (lstatSync(full).isSymbolicLink()) {
      const target = readlinkSync(full);
      if (target.startsWith(TEMPLATE)) {
        const inside = path.join(TARGET, target.slice(TEMPLATE.length));
        rmSync(full, { force: true });
        symlinkSync(path.relative(path.dirname(full), inside), full);
      }
    } else if (lstatSync(full).isDirectory()) {
      relinkAbsoluteSymlinks(full);
    }
  }
}

/** Renders desktop/icon.svg into Contents/Resources/onlineMusic.icns; logs and moves on if any step lacks a tool. */
function buildIcon(resources) {
  const work = path.join(os.tmpdir(), `onlinemusic-icon-${process.pid}`);
  const icns = path.join(resources, `${APP_NAME}.icns`);
  try {
    mkdirSync(work, { recursive: true });
    // sips rasterises the SVG itself; the iconset then holds every size iconutil expects.
    const rendered = path.join(work, "icon.png");
    execFileSync("sips", ["-s", "format", "png", path.join(ROOT, "desktop", "icon.svg"), "--out", rendered], { stdio: "ignore" });
    if (!existsSync(rendered)) throw new Error("sips produced no PNG");
    const iconset = path.join(work, "fresh.iconset");
    mkdirSync(iconset, { recursive: true });
    for (const size of [16, 32, 128, 256, 512]) {
      execFileSync("sips", ["-z", String(size), String(size), rendered, "--out", path.join(iconset, `icon_${size}x${size}.png`)], { stdio: "ignore" });
      execFileSync("sips", ["-z", String(size * 2), String(size * 2), rendered, "--out", path.join(iconset, `icon_${size}x${size}@2x.png`)], { stdio: "ignore" });
    }
    execFileSync("iconutil", ["-c", "icns", iconset, "-o", icns], { stdio: "ignore" });
    console.log("icon installed");
  } catch (error) {
    console.warn(`icon skipped (${error.message}) — the default Electron icon remains`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
