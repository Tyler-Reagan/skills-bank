#!/usr/bin/env tsx
//
// Maintainer-internal: stamp self-referential upstream pointers onto
// bundled skills the maintainer authored (i.e. not vendored from any
// external repo). The marker says `kind: "github", repo: <bundled-
// repo>` — the bundled repo serves both roles (distribution AND
// origin) for skills authored in it. Per the origin-paradigm-reframe
// plan, Q2 option (a).
//
// Designed to run AFTER discover-bundled-upstream.ts has stamped
// everything it can resolve from skills.sh. Any folder still without
// an `upstream` field is treated as a self-authored candidate.
//
// Usage:
//   tsx scripts/stamp-self-authored.ts                       # list remaining unstamped (dry)
//   tsx scripts/stamp-self-authored.ts --apply               # stamp all remaining
//   tsx scripts/stamp-self-authored.ts --apply --only foo,bar # stamp specific names only
//
// The bundled repo identity is read from the BUNDLED_REPO constant
// in the desktop shared IPC layer so this script stays in sync with
// whatever the app considers the bundled-default registry.

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
import { BUNDLED_REPO } from "../packages/desktop/src/shared/ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function main(): void {
  const apply = process.argv.includes("--apply");
  const onlyIdx = process.argv.indexOf("--only");
  const only =
    onlyIdx >= 0 && process.argv[onlyIdx + 1]
      ? new Set(process.argv[onlyIdx + 1]!.split(",").map((s) => s.trim()))
      : null;

  const skillsDir = path.join(repoRoot, "skills");
  const now = new Date().toISOString();
  const candidates: string[] = [];

  for (const sk of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sk.isDirectory()) continue;
    const name = sk.name;
    if (only && !only.has(name)) continue;
    const base = readSkillSource(path.join(skillsDir, name));
    if (base.upstream !== undefined) continue;
    candidates.push(name);
  }

  candidates.sort();
  console.log(`${candidates.length} unstamped:`);
  for (const n of candidates) console.log(`  ${n}`);

  if (!apply) {
    console.log(
      "\n(dry mode — re-run with --apply to stamp self-referential markers)",
    );
    return;
  }

  let stamped = 0;
  for (const name of candidates) {
    const skillDir = path.join(skillsDir, name);
    const base = readSkillSource(skillDir);
    const skillPath = `skills/${name}/SKILL.md`;
    const pointer: UpstreamPointer = {
      kind: UPSTREAM_KIND_GITHUB,
      repo: BUNDLED_REPO,
      sourceUrl: `https://github.com/${BUNDLED_REPO}.git`,
      skillPath,
      installedAt: now,
      fetchedAt: now,
    };
    writeSkillSource(skillDir, { ...base, upstream: pointer });
    const baseline = hashSkillFolder(skillDir);
    if (baseline) writeSyncedHash(skillDir, baseline);
    stamped++;
  }
  console.log(`\nstamped ${stamped} as self-authored (repo: ${BUNDLED_REPO})`);
  console.log(
    "note: skillFolderHash left blank — first probe will capture it from " +
      "the bundled repo's HEAD",
  );
}

main();
