/**
 * The static-export build: the UI alone, with the API routes out of the tree.
 *
 * `output: "export"` refuses to build while route handlers sit in app/ — a `force-dynamic` route
 * cannot be exported, and the parameterised ones ([id]) cannot be statically generated. The
 * server routes must exist for the server build, so this script moves app/api aside for the one
 * build and always puts it back — even when the build fails. A crash between the two renames
 * self-heals on the next run: the stash is restored before anything else happens.
 */
import { execFileSync } from "node:child_process";
import { existsSync, renameSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const API_DIR = path.join(ROOT, "app", "api");
const STASH = path.join(ROOT, ".api-export-stash");

if (existsSync(STASH)) {
  console.warn("restoring app/api left behind by an interrupted export build");
  renameSync(STASH, API_DIR);
}

try {
  renameSync(API_DIR, STASH);
  execFileSync(
    process.platform === "win32" ? "npx.cmd" : path.join(ROOT, "node_modules", ".bin", "next"),
    ["build"],
    { stdio: "inherit", env: { ...process.env, NEXT_EXPORT: "1" } },
  );
} finally {
  if (existsSync(STASH)) renameSync(STASH, API_DIR);
}
