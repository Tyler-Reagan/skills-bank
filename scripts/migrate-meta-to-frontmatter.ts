#!/usr/bin/env tsx
/**
 * Migrate skill metadata from meta.json into SKILL.md YAML frontmatter.
 *
 * For each skill folder under skills/vendored/ (and optionally skills/personal/):
 *   1. If SKILL.md already has frontmatter, verify it has at minimum `name`
 *      and `description`. If valid, delete meta.json and move on.
 *   2. If SKILL.md lacks frontmatter (or is missing), inject frontmatter
 *      from meta.json fields at the top of SKILL.md, then delete meta.json.
 *   3. Report any skill that can't be migrated (missing both sources, schema
 *      violations in frontmatter, etc.) without touching it.
 *
 * Run after the script completes:
 *   pnpm validate && pnpm build:index
 *
 * Flags:
 *   --dry    Preview without writing any files.
 *   --bucket personal|vendored   Restrict to one bucket (default: vendored).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  walkSkills,
  parseSkillFrontmatter,
  validateSkillMeta,
} from "../packages/core/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const bucketArg = args.find((a, i) => a === "--bucket" && args[i + 1])
  ? args[args.indexOf("--bucket") + 1]
  : null;
const targetBucket = bucketArg === "personal" ? "personal" : "vendored";

let migrated = 0;
let alreadyMigrated = 0;
let skipped = 0;

const skillRefs = walkSkills(repoRoot).filter(
  (ref) => ref.bucket === targetBucket,
);

if (skillRefs.length === 0) {
  console.log(
    `skills/${targetBucket}/ is empty or missing; nothing to migrate.`,
  );
  process.exit(0);
}

console.log(
  `${dry ? "[DRY RUN] " : ""}Migrating ${skillRefs.length} skill(s) in skills/${targetBucket}/…\n`,
);

for (const ref of skillRefs) {
  const rel = path.relative(repoRoot, ref.dir);
  const skillMdPath = path.join(ref.dir, "SKILL.md");
  const metaJsonPath = path.join(ref.dir, "meta.json");
  const hasSkillMd = fs.existsSync(skillMdPath);
  const hasMetaJson = fs.existsSync(metaJsonPath);

  // Already migrated: frontmatter exists, no meta.json.
  if (!hasMetaJson) {
    const fm = hasSkillMd ? parseSkillFrontmatter(skillMdPath) : null;
    if (fm && fm["name"] && fm["description"]) {
      alreadyMigrated++;
      console.log(`  (skip) ${rel} — already has frontmatter, no meta.json`);
      continue;
    }
    skipped++;
    console.error(
      `  ✖ ${rel} — no meta.json and no usable frontmatter; manual fix required`,
    );
    continue;
  }

  // Read meta.json.
  let metaRaw: Record<string, unknown>;
  try {
    metaRaw = JSON.parse(fs.readFileSync(metaJsonPath, "utf8")) as Record<
      string,
      unknown
    >;
  } catch (err) {
    skipped++;
    console.error(
      `  ✖ ${rel} — meta.json is invalid JSON: ${(err as Error).message}`,
    );
    continue;
  }

  const name = typeof metaRaw["name"] === "string" ? metaRaw["name"] : null;
  const description =
    typeof metaRaw["description"] === "string" ? metaRaw["description"] : null;

  if (!name || !description) {
    skipped++;
    console.error(
      `  ✖ ${rel} — meta.json is missing required name or description`,
    );
    continue;
  }

  // Check if SKILL.md already has valid frontmatter with name + description.
  const existingFm = hasSkillMd ? parseSkillFrontmatter(skillMdPath) : null;
  const fmHasRequired =
    existingFm &&
    typeof existingFm["name"] === "string" &&
    existingFm["name"] &&
    typeof existingFm["description"] === "string" &&
    existingFm["description"];

  if (fmHasRequired) {
    // Frontmatter already covers the required fields; just delete meta.json.
    if (dry) {
      console.log(
        `  ✓ ${rel} — frontmatter already present; would delete meta.json`,
      );
    } else {
      fs.rmSync(metaJsonPath);
      console.log(
        `  ✓ ${rel} — frontmatter already present; deleted meta.json`,
      );
    }
    migrated++;
    continue;
  }

  // Inject frontmatter into SKILL.md (or create it if SKILL.md is absent).
  const tags = Array.isArray(metaRaw["tags"])
    ? (metaRaw["tags"] as string[])
    : [];
  const version =
    typeof metaRaw["version"] === "string" ? metaRaw["version"] : null;
  const author =
    typeof metaRaw["author"] === "string" ? metaRaw["author"] : null;

  const fmLines: string[] = ["---", `name: ${name}`];
  // Wrap description in quotes if it contains special YAML characters.
  const needsQuotes = /[:#\[\]{},|>&*!'"@`]/.test(description);
  fmLines.push(
    `description: ${needsQuotes ? `"${description.replace(/"/g, '\\"')}"` : description}`,
  );
  if (tags.length > 0) fmLines.push(`tags: [${tags.join(", ")}]`);
  if (version) fmLines.push(`version: ${version}`);
  if (author) fmLines.push(`author: ${author}`);
  fmLines.push("---");
  const frontmatter = fmLines.join("\n") + "\n";

  const existingBody = hasSkillMd ? fs.readFileSync(skillMdPath, "utf8") : "";
  const newContent = frontmatter + (existingBody || "");

  if (dry) {
    console.log(`  ✓ ${rel} — would inject frontmatter + delete meta.json`);
    console.log(
      `    frontmatter preview: name=${name}, description=${description.slice(0, 60)}…`,
    );
  } else {
    fs.writeFileSync(skillMdPath, newContent, "utf8");
    fs.rmSync(metaJsonPath);
    console.log(`  ✓ ${rel} — injected frontmatter, deleted meta.json`);
  }
  migrated++;
}

console.log(
  `\n${dry ? "[DRY RUN] " : ""}Done. ${migrated} migrated, ${alreadyMigrated} already migrated, ${skipped} skipped.`,
);
if (skipped > 0) process.exit(1);
