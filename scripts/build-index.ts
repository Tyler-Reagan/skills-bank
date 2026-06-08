#!/usr/bin/env tsx
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRegistryIndex } from "../packages/core/src/registry/build.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

const index = buildRegistryIndex(repoRoot, {
  includeGitInfo: true,
  writeFile: true,
  buckets: ["vendored"],
});

console.log(`Wrote index.json with ${index.entries.length} entries.`);
