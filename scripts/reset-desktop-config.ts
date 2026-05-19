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
// With no stored linkedRepo and no stored auth, the next launch is
// treated as a first launch and boots the two-card LoginScreen. Pick
// "Use the public skills bank" for the unauth bundled-default path,
// or "Connect with GitHub" to authenticate and choose a repo.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Dev-mode isolation (see packages/desktop/src/main/main.ts) redirects
// every unpackaged run's userData into ~/.skills-bank-dev/userData/, so
// reset only ever touches that path. The packaged install's userData
// (~/Library/Application Support/Skills Bank) is intentionally NOT a
// target — wiping it from a dev-clone script would re-introduce the
// cross-contamination this isolation was designed to prevent.
function userDataCandidates(): { label: string; path: string }[] {
  return [
    {
      label: "dev",
      path: path.join(os.homedir(), ".skills-bank-dev", "userData"),
    },
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
    ? "Reset complete (hard). Next launch shows the two-card LoginScreen with a fresh registry — no skills installed, no token."
    : "Reset complete. Next launch shows the two-card LoginScreen — registry contents preserved, token cleared.",
);
console.log(
  "Post persona-collapse, boot auto-routes to local-bundled when no source is stored. To switch into github-linked, use AccountModal → Connect to GitHub.",
);
