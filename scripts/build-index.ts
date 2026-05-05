#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const skillsDir = path.join(repoRoot, "skills");
const schemaPath = path.join(repoRoot, "docs", "meta-schema.json");
const indexPath = path.join(repoRoot, "index.json");

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(JSON.parse(fs.readFileSync(schemaPath, "utf8")));

interface IndexEntry {
  name: string;
  description: string;
  domain?: string;
  tags?: string[];
  version?: string;
  author?: string;
  category: string;
  path: string;
  lastCommit?: { sha: string; date: string; message: string };
}

const entries: IndexEntry[] = [];

if (fs.existsSync(skillsDir)) {
  for (const cat of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const catDir = path.join(skillsDir, cat.name);
    for (const sk of fs.readdirSync(catDir, { withFileTypes: true })) {
      if (!sk.isDirectory()) continue;
      const skillDir = path.join(catDir, sk.name);
      const metaPath = path.join(skillDir, "meta.json");
      if (!fs.existsSync(metaPath)) {
        console.warn(`skip ${path.relative(repoRoot, skillDir)}: missing meta.json`);
        continue;
      }
      const data = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (!validate(data)) {
        console.error(`invalid meta.json: ${path.relative(repoRoot, metaPath)}`);
        for (const e of validate.errors ?? []) {
          console.error(`  ${e.instancePath} ${e.message}`);
        }
        process.exit(1);
      }
      const entry: IndexEntry = {
        ...(data as Omit<IndexEntry, "category" | "path">),
        category: cat.name,
        path: path.relative(repoRoot, skillDir),
      };
      const lastCommit = getLastCommit(skillDir);
      if (lastCommit) entry.lastCommit = lastCommit;
      entries.push(entry);
    }
  }
}

entries.sort((a, b) => a.name.localeCompare(b.name));

const index = {
  generatedAt: new Date().toISOString(),
  registry: "skills-bank",
  entries,
};

fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
console.log(`Wrote ${path.relative(repoRoot, indexPath)} with ${entries.length} entries.`);

function getLastCommit(dir: string): IndexEntry["lastCommit"] | undefined {
  try {
    const rel = path.relative(repoRoot, dir);
    const out = execSync(`git log -1 --format="%H|%ai|%s" -- "${rel}"`, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (!out) return undefined;
    const [sha, date, ...rest] = out.replace(/^"|"$/g, "").split("|");
    if (!sha || !date) return undefined;
    return { sha, date, message: rest.join("|") };
  } catch {
    return undefined;
  }
}
