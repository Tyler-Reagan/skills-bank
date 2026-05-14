#!/usr/bin/env tsx
//
// Maintainer helper: write `.skills-bank.json` source markers for every
// skill in a registry root, tagging each as `source: bundled`.
//
// Use case: when running the app against a cloned skills-bank repo
// (`SKILLS_BANK_ROOT=/path/to/clone`), the bundled-seed code path in the
// desktop main process never executes — so the per-skill markers it
// would normally write at first launch are absent. With no markers,
// every skill reads as `source: yours` (the safe default for unknown
// provenance) and Sync surfaces a sync collision for every name.
// Run this once against your clone after `desktop:reset:hard` to
// bootstrap markers and avoid that collision storm on first Sync.
//
// Target directory:
//   - `--root <path>` if passed
//   - `SKILLS_BANK_ROOT` env var if set
//   - the script's own repo root (parent of `scripts/`) otherwise
//
// Only writes a marker if one doesn't already exist. Safe to re-run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveRegistryRoot(): string {
  const flagIdx = process.argv.indexOf("--root");
  if (flagIdx !== -1 && process.argv[flagIdx + 1]) {
    return path.resolve(process.argv[flagIdx + 1] as string);
  }
  const env = process.env["SKILLS_BANK_ROOT"];
  if (env) return path.resolve(env);
  return path.resolve(__dirname, "..");
}

function main(): void {
  const root = resolveRegistryRoot();
  const skillsDir = path.join(root, "skills");
  if (!fs.existsSync(skillsDir) || !fs.statSync(skillsDir).isDirectory()) {
    console.error(`no skills/ directory at ${root}`);
    process.exit(1);
  }

  const syncedAt = new Date().toISOString();
  let wrote = 0;
  let skipped = 0;

  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const markerPath = path.join(skillsDir, ent.name, ".skills-bank.json");
    if (fs.existsSync(markerPath)) {
      skipped += 1;
      continue;
    }
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ source: "bundled", syncedAt }, null, 2) + "\n",
    );
    wrote += 1;
  }

  console.log(`seeded ${wrote} marker(s); skipped ${skipped} (already present)`);
  console.log(`registry root: ${root}`);
}

main();
