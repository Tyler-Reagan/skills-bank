#!/usr/bin/env tsx
//
// Maintainer-internal: pull a locally-edited skill from
// ~/.claude/skills/<name>/ back into this repo under either
// skills/personal/<name>/ or skills/vendored/<name>/, so the
// maintainer's offline edits land in the bank.
//
// This is the counterpart to `vendor:skill` (which pulls from an
// upstream GitHub repo INTO the bank) and `vendor:refresh` (which
// bulk-refreshes vendored skills against their upstreams). This
// script is the "I edited the deployed copy in ~/.claude/skills/
// and want those edits committed back to the bank" path.
//
// Usage:
//
//   pnpm update:skill <name>              # auto-detect bucket from existing skills/<bucket>/<name>
//   pnpm update:skill <name> --from <path># override source path
//   pnpm update:skill <name> --bucket personal|vendored   # required for new skills
//   pnpm update:skill <name> --dry        # validate + diff preview, no writes
//
// Default source: ~/.claude/skills/<name>/. Bucket auto-detected if
// the skill already exists in exactly one of skills/personal/ or
// skills/vendored/; required explicitly only when adding a new
// skill to the bank.
//
// The script does NOT create commits or branches. It mutates the
// working tree and prints the next steps; you commit by hand. This
// is the maintainer's flow — automation lives in the CI workflows.
//
// After this runs successfully:
//
//   pnpm validate && pnpm build:index
//   git diff -- skills/<bucket>/<name>/
//   git add skills/<bucket>/<name>/ index.json && git commit

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

type Bucket = "personal" | "vendored";

interface Args {
  name: string;
  fromPath: string;
  bucket: Bucket | null;
  dry: boolean;
}

function usage(): never {
  console.error(
    "usage: pnpm update:skill <name> [--from <path>] [--bucket personal|vendored] [--dry]",
  );
  process.exit(1);
}

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  if (argv.length === 0) usage();
  const name = argv[0]!;
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    console.error(`invalid skill name: ${name} (must match meta.json pattern)`);
    usage();
  }
  let fromPath = "";
  let bucket: Bucket | null = null;
  let dry = false;
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") fromPath = argv[++i] ?? "";
    else if (a === "--bucket") {
      const b = argv[++i];
      if (b !== "personal" && b !== "vendored") {
        console.error(`--bucket must be personal or vendored (got ${b})`);
        usage();
      }
      bucket = b;
    } else if (a === "--dry") dry = true;
    else if (a === "--help" || a === "-h") usage();
    else {
      console.error(`unknown arg: ${a}`);
      usage();
    }
  }
  if (!fromPath) {
    fromPath = path.join(os.homedir(), ".claude", "skills", name);
  }
  return { name, fromPath, bucket, dry };
}

// Resolve which bucket the skill belongs to. If exactly one of
// personal/vendored already has it, that's the answer. If both
// have it we refuse (shouldn't happen — `pnpm build:index` enforces
// cross-bucket uniqueness — but a stale state is possible). If
// neither has it, the user must pass --bucket explicitly: this
// path is "adding a new skill," not "updating in place."
function resolveBucket(name: string, requested: Bucket | null): Bucket {
  const inPersonal = fs.existsSync(
    path.join(repoRoot, "skills", "personal", name),
  );
  const inVendored = fs.existsSync(
    path.join(repoRoot, "skills", "vendored", name),
  );
  if (inPersonal && inVendored) {
    console.error(
      `✖ ${name} exists in both personal and vendored — refusing to guess. ` +
        `Resolve the collision first.`,
    );
    process.exit(1);
  }
  const existing: Bucket | null = inPersonal
    ? "personal"
    : inVendored
      ? "vendored"
      : null;
  if (existing && requested && requested !== existing) {
    console.error(
      `✖ ${name} already lives in skills/${existing}/ — refusing to move it ` +
        `to skills/${requested}/ as a side effect of this script.`,
    );
    process.exit(1);
  }
  if (existing) return existing;
  if (!requested) {
    console.error(
      `✖ ${name} is new to the bank — pass --bucket personal or --bucket vendored.`,
    );
    process.exit(1);
  }
  return requested;
}

