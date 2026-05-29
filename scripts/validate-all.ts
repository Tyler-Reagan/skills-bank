#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkSkills, validateSkillMeta } from "../packages/core/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

let failures = 0;
let checked = 0;

const skillRefs = walkSkills(repoRoot).filter(
  (ref) => ref.bucket === "vendored",
);

if (skillRefs.length === 0) {
  console.log("skills/vendored/ is empty or missing; nothing to validate.");
  process.exit(0);
}

for (const ref of skillRefs) {
  const rel = path.relative(repoRoot, ref.dir);
  const result = validateSkillMeta(ref.dir);
  if (result.ok) {
    checked++;
    console.log(`✓ ${rel}`);
    continue;
  }
  failures++;
  if (result.reason === "missing-frontmatter") {
    console.error(`✖ ${rel}: missing SKILL.md frontmatter`);
  } else {
    console.error(`✖ ${rel}: schema violations`);
    for (const e of result.errors) {
      console.error(`    ${e}`);
    }
  }
}

console.log();
console.log(`Validated ${checked} skill(s); ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
