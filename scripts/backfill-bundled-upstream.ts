#!/usr/bin/env tsx
//
// Maintainer-internal: stamp upstream pointers into this repo's
// checked-in `skills/<name>/.skills-bank.json` markers using the
// curated mapping at `scripts/bundled-upstream-mapping.json`.
//
// Run once per round of bundled-set curation (when new skills are
// added to skills/ that have GitHub upstreams the maintainer wants to
// surface). Idempotent: skills with an existing `upstream` field are
// skipped untouched. Skills with no mapping entry are reported but
// left alone — the runtime origin-capture scanner can stamp them
// later from end-user lock files, or they stay un-classified if no
// CLI install ever happens.
//
// Usage:
//   tsx scripts/backfill-bundled-upstream.ts          # write
//   tsx scripts/backfill-bundled-upstream.ts --dry    # report only
//
// The script also writes a SHA-256 baseline via `.skills-bank-hash`
// for each newly-stamped skill so subsequent index builds can detect
// post-stamp local edits. Bundled-sync's existing hash write doesn't
// fire here because the maintainer's repo path bypasses the desktop
// app's sync flow.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  hashSkillFolder,
  readSkillSource,
  UPSTREAM_KIND_GITHUB,
  writeSkillSource,
  writeSyncedHash,
  type UpstreamPointer,
} from "../packages/core/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

interface MappingEntry {
  repo: string;
  sourceUrl?: string;
  skillPath: string;
}

interface MappingFile {
  version: number;
  skills: Record<string, MappingEntry>;
}

function loadMapping(): MappingFile {
  const p = path.join(repoRoot, "scripts", "bundled-upstream-mapping.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<MappingFile> & {
    skills?: unknown;
  };
  if (typeof raw.version !== "number" || !raw.skills) {
    throw new Error(`malformed mapping at ${p}`);
  }
  return raw as MappingFile;
}

function main(): void {
  const dry = process.argv.includes("--dry");
  const mapping = loadMapping();
  const skillsDir = path.join(repoRoot, "skills");
  if (!fs.existsSync(skillsDir)) {
    console.error(`no skills/ directory at ${skillsDir}`);
    process.exit(1);
  }

  const stamped: string[] = [];
  const alreadyStamped: string[] = [];
  const unmapped: string[] = [];

  for (const sk of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sk.isDirectory()) continue;
    const name = sk.name;
    const skillDir = path.join(skillsDir, name);
    const base = readSkillSource(skillDir);

    if (base.upstream !== undefined) {
      alreadyStamped.push(name);
      continue;
    }

    const entry = mapping.skills[name];
    if (!entry) {
      unmapped.push(name);
      continue;
    }

    const upstream: UpstreamPointer = {
      kind: UPSTREAM_KIND_GITHUB,
      repo: entry.repo,
      skillPath: entry.skillPath,
    };
    if (entry.sourceUrl) upstream.sourceUrl = entry.sourceUrl;

    stamped.push(name);
    if (dry) continue;

    writeSkillSource(skillDir, { ...base, upstream });
    const baseline = hashSkillFolder(skillDir);
    if (baseline) writeSyncedHash(skillDir, baseline);
  }

  console.log(
    `${dry ? "[dry-run] " : ""}stamped: ${stamped.length}, ` +
      `already-stamped: ${alreadyStamped.length}, ` +
      `unmapped: ${unmapped.length}`,
  );
  if (stamped.length > 0) {
    console.log("\nStamped:");
    for (const n of stamped) console.log(`  ${n}`);
  }
  if (unmapped.length > 0) {
    console.log("\nUnmapped (add to scripts/bundled-upstream-mapping.json):");
    for (const n of unmapped) console.log(`  ${n}`);
  }
}

main();