function validateSourceFolder(
  folder: string,
): { ok: true } | { ok: false; reason: string } {
  if (!fs.existsSync(folder)) {
    return { ok: false, reason: `source folder not found: ${folder}` };
  }
  if (!fs.statSync(folder).isDirectory()) {
    return { ok: false, reason: `source path is not a directory: ${folder}` };
  }
  if (!fs.existsSync(path.join(folder, "SKILL.md"))) {
    return { ok: false, reason: `missing SKILL.md in ${folder}` };
  }
  const metaPath = path.join(folder, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return {
      ok: false,
      reason: `missing meta.json in ${folder} — every bank skill ships one`,
    };
  }
  let meta: unknown;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      reason: `meta.json is invalid JSON: ${(err as Error).message}`,
    };
  }
  const schemaPath = path.join(repoRoot, "docs", "meta-schema.json");
  const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
  const ajv = new (Ajv as unknown as {
    new (opts: object): {
      compile: (s: unknown) => (d: unknown) => boolean;
    };
  })({ allErrors: true, strict: false });
  (addFormats as unknown as (a: unknown) => void)(ajv);
  const validate = ajv.compile(schema);
  if (!validate(meta)) {
    return {
      ok: false,
      reason: `meta.json fails schema validation against docs/meta-schema.json`,
    };
  }
  return { ok: true };
}

// Wipe the destination and copy. Mirrors the semantics of
// mirrorSkillFolder (the vendoring path): files removed at the
// source disappear from the bank too, so the working-tree diff is
// always a faithful before/after of the upstream state. Skips the
// source-side `.skills-bank.json` / `.skills-bank-hash` sidecars —
// those are install-state markers that don't belong in the bank
// copy.
function syncFolder(src: string, dest: string): { copied: number; removed: number } {
  let removed = 0;
  if (fs.existsSync(dest)) {
    // Preserve `.skills-bank.json` and `.skills-bank-hash` on the
    // destination if they exist — those are the bank's provenance
    // markers (set by vendor:skill / seed:source-markers) and must
    // survive a content refresh.
    for (const entry of fs.readdirSync(dest, { withFileTypes: true })) {
      if (
        entry.name === ".skills-bank.json" ||
        entry.name === ".skills-bank-hash"
      ) {
        continue;
      }
      const p = path.join(dest, entry.name);
      fs.rmSync(p, { recursive: true, force: true });
      removed++;
    }
  } else {
    fs.mkdirSync(dest, { recursive: true });
  }
  let copied = 0;
  function walk(s: string, d: string): void {
    fs.mkdirSync(d, { recursive: true });
    for (const entry of fs.readdirSync(s, { withFileTypes: true })) {
      if (
        entry.name === ".skills-bank.json" ||
        entry.name === ".skills-bank-hash"
      ) {
        continue;
      }
      const sp = path.join(s, entry.name);
      const dp = path.join(d, entry.name);
      if (entry.isDirectory()) walk(sp, dp);
      else if (entry.isFile()) {
        fs.copyFileSync(sp, dp);
        copied++;
      } else if (entry.isSymbolicLink()) {
        fs.symlinkSync(fs.readlinkSync(sp), dp);
        copied++;
      }
    }
  }
  walk(src, dest);
  return { copied, removed };
}

function relPath(p: string): string {
  return path.relative(repoRoot, p);
}

function main(): void {
  const args = parseArgs();
  const validation = validateSourceFolder(args.fromPath);
  if (!validation.ok) {
    console.error(`✖ ${validation.reason}`);
    process.exit(1);
  }
  console.log(`✓ Source validates: ${args.fromPath}`);

  const bucket = resolveBucket(args.name, args.bucket);
  const destFolder = path.join(repoRoot, "skills", bucket, args.name);
  console.log(`  → skills/${bucket}/${args.name}/`);

  if (args.dry) {
    console.log(
      "\n--dry: would sync source into destination. Stopping before any write.",
    );
    return;
  }

  const { copied, removed } = syncFolder(args.fromPath, destFolder);
  console.log(
    `\n✓ Synced ${copied} file(s); removed ${removed} pre-existing entr(ies) from destination.`,
  );
  console.log(
    `\nNext steps:\n` +
      `  pnpm validate && pnpm build:index\n` +
      `  git diff -- ${relPath(destFolder)}\n` +
      `  git add ${relPath(destFolder)} index.json && git commit`,
  );
}

main();
