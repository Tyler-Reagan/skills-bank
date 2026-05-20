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
//   tsx scripts/stamp-self-authored.ts                          # list remaining unstamped (dry)
//   tsx scripts/stamp-self-authored.ts --apply                  # stamp all remaining
//   tsx scripts/stamp-self-authored.ts --apply --only foo,bar   # stamp specific names only
//   tsx scripts/stamp-self-authored.ts --apply --source yours   # override default source axis
//
// Newly-stamped markers get `source: "bundled"` — this tool is for
// skills the maintainer is intentionally adding to the bundled set.
// Pass `--source yours` for the rare case of stamping a personal-
// only skill via the same tool. Only skills without an `upstream`
// field are candidates, so the script never clobbers an already-
// stamped marker.
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
  ORIGIN_KIND_GITHUB,
  walkSkills,
  writeSkillSource,
  writeSyncedHash,
  type SkillFolderRef,
  type SkillOrigin,
  type OriginPointer,
} from "../packages/core/src/index.js";
import { BUNDLED_REPO } from "../packages/desktop/src/shared/ipc.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function parseSourceFlag(): SkillOrigin {
  const idx = process.argv.indexOf("--source");
  if (idx < 0) return "bundled";
  const v = process.argv[idx + 1];
  if (v === "bundled" || v === "yours") return v;
  console.error(
    `--source must be "bundled" or "yours" (got: ${v ?? "<missing>"})`,
  );
  process.exit(1);
}

function main(): void {
  const apply = process.argv.includes("--apply");
  const onlyIdx = process.argv.indexOf("--only");
  const only =
    onlyIdx >= 0 && process.argv[onlyIdx + 1]
      ? new Set(process.argv[onlyIdx + 1]!.split(",").map((s) => s.trim()))
      : null;
  const sourceDefault = parseSourceFlag();

  const now = new Date().toISOString();
  // Self-authored skills live under skills/personal/<name>/ post-split.
  // Pre-split (during the migration window) they may still be under the
  // flat skills/<name>/ layout — walkSkills tolerates both since flat
  // entries simply aren't found.
  const candidates: SkillFolderRef[] = [];
  for (const ref of walkSkills(repoRoot)) {
    if (only && !only.has(ref.name)) continue;
    const base = readSkillSource(ref.dir);
    if (base.upstream !== undefined) continue;
    candidates.push(ref);
  }

  candidates.sort((a, b) => a.name.localeCompare(b.name));
  console.log(`${candidates.length} unstamped:`);
  for (const ref of candidates) console.log(`  ${ref.name}`);

  if (!apply) {
    console.log(
      "\n(dry mode — re-run with --apply to stamp self-referential markers)",
    );
    return;
  }

  let stamped = 0;
  for (const ref of candidates) {
    const base = readSkillSource(ref.dir);
    const skillPath = `${ref.relPath}/SKILL.md`;
    const pointer: OriginPointer = {
      kind: ORIGIN_KIND_GITHUB,
      repo: BUNDLED_REPO,
      sourceUrl: `https://github.com/${BUNDLED_REPO}.git`,
      skillPath,
      installedAt: now,
      fetchedAt: now,
    };
    // Default new markers to `source: "bundled"` — this tool stamps
    // skills the maintainer is intentionally adding to the bundled
    // set. `readSkillSource` returns `source: "yours"` both when the
    // marker file is missing AND when it exists with that value, so
    // we can't distinguish; just write the desired default directly.
    // `--source yours` overrides for the rare personal-skill case.
    writeSkillSource(ref.dir, {
      ...base,
      source: sourceDefault,
      upstream: pointer,
    });
    const baseline = hashSkillFolder(ref.dir);
    if (baseline) writeSyncedHash(ref.dir, baseline);
    stamped++;
  }
  console.log(`\nstamped ${stamped} as self-authored (repo: ${BUNDLED_REPO})`);
  console.log(
    "note: skillFolderHash left blank — first probe will capture it from " +
      "the bundled repo's HEAD",
  );
}

main();
