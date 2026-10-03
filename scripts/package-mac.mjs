/**
 * Assembles the macOS app from the Electron template, by hand: no packager dependency.
 *
 * `npm run package:mac` first builds the static export (`out/`), then this script:
 *   1. copies node_modules/electron/dist/Electron.app to dist/onlineMusic.app,
 *   2. drops the shell (desktop/) and the exported UI into Contents/Resources/app/,
 *   3. rewrites the identity in Info.plist (name, bundle id, icon) with PlistBuddy,
 *   4. renders desktop/icon.svg into an .icns through sips + iconutil,
 *   5. ad-hoc signs the bundle so Gatekeeper leaves a locally built app alone.
 *
 * Everything used is already on a Mac (PlistBuddy, sips, iconutil, codesign); the icon
 * is a nice-to-have and the script finishes without it rather than failing.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync, statSync, symlinkSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = process.cwd();
const APP_NAME = "onlineMusic";
const TARGET = path.join(ROOT, "dist", `${APP_NAME}.app`);
const TEMPLATE = path.join(ROOT, "node_modules", "electron", "dist", "Electron.app");
const OUT_DIR = path.join(ROOT, "out");

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
for (const file of ["main.js", "preload.js", "package.json"]) {
  cpSync(path.join(ROOT, "desktop", file), path.join(appDir, file));
}
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
console.log(`packaged ${TARGET}`);

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
