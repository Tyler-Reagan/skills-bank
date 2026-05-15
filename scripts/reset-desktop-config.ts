#!/usr/bin/env tsx
//
// Dev-mode helper: wipe the Skills Bank desktop app's userData state so
// the next launch behaves like a first install. Use this between manual
// test runs of github-linked flows / sync / repo-picker.
//
// Default mode deletes:
//   - config.json   (registryRoot, registrySource, linkedRepo, dismissedUpdateVersion)
//   - auth.enc      (encrypted GitHub token)
//
// `--hard` additionally deletes:
//   - registry/     (the entire app-managed registry directory, including
//                    .skills-bank/ state and any synced or imported skills)
//
// Run via: `pnpm reset` or `pnpm reset:hard`. The `:hard` variant also
// auto-invokes `pnpm reset:seed` to repopulate source markers in the
// repo's `skills/` directory.
//
// Post persona-collapse the next launch always boots into local-bundled
// mode (the LoginScreen path is reachable only via in-app GitHub sign-
// out). To exercise github-linked flows from a clean state, run reset
// then in-app: AccountModal → Connect to GitHub.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Electron picks the userData dir based on app.getName(), which differs
// between dev and packaged runs:
//   - packaged: build.productName from package.json ("Skills Bank")
//   - dev (`electron .`): the top-level "name" field of the desktop
//     package.json ("@skills-bank/desktop") → on macOS becomes the
//     literal "@skills-bank/desktop" subpath under Application Support.
// Reset both so the script works regardless of which mode you're testing.
function appSupportRoot(): string {
  switch (process.platform) {
    case "darwin":
      return path.join(os.homedir(), "Library", "Application Support");
    case "win32":
      return (
        process.env["APPDATA"] ?? path.join(os.homedir(), "AppData", "Roaming")
      );
    default:
      return (
        process.env["XDG_CONFIG_HOME"] ?? path.join(os.homedir(), ".config")
      );
  }
}

function userDataCandidates(): { label: string; path: string }[] {
  const root = appSupportRoot();
  return [
    { label: "packaged", path: path.join(root, "Skills Bank") },
    { label: "dev", path: path.join(root, "@skills-bank", "desktop") },
  ];
}

function rm(target: string, label: string): void {
  if (!fs.existsSync(target)) {
    console.log(`  - ${label}: not present (skip)`);
    return;
  }
  fs.rmSync(target, { recursive: true, force: true });
  console.log(`  ✓ removed ${label}`);
}

const hard = process.argv.includes("--hard");
let touched = 0;

for (const { label, path: dir } of userDataCandidates()) {
  if (!fs.existsSync(dir)) continue;
  touched++;
  console.log(`Resetting ${label} userData:\n  ${dir}`);
  rm(path.join(dir, "config.json"), `${label} config.json`);
  rm(path.join(dir, "auth.enc"), `${label} auth.enc`);
  if (hard) {
    rm(path.join(dir, "registry"), `${label} registry/ (full wipe)`);
  }
  console.log("");
}

if (touched === 0) {
  console.log("No Skills Bank userData dirs exist — nothing to reset.");
  process.exit(0);
}

console.log(
  hard
    ? "Reset complete (hard). Next launch boots to local-bundled with a fresh registry — no skills installed, no token."
    : "Reset complete. Next launch boots to local-bundled — registry contents preserved, token cleared.",
);
console.log(
  "Post persona-collapse, boot auto-routes to local-bundled when no source is stored. To switch into github-linked, use AccountModal → Connect to GitHub.",
);
