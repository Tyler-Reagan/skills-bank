#!/usr/bin/env tsx
//
// Dev-mode helper: restore the repo-spawned app (pnpm dev / pnpm start) to
// an indistinguishable-from-first-install state.
//
// What it does:
//   1. Removes untracked skill directories from skills/vendored/ and
//      skills/personal/ — i.e. skills installed via the running app
//      (Discover tab, Settings → Install from GitHub, etc.)
//   2. Reverts runtime-modified skill sidecars (.skills-bank.json,
//      .skills-bank-hash) back to their committed HEAD state
//   3. Wipes ~/.skills-bank-dev/ entirely (dev userData + dev agent sinks)
//   4. Creates an isolated managed registry seeded with the committed curated
//      skills (currently only find-skills) and pre-writes config.json pointing
//      to it — the boot-time sync then stamps syncedFromCommit silently.
//
// After running: `pnpm dev` boots showing find-skills with the CURATED badge,
// no conflict modal, no error banners — exactly like a packaged first install.
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
for (const bucket of ["skills/vendored", "skills/personal"]) {
  const dir = path.join(repoRoot, bucket);
  if (!fs.existsSync(dir)) continue;
  try {
    const preview = execFileSync(
      "git",
      ["-C", repoRoot, "clean", "-fdn", bucket],
      { encoding: "utf8" },
    )
      .split("\n")
      .filter(Boolean);
    if (preview.length === 0) {
      console.log(`  - ${bucket}: nothing to remove`);
    } else {
      execFileSync("git", ["-C", repoRoot, "clean", "-fd", bucket], {
        stdio: "inherit",
      });
    }
  } catch {
    // Nothing to clean or git unavailable.
  }
}

// ── 3. Revert modified skill sidecars (.skills-bank.json, etc.) ─────────────
console.log("Reverting modified skill sidecars in skills/…");
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

// ── 5. Seed managed registry with committed curated skills ──────────────────
// After step 2, skills/vendored/ contains only committed curated skills
// (any untracked Discover-installed skills were cleaned above). Copy them
// directly — their .skills-bank.json already carries source: "curated".
// The boot-time sync will overwrite cleanly (no conflict) and stamp a real
// syncedFromCommit, thanks to the isPreviouslySynced fix in sync.ts.
console.log("Seeding managed registry…");
const srcVendored = path.join(repoRoot, "skills", "vendored");
const destVendored = path.join(managedRegistry, "skills", "vendored");
fs.mkdirSync(destVendored, { recursive: true });
if (fs.existsSync(srcVendored)) {
  fs.cpSync(srcVendored, destVendored, { recursive: true });
}
buildRegistryIndex(managedRegistry, { includeGitInfo: false, writeFile: true });
console.log("  ✓ seeded curated skills + built index");

// ── 6. Pre-write config.json ─────────────────────────────────────────────────
const config = { registryRoot: managedRegistry, registrySource: "local" };
fs.writeFileSync(
  path.join(devUserData, "config.json"),
  JSON.stringify(config, null, 2) + "\n",
);
console.log("  ✓ wrote config.json → managed registry");

console.log(
  "\nFresh state ready. `pnpm dev` will boot with the curated skill set.",
);
