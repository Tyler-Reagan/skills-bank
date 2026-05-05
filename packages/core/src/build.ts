import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { RegistryEntry, RegistryIndex } from "./types.js";

export interface BuildIndexOptions {
  /**
   * Run `git log -1` per skill folder. Off by default (slow on large
   * registries; not needed for runtime UI usage).
   */
  includeGitInfo?: boolean;
  /**
   * If true, write the resulting index to `<registryRoot>/index.json`.
   * The CLI/CI use this; the desktop app doesn't need to (it just consumes
   * the in-memory index).
   */
  writeFile?: boolean;
}

interface SchemaValidator {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
}

let cachedValidator: SchemaValidator | null = null;

function loadValidator(registryRoot: string): SchemaValidator {
  if (cachedValidator) return cachedValidator;
  const schemaPath = path.join(registryRoot, "docs", "meta-schema.json");
  if (!fs.existsSync(schemaPath)) {
    // No schema available — accept everything.
    cachedValidator = (() => true) as SchemaValidator;
    return cachedValidator;
  }
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const compiled = ajv.compile(
    JSON.parse(fs.readFileSync(schemaPath, "utf8")),
  ) as unknown as SchemaValidator;
  cachedValidator = compiled;
  return compiled;
}

/**
 * Walk `<registryRoot>/skills/<category>/<name>/meta.json` and produce a
 * RegistryIndex in memory. This is intentionally synchronous and
 * dependency-free at runtime so it can be called from the Electron main
 * process without spawning a subprocess.
 */
export function buildRegistryIndex(
  registryRoot: string,
  opts: BuildIndexOptions = {},
): RegistryIndex {
  const skillsDir = path.join(registryRoot, "skills");
  const validate = loadValidator(registryRoot);
  const entries: RegistryEntry[] = [];

  if (fs.existsSync(skillsDir)) {
    for (const cat of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!cat.isDirectory()) continue;
      const catDir = path.join(skillsDir, cat.name);
      for (const sk of fs.readdirSync(catDir, { withFileTypes: true })) {
        if (!sk.isDirectory()) continue;
        const skillDir = path.join(catDir, sk.name);
        const metaPath = path.join(skillDir, "meta.json");
        if (!fs.existsSync(metaPath)) continue;
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(fs.readFileSync(metaPath, "utf8"));
        } catch {
          continue;
        }
        if (!validate(data)) continue;
        const entry: RegistryEntry = {
          name: String(data["name"] ?? sk.name),
          description: String(data["description"] ?? ""),
          ...(typeof data["domain"] === "string" ? { domain: data["domain"] } : {}),
          ...(Array.isArray(data["tags"]) ? { tags: data["tags"] as string[] } : {}),
          ...(typeof data["version"] === "string" ? { version: data["version"] } : {}),
          ...(typeof data["author"] === "string" ? { author: data["author"] } : {}),
          category: cat.name,
          path: path.relative(registryRoot, skillDir),
        };
        if (opts.includeGitInfo) {
          const lastCommit = getLastCommit(registryRoot, skillDir);
          if (lastCommit) entry.lastCommit = lastCommit;
        }
        entries.push(entry);
      }
    }
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  const index: RegistryIndex = {
    generatedAt: new Date().toISOString(),
    registry: "skills-bank",
    entries,
  };

  if (opts.writeFile) {
    const indexPath = path.join(registryRoot, "index.json");
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + "\n");
  }

  return index;
}

function getLastCommit(
  registryRoot: string,
  dir: string,
): RegistryEntry["lastCommit"] | undefined {
  try {
    const rel = path.relative(registryRoot, dir);
    const out = execSync(`git log -1 --format="%H|%ai|%s" -- "${rel}"`, {
      cwd: registryRoot,
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
