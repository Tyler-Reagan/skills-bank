import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { hashSkillFolder } from "./heal.js";
import { readRuntimeMap } from "./runtime-map.js";
import { parseSkillFrontmatter } from "./frontmatter.js";
import { readSkillMeta, walkSkills } from "./walk.js";
import { readLiveManifest, type ManifestOrigin } from "../manifest/manifest.js";
import { isGithubUrl } from "../github/url.js";
import { ORIGIN_UNREACHABLE_THRESHOLD } from "../shared/skill-state.js";
import type {
  RegistryEntry,
  RegistryIndex,
  SkillMeta,
} from "../shared/types.js";

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
  /**
   * Strict mode: drop entries whose SKILL.md frontmatter fails schema
   * validation, and drop folders with no usable frontmatter at all.
   * (meta.json is gone as of v1.20 — frontmatter is canonical.)
   * Defaults to false — UI consumers should see every skill folder, even
   * imperfectly described ones, with warnings attached so the user can
   * fix the metadata in place.
   */
  strict?: boolean;
  /**
   * Restrict to a subset of buckets. Defaults to all buckets
   * (`["personal", "vendored"]`). Pass `["vendored"]` in CI scripts to
   * prevent untracked `skills/personal/` content from landing in the
   * committed `index.json`.
   */
  buckets?: import("./walk.js").SkillBucket[];
}

interface SchemaValidator {
  (data: unknown): boolean;
  errors?: Array<{
    instancePath: string;
    message?: string;
    keyword?: string;
    params?: Record<string, unknown>;
  }> | null;
}

let cachedValidator: SchemaValidator | null = null;

function loadValidator(registryRoot: string): SchemaValidator | null {
  if (cachedValidator) return cachedValidator;
  const schemaPath = path.join(
    registryRoot,
    "docs",
    "skill-frontmatter-schema.json",
  );
  if (!fs.existsSync(schemaPath)) return null;
  try {
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const compiled = ajv.compile(
      JSON.parse(fs.readFileSync(schemaPath, "utf8")),
    ) as unknown as SchemaValidator;
    cachedValidator = compiled;
    return compiled;
  } catch {
    return null;
  }
}

const NULL_ORIGIN: ManifestOrigin = { url: null };

/**
 * Walk `<registryRoot>/skills/<bucket>/<name>/SKILL.md` frontmatter and
 * produce a RegistryIndex in memory. Synchronous and dependency-free at
 * runtime so it can be called from the Electron main process without a
 * subprocess.
 *
 * PURE READ (ADR-0020/0021): joins folder existence + bucket (`walkSkills`)
 * with the live manifest row (identity, origin, labels) and the runtime map
 * (volatile drift/unreachable flags). Never writes the manifest — orphan
 * folders (no manifest row) are synthesized in-memory as `origin: {url:
 * null}` so the index is whole without persisting. `reconcileFoldersToManifest`
 * is the only manifest-write seam.
 *
 * Lenient by default: a folder whose frontmatter is incomplete or
 * fails schema validation still becomes an entry (with warnings). This
 * matches the user expectation that every folder under skills/ is visible,
 * regardless of metadata polish. Pass `strict: true` (CI / authoring) to
 * fail closed instead.
 */
