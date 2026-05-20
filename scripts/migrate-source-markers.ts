/**
 * Phase 2 eager migration of committed `.skills-bank.json` markers.
 *
 * Walks `<registryRoot>/skills/{personal,vendored}/*` and rewrites
 * each marker through readSkillSource + writeSkillSource. The
 * tolerant-read in source.ts normalizes legacy values
 * (`bundled`/`yours`) to the new vocabulary (`curated`/`user`) and
 * accepts the legacy `upstream` JSON key as `origin`; the write side
 * emits only the new form. Net effect: every committed marker
 * settles in the post-v1.3 wire format in one PR rather than
 * drip-by-drip as the user touches skills.
 *
 * The marker rewrite preserves all other fields (syncedFromCommit,
 * syncedAt, the full origin pointer's contents).
 *
 * Usage:
 *   pnpm tsx scripts/migrate-source-markers.ts          # in-place
 *   pnpm tsx scripts/migrate-source-markers.ts --dry    # report only
 *   pnpm tsx scripts/migrate-source-markers.ts --root <path>
 */

import fs from "node:fs";
import path from "node:path";
import {
  readSkillSource,
  writeSkillSource,
  walkSkills,
} from "../packages/core/src/index.js";

interface CliArgs {
  root: string;
  dry: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  let root = process.cwd();
  let dry = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") dry = true;
    else if (a === "--root") {
      const next = argv[i + 1];
      if (!next) throw new Error("--root requires a path argument");
      root = path.resolve(next);
      i++;
    }
  }
  return { root, dry };
}

function main(): void {
  const { root, dry } = parseArgs(process.argv.slice(2));
  const refs = walkSkills(root);
  if (refs.length === 0) {
    console.log(`No skills under ${root}/skills/{personal,vendored}/.`);
    return;
  }

  let touched = 0;
  let unchanged = 0;

  for (const ref of refs) {
    const markerPath = path.join(ref.dir, ".skills-bank.json");
    if (!fs.existsSync(markerPath)) {
      // No marker — readSkillSource would default this to user/no-origin.
      // We don't materialize markers that didn't exist before.
      unchanged++;
      continue;
    }
    const before = fs.readFileSync(markerPath, "utf8");
    const parsed = readSkillSource(ref.dir);
    if (dry) {
      // Simulate the write to see whether the marker would change.
      // Cheaper than running writeSkillSource on a scratch dir.
      const wouldWrite = JSON.stringify(stripFetchedAt(parsed), null, 2) + "\n";
      if (wouldWrite !== before) {
        touched++;
        console.log(`would migrate: ${ref.relPath}`);
      } else {
        unchanged++;
      }
      continue;
    }
    writeSkillSource(ref.dir, parsed);
    const after = fs.readFileSync(markerPath, "utf8");
    if (after !== before) {
      touched++;
      console.log(`migrated: ${ref.relPath}`);
    } else {
      unchanged++;
    }
  }

  console.log(
    `\n${dry ? "(dry) " : ""}${touched} migrated, ${unchanged} already settled.`,
  );
}

// Mirror writeSkillSource's runtime-fetchedAt strip so the dry-run
// projection matches what writeSkillSource would actually serialize.
function stripFetchedAt<T extends { origin?: { fetchedAt?: string } }>(
  src: T,
): T {
  if (!src.origin || !("fetchedAt" in src.origin)) return src;
  const { fetchedAt: _drop, ...rest } = src.origin;
  void _drop;
  return { ...src, origin: rest } as T;
}

main();
