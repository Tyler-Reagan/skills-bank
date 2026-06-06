import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readUpstreamCanonNames } from "./canon.js";
import { readExternalRegistry } from "./external.js";
import { hashSkillFolder, readSyncedHash } from "./heal.js";
import { readHiddenCanonNames } from "./hide.js";
import { parseSkillFrontmatter } from "./skill-meta.js";
import { readSkillMeta, walkSkills } from "./registry.js";
import { readSkillSource } from "./source.js";
import { readRuntimeState } from "./heal.js";
import { ORIGIN_UNREACHABLE_THRESHOLD } from "./skill-state.js";
import type { RegistryEntry, RegistryIndex, SkillMeta } from "./types.js";

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
  buckets?: import("./registry.js").SkillBucket[];
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
  const schemaPath = path.join(registryRoot, "docs", "meta-schema.json");
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

/**
 * Walk `<registryRoot>/skills/<bucket>/<name>/SKILL.md` frontmatter and
 * produce a RegistryIndex in memory. Synchronous and dependency-free at
 * runtime so it can be called from the Electron main process without a
 * subprocess.
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
  // Canon is computed against the upstream-canon snapshot only here.
  const upstreamCanon = readUpstreamCanonNames(registryRoot);
  const hiddenCanon = readHiddenCanonNames(registryRoot);

  if (fs.existsSync(skillsDir)) {
    const allRefs = walkSkills(registryRoot);
    const skillRefs = opts.buckets
      ? allRefs.filter((r) => (opts.buckets as string[]).includes(r.bucket))
      : allRefs;
    for (const ref of skillRefs) {
      const built = buildOneEntry(
        registryRoot,
        ref.dir,
        ref.name,
        validate,
        opts,
      );
      if (built) {
        built.bucket = ref.bucket;
        // v1.5 (ADR-0008): publish-state-derived canon is layered
        // at the IPC level. Here we set canon only from the
        // upstream-canon snapshot; main.ts unions the publish-state
        // "pushed" set on top via the cached tree-probe path.
        built.canon = upstreamCanon.has(ref.name);
        // Hide flag is only meaningful for canon entries (non-canon
        // skills are just unregisterable). Stale entries in the
        // hidden list for skills that lost canon status get ignored.
        if (built.canon && hiddenCanon.has(ref.name)) built.hidden = true;
        // Drift detection for skills with a recorded baseline hash.
        // Two paths populate `.skills-bank-hash` today: the bundled
        // sync flow (snapshot at sync time) and the upstream-scanner
        // stamp (snapshot at scan time). Either way: live folder hash
        // != stored hash ⇒ the user has edited the skill locally.
        // The classifier distinguishes which heal flow applies based
        // on the source marker (`edited-without-origin` vs the
        // upstream-aware `edited-with-origin`).
        if (
          built.source.source === "curated" ||
          built.source.origin !== undefined
        ) {
          const recorded = readSyncedHash(ref.dir);
          if (recorded) {
            const live = hashSkillFolder(ref.dir);
            if (live && live !== recorded) built.drift = true;
          }
        }
        // Phase 3 (v1.4): surface origin-unreachable when the per-
        // skill probe-failure counter saturates the threshold. Pure
        // read from the runtime sidecar; no extra disk hits since
        // `mergeRuntimeFetchedAt` already consults it.
        if (built.source.origin?.kind === "github") {
          const runtime = readRuntimeState(ref.dir);
          if (
            (runtime.probeFailureCount ?? 0) >= ORIGIN_UNREACHABLE_THRESHOLD
          ) {
            built.originUnreachable = true;
          }
        }
        entries.push(built);
      }
    }
  }

  // M3: merge in non-adopted (symlink-mode) entries from external.json
  // so the renderer sees them in the registry view, not just Installed.
  // Adopted=false means files live at `target`, not under skills/.
  // Local content (publishState, last-commit) doesn't apply.
  const adoptedNames = new Set(entries.map((e) => e.name));
  for (const ext of readExternalRegistry(registryRoot)) {
    if (adoptedNames.has(ext.name)) continue; // adopted wins on name collision
    const built = buildExternalEntry(ext, opts);
    if (built) {
      built.canon = upstreamCanon.has(ext.name);
      entries.push(built);
    }
  }

  // M6: surface missing adopted entries — names that the prior
  // persisted index knew about but whose folders are gone now. The
  // user gets a Heal flow on these instead of having them silently
  // disappear.
  const live = new Set(entries.map((e) => e.name));
  for (const prior of priorNames) {
    if (live.has(prior.name)) continue;
    entries.push({
      name: prior.name,
      description: "(files missing)",
      path: prior.path,
      source: { source: "user" },
      adopted: true,
      missing: true,
      ...(prior.bucket ? { bucket: prior.bucket } : {}),
      ...(upstreamCanon.has(prior.name) ? { canon: true } : {}),
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
 * `fetchedAt` lives in `.skills-bank-runtime.json` (the gitignored
 * runtime sidecar — ADR-0002). The in-memory view stitches it back
 * into `source.origin.fetchedAt` so consumers (drawer display,
 * Settings, etc.) keep reading from the familiar path.
 */