export function buildRegistryIndex(
  registryRoot: string,
  opts: BuildIndexOptions = {},
): RegistryIndex {
  const skillsDir = path.join(registryRoot, "skills");
  const validate = loadValidator(registryRoot);
  const entries: RegistryEntry[] = [];
  // M6: read the prior persisted index so we can surface missing-
  // folder entries (registered names that don't exist on disk anymore).
  // Read happens BEFORE we potentially overwrite below.
  const priorNames = readPriorIndexNames(registryRoot);
  const manifest = readLiveManifest(registryRoot);
  const manifestByName = new Map(manifest.skills.map((s) => [s.name, s]));
  const runtimeMap = readRuntimeMap(registryRoot);

  if (fs.existsSync(skillsDir)) {
    const allRefs = walkSkills(registryRoot);
    const skillRefs = opts.buckets
      ? allRefs.filter((r) => (opts.buckets as string[]).includes(r.bucket))
      : allRefs;
    for (const ref of skillRefs) {
      const row = manifestByName.get(ref.name);
      const built = buildOneEntry(
        registryRoot,
        ref.dir,
        ref.name,
        validate,
        opts,
        row?.origin ?? NULL_ORIGIN,
      );
      if (built) {
        built.bucket = ref.bucket;
        applyRuntimeState(built, ref.dir, runtimeMap[ref.name]);
        entries.push(built);
      }
    }
  }

  // Surface missing entries — names that the prior persisted index knew
  // about but whose folders under skills/ are gone now. The user gets a
  // Heal flow (registry-folder-missing) on these instead of having them
  // silently disappear.
  const live = new Set(entries.map((e) => e.name));
  for (const prior of priorNames) {
    if (live.has(prior.name)) continue;
    entries.push({
      name: prior.name,
      description: "(files missing)",
      path: prior.path,
      origin: manifestByName.get(prior.name)?.origin ?? NULL_ORIGIN,
      missing: true,
      ...(prior.bucket ? { bucket: prior.bucket } : {}),
    });
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

/**
 * Fold the runtime map's volatile state into a built entry: drift
 * (live hash vs the recorded `syncedHash` baseline) and
 * origin-unreachable (probe-failure counter saturated for a
 * GitHub-capable origin). Drift only fires once a baseline is
 * recorded — an acquired skill (`origin.url` set) or a detached one
 * (rebaselined at detach time) always has one; a from-scratch local
 * skill with no baseline yet is never flagged.
 */
function applyRuntimeState(
  entry: RegistryEntry,
  skillDir: string,
  runtime: import("./runtime-map.js").RuntimeEntry | undefined,
): void {
  if (!runtime) return;
  if (runtime.syncedHash) {
    const live = hashSkillFolder(skillDir);
    if (live && live !== runtime.syncedHash) entry.drift = true;
  }
  if (
    isGithubUrl(entry.origin.url) &&
    (runtime.probeFailureCount ?? 0) >= ORIGIN_UNREACHABLE_THRESHOLD
  ) {
    entry.originUnreachable = true;
  }
}

function buildOneEntry(
  registryRoot: string,
  skillDir: string,
  folderName: string,
  validate: SchemaValidator | null,
  opts: BuildIndexOptions,
  origin: ManifestOrigin,
): RegistryEntry | null {
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const hasSkillMd = fs.existsSync(skillMdPath);
  const warnings: string[] = [];

  if (!hasSkillMd) {
    // Folder without SKILL.md isn't a skill.
    return null;
  }

  let meta: Partial<SkillMeta> = {};

  // SKILL.md frontmatter via the consolidated parser (handles block
  // scalars, quoted scalars, and inline/block tag arrays).
  if (hasSkillMd) {
    const fm = parseSkillFrontmatter(skillMdPath);
    if (fm && fm["name"] && fm["description"]) {
      const rawFm: Record<string, unknown> = {};
      if (typeof fm["name"] === "string") rawFm["name"] = fm["name"];
      if (typeof fm["description"] === "string")
        rawFm["description"] = fm["description"];
      if (Array.isArray(fm["tags"])) rawFm["tags"] = fm["tags"];
      if (typeof fm["version"] === "string") rawFm["version"] = fm["version"];
      if (typeof fm["author"] === "string") rawFm["author"] = fm["author"];

      if (validate && !validate(rawFm)) {
        if (opts.strict) return null;
        for (const e of validate.errors ?? []) {
          if (
            e.keyword === "required" &&
            (e.params?.["missingProperty"] === "name" ||
              e.params?.["missingProperty"] === "description")
          ) {
            continue;
          }
          warnings.push(
            `SKILL.md frontmatter ${e.instancePath || "/"}: ${e.message}`,
          );
        }
      }

      meta = {
        ...(typeof fm["name"] === "string" ? { name: fm["name"] } : {}),
        ...(typeof fm["description"] === "string"
          ? { description: fm["description"] }
          : {}),
        ...(Array.isArray(fm["tags"]) && fm["tags"].length > 0
          ? { tags: fm["tags"] as string[] }
          : {}),
        ...(typeof fm["version"] === "string"
          ? { version: fm["version"] }
          : {}),
        ...(typeof fm["author"] === "string" ? { author: fm["author"] } : {}),
      };
    }
  }

  if (!meta.name) {
    warnings.push("missing name (using folder name)");
    meta.name = folderName;
  }
  if (!meta.description) {
    warnings.push("missing description");
    meta.description = "";
  }

  const entry: RegistryEntry = {
    name: meta.name,
    description: meta.description,
    ...(meta.tags ? { tags: meta.tags } : {}),
    ...(meta.version ? { version: meta.version } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    path: path.relative(registryRoot, skillDir),
    origin,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  if (opts.includeGitInfo) {
    const lastCommit = getLastCommit(registryRoot, skillDir);
    if (lastCommit) entry.lastCommit = lastCommit;
  }

  return entry;
}

/**
 * Read the names from the persisted `index.json` (last build's
 * output) without rebuilding. Used by buildRegistryIndex to detect
 * adopted entries whose folders went missing since the last
 * successful build. Returns an empty array if no prior index exists
 * or it can't be parsed.
 */
interface PriorIndexEntry {
  name: string;
  path: string;
  bucket?: import("./walk.js").SkillBucket;
}

function readPriorIndexNames(registryRoot: string): PriorIndexEntry[] {
  const p = path.join(registryRoot, "index.json");
  if (!fs.existsSync(p)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as {
      entries?: Array<{
        name?: unknown;
        path?: unknown;
        bucket?: unknown;
        adopted?: unknown;
        missing?: unknown;
      }>;
    };
    if (!Array.isArray(raw.entries)) return [];
    return raw.entries
      .filter(
        (e) =>
          typeof e.name === "string" &&
          // Only adopted entries; non-adopted "missing" surface via
          // external.json. Don't double-count entries that were
          // missing in the prior build either — they're authoritative
          // via the current detection path.
          e.adopted !== false &&
          e.missing !== true,
      )
      .map((e) => {
        const out: PriorIndexEntry = {
          name: e.name as string,
          path:
            typeof e.path === "string" ? e.path : `skills/${e.name as string}`,
        };
        if (e.bucket === "personal" || e.bucket === "vendored") {
          out.bucket = e.bucket;
        }
        return out;
      });
  } catch {
    return [];
  }
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
