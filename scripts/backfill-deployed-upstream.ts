#!/usr/bin/env tsx
//
// Maintainer-internal: one-shot stamp of upstream pointers into a
// deployed registry (the desktop app's runtime registry root) by
// reading the local `vercel-labs/skills` CLI lock file. This is the
// same operation the desktop main process runs at boot, exposed as
// a CLI for cases where bypassing the GUI is preferred (e.g. setting
// up a fresh machine via dotfiles, or initial stamping before first
// app launch).
//
// Largely redundant with the runtime scanner — included for parity
// with the plan-03 spec and for scriptable bootstraps.
//
// Usage:
//   tsx scripts/backfill-deployed-upstream.ts          # default registry root
//   tsx scripts/backfill-deployed-upstream.ts --root <path>
//   SKILLS_BANK_ROOT=<path> tsx scripts/backfill-deployed-upstream.ts
//
// Default registry-root resolution mirrors the desktop's:
//   1. `--root <path>` flag
//   2. `SKILLS_BANK_ROOT` env var
//   3. Walk up from cwd looking for a `skills/` directory

import fs from "node:fs";
import path from "node:path";
import { scanAndStampUpstreamFromLock } from "../packages/core/src/index.js";

function resolveRegistryRoot(): string {
  const flagIdx = process.argv.indexOf("--root");
  if (flagIdx >= 0 && process.argv[flagIdx + 1]) {
    return path.resolve(process.argv[flagIdx + 1]!);
  }
  if (process.env["SKILLS_BANK_ROOT"]) {
    return path.resolve(process.env["SKILLS_BANK_ROOT"]);
  }
  // Walk up from cwd looking for a skills/ dir.
  let dir = process.cwd();
  while (true) {
    if (fs.existsSync(path.join(dir, "skills"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) {
      console.error(
        "no registry root found via --root, SKILLS_BANK_ROOT, or cwd walk-up",
      );
      process.exit(1);
    }
    dir = parent;
  }
}

function main(): void {
  const root = resolveRegistryRoot();
  console.log(`registry root: ${root}`);
  const { stamped } = scanAndStampUpstreamFromLock(root);
  console.log(`stamped: ${stamped}`);
}

main();
