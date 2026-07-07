#!/usr/bin/env tsx
//
// Dev-mode helper: restore the repo-spawned app (pnpm dev / pnpm start) to
// an indistinguishable-from-first-install state.
//
// What it does:
//   1. Removes untracked skill directories from skills/personal/ — i.e.
//      skills installed via the running app (Discover tab, Settings →
//      Install from GitHub, etc.)
//   2. Reverts any locally-modified tracked files under skills/ back to
//      their committed HEAD state
//   3. Wipes ~/.skills-bank-dev/ entirely (dev userData + dev agent sinks)
//   4. Creates an isolated managed registry with an empty `skills/`
//      tree and pre-writes config.json pointing to it
//
// After running: `pnpm dev` boots with an empty registry — no skills, no
// conflict modal, no error banners — exactly like a packaged first install.
// (There is no curated seed anymore: ADR-0020/0021 dropped the whole
// tarball-sync/curated channel, and the bundled `find-skills` asset with
// it — the managed registry starts genuinely blank and the user links their
// own repo or installs from Discover.)
//
// Scope invariant: every target is either the repo working tree (skills/,
// via git) or ~/.skills-bank-dev/ — the dev redirect main.ts installs in its
// `!app.isPackaged` branch. The packaged install's userData
// (~/Library/Application Support/Skills Bank/) and the real ~/.claude /
// ~/.cursor agent sinks are NEVER referenced here, so a dev reset cannot
// reach the installed app. Keep it that way: only touch devHome (below) and
// repo paths. See CLAUDE.md → "Dev-mode isolation".

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildRegistryIndex } from "../packages/core/src/registry/build.js";

const repoRoot = process.cwd();
const devHome = path.join(os.homedir(), ".skills-bank-dev");
const devUserData = path.join(devHome, "userData");
const managedRegistry = path.join(devUserData, "registry");

// ── 1. Guard: refuse if the app is running ──────────────────────────────────
try {
  const out = execFileSync("pgrep", ["-fl", "Skills Bank"], {
    encoding: "utf8",
  }).trim();
  if (out) {
    console.error("Refusing: Skills Bank is running. Quit the app first.");
    process.exit(1);
  }
} catch {
  // pgrep exits non-zero when nothing matches — that's the good case.
}

// ── 2. Remove untracked skill directories (app-installed skills) ────────────
console.log("Cleaning untracked skills from skills/…");
{
  const dir = path.join(repoRoot, "skills", "personal");
  if (fs.existsSync(dir)) {
    try {
      const preview = execFileSync(
        "git",
        ["-C", repoRoot, "clean", "-fdn", "skills/personal"],
        { encoding: "utf8" },
      )
        .split("\n")
        .filter(Boolean);
      if (preview.length === 0) {
        console.log("  - skills/personal: nothing to remove");
      } else {
        execFileSync(
          "git",
          ["-C", repoRoot, "clean", "-fd", "skills/personal"],
          {
            stdio: "inherit",
          },
        );
      }
    } catch {
      // Nothing to clean or git unavailable.
    }
  }
}

// ── 3. Revert locally-modified tracked files under skills/ ──────────────────
console.log("Reverting modified files in skills/…");
try {
  const modified = execFileSync(
    "git",
    ["-C", repoRoot, "diff", "--name-only", "HEAD", "--", "skills/"],
    { encoding: "utf8" },
  )
    .split("\n")
    .filter(Boolean);
  if (modified.length === 0) {
    console.log("  - nothing modified");
  } else {
    execFileSync("git", ["-C", repoRoot, "checkout", "HEAD", "--", "skills/"], {
      stdio: "inherit",
    });
    console.log(`  ✓ reverted ${modified.length} file(s)`);
  }
} catch {
  // Nothing to revert.
}

// ── 4. Wipe ~/.skills-bank-dev/ ─────────────────────────────────────────────
console.log("Wiping dev state…");
if (fs.existsSync(devHome)) {
  fs.rmSync(devHome, { recursive: true, force: true });
  console.log("  ✓ removed ~/.skills-bank-dev");
} else {
  console.log("  - ~/.skills-bank-dev: not present (skip)");
}

// ── 5. Create a blank managed registry ───────────────────────────────────────
console.log("Creating blank managed registry…");
fs.mkdirSync(path.join(managedRegistry, "skills"), { recursive: true });
buildRegistryIndex(managedRegistry, { includeGitInfo: false, writeFile: true });
console.log("  ✓ empty skills/ + index.json");

// ── 6. Pre-write config.json ─────────────────────────────────────────────────
const config = { registryRoot: managedRegistry, registrySource: "local" };
fs.mkdirSync(devUserData, { recursive: true });
fs.writeFileSync(
  path.join(devUserData, "config.json"),
  JSON.stringify(config, null, 2) + "\n",
);
console.log("  ✓ wrote config.json → managed registry");

console.log(
  "\nFresh state ready. `pnpm dev` will boot with an empty registry.",
);
