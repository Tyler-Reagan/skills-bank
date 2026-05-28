#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { walkSkills } from "../packages/core/src/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const skillsDir = path.join(repoRoot, "skills");
const schemaPath = path.join(repoRoot, "docs", "meta-schema.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const validate = ajv.compile(schema);

let failures = 0;
let checked = 0;

if (!fs.existsSync(skillsDir)) {
  console.log("skills/ directory missing; nothing to validate.");
  process.exit(0);
}

const skillRefs = walkSkills(repoRoot).filter(
  (ref) => ref.bucket === "vendored",
);
for (const ref of skillRefs) {
  const folder = ref.dir;
  const metaPath = path.join(folder, "meta.json");
  const rel = path.relative(repoRoot, folder);
  if (!fs.existsSync(metaPath)) {
    console.error(`✖ ${rel}: missing meta.json`);
    failures++;
    continue;
  }
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  } catch (err) {
    console.error(`✖ ${rel}: invalid JSON (${(err as Error).message})`);
    failures++;
    continue;
  }
  checked++;
  if (!validate(data)) {
    console.error(`✖ ${rel}: schema violations`);
    for (const e of validate.errors ?? []) {
      console.error(`    ${e.instancePath} ${e.message}`);
    }
    failures++;
    continue;
  }
  console.log(`✓ ${rel}`);
}

console.log();
console.log(`Validated ${checked} skill(s); ${failures} failure(s).`);
process.exit(failures > 0 ? 1 : 0);