function mergeRuntimeFetchedAt(
  source: import("./source.js").SkillSource,
  skillDir: string,
): import("./source.js").SkillSource {
  if (!source.origin) return source;
  const runtime = readRuntimeState(skillDir);
  // Runtime value is authoritative when present. Fall back to whatever
  // the legacy committed marker carried — old `.skills-bank.json` files
  // that still have `fetchedAt` inline keep working until the next
  // writeSkillSource strips it.
  const fetchedAt = runtime.fetchedAt ?? source.origin.fetchedAt;
  if (fetchedAt === undefined) return source;
  return {
    ...source,
    origin: { ...source.origin, fetchedAt },
  };
}

function buildOneEntry(
  registryRoot: string,
  skillDir: string,
  folderName: string,
  validate: SchemaValidator | null,
  opts: BuildIndexOptions,
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
    source: mergeRuntimeFetchedAt(readSkillSource(skillDir), skillDir),
    // Folders walked from <registryRoot>/skills/ are adopted by
    // definition — the files live in the bank. M3 introduces the
    // non-adopted (external) case alongside this.
    adopted: true,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  if (opts.includeGitInfo) {
    const lastCommit = getLastCommit(registryRoot, skillDir);
    if (lastCommit) entry.lastCommit = lastCommit;
  }

  return entry;
}

/**
 * Build a RegistryEntry for a non-adopted (external) registration.
 * The skill's files live at `ext.target`; we read meta from there so
 * the renderer sees the same description/version/tags as if the
 * skill had been adopted. `adopted: false` and `path` = absolute
 * external path so reveal/open-in-finder work without registryRoot
 * resolution gymnastics.
 *
 * M6: if the external target is gone, return a synthetic entry with
 * `missing: true` so the classifier surfaces an
 * `external-target-missing` heal state instead of silently dropping
 * the entry.
 */
function buildExternalEntry(
  ext: import("./external.js").ExternalEntry,
  opts: BuildIndexOptions,
): RegistryEntry | null {
  if (!fs.existsSync(ext.target)) {
    return {
      name: ext.name,
      description: `(external target missing: ${ext.target})`,
      path: ext.target,
      source: { source: "user" },
      adopted: false,
      missing: true,
    };
  }
  const warnings: string[] = [];
  let meta: Partial<SkillMeta> = {};
  const fm = readSkillMeta(ext.target);
  if (fm) {
    meta = { ...fm };
  }
  if (!meta.name) {
    warnings.push("missing name (using registered name)");
    meta.name = ext.name;
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
    // Absolute path for external entries — renderer falls back to
    // this when composing the reveal-in-finder path.
    path: ext.target,
    source: { source: "user" },
    adopted: false,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
  if (opts.strict && warnings.length > 0) return null;
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
  bucket?: import("./registry.js").SkillBucket;
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
