import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readUpstreamCanonNames } from "./canon.js";
import { readExternalRegistry } from "./external.js";
import { hashSkillFolder, readSyncedHash } from "./heal.js";
import { readHiddenCanonNames } from "./hide.js";
import { readSkillMeta, walkSkills } from "./registry.js";
import { readSkillSource } from "./source.js";
import type {
  PublishState,
  RegistryEntry,
  RegistryIndex,
  SkillMeta,
} from "./types.js";

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
   * Strict mode: drop entries whose meta.json fails schema validation,
   * and drop folders missing both meta.json and SKILL.md frontmatter.
   * Defaults to false — UI consumers should see every skill folder, even
   * imperfectly described ones, with warnings attached so the user can
   * fix the metadata in place.
   */
  strict?: boolean;
}

interface SchemaValidator {
  (data: unknown): boolean;
  errors?: Array<{ instancePath: string; message?: string }> | null;
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
 * Walk `<registryRoot>/skills/<name>/meta.json` and produce a RegistryIndex
 * in memory. Synchronous and dependency-free at runtime so it can be called
 * from the Electron main process without a subprocess.
 *
 * Lenient by default: a folder with only SKILL.md, or one whose meta.json
 * fails schema validation, still becomes an entry (with warnings). This
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
  // Compute publish state for every skill in one batched git pass —
  // cheaper than per-skill git invocations from buildOneEntry.
  const publishStates = computePublishStates(registryRoot);
  // M6: read the prior persisted index so we can surface missing-
  // folder entries (registered names that don't exist on disk anymore).
  // Read happens BEFORE we potentially overwrite below.
  const priorNames = readPriorIndexNames(registryRoot);
  // Resolve canon dynamically: union of the upstream snapshot
  // (convenience persona, written by sync/seed) and skills currently
  // reachable from the registry's upstream branch (power persona,
  // publishState === "pushed"). Either path empty is fine; the union
  // means switching repos always recomputes against the active
  // upstream rather than trusting stale per-skill markers.
  const upstreamCanon = readUpstreamCanonNames(registryRoot);
  const hiddenCanon = readHiddenCanonNames(registryRoot);

  if (fs.existsSync(skillsDir)) {
    const skillRefs = walkSkills(registryRoot);
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
        const ps = publishStates.get(ref.name);
        if (ps) built.publishState = ps;
        built.canon = upstreamCanon.has(ref.name) || ps === "pushed";
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
        // on the source marker (`bundled-skill-edited` vs the
        // upstream-aware `user-edited-with-upstream`).
        if (
          built.source.source === "bundled" ||
          built.source.upstream !== undefined
        ) {
          const recorded = readSyncedHash(ref.dir);
          if (recorded) {
            const live = hashSkillFolder(ref.dir);
            if (live && live !== recorded) built.drift = true;
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
      source: { source: "yours" },
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

function buildOneEntry(
  registryRoot: string,
  skillDir: string,
  folderName: string,
  validate: SchemaValidator | null,
  opts: BuildIndexOptions,
): RegistryEntry | null {
  const metaJsonPath = path.join(skillDir, "meta.json");
  const skillMdPath = path.join(skillDir, "SKILL.md");
  const hasMetaJson = fs.existsSync(metaJsonPath);
  const hasSkillMd = fs.existsSync(skillMdPath);
  const warnings: string[] = [];

  if (!hasMetaJson && !hasSkillMd) {
    if (opts.strict) return null;
    // Folder with neither meta.json nor SKILL.md isn't really a skill.
    // Don't surface it.
    return null;
  }

  let meta: Partial<SkillMeta> = {};
  let metaParseFailed = false;

  if (hasMetaJson) {
    try {
      const raw = JSON.parse(fs.readFileSync(metaJsonPath, "utf8")) as Record<
        string,
        unknown
      >;
      meta = {
        ...(typeof raw["name"] === "string" ? { name: raw["name"] } : {}),
        ...(typeof raw["description"] === "string"
          ? { description: raw["description"] }
          : {}),
        ...(Array.isArray(raw["tags"])
          ? { tags: raw["tags"] as string[] }
          : {}),
        ...(typeof raw["version"] === "string"
          ? { version: raw["version"] }
          : {}),
        ...(typeof raw["author"] === "string" ? { author: raw["author"] } : {}),
      };
      if (validate && !validate(raw)) {
        if (opts.strict) return null;
        for (const e of validate.errors ?? []) {
          warnings.push(`meta.json ${e.instancePath || "/"}: ${e.message}`);
        }
      }
    } catch (err) {
      metaParseFailed = true;
      warnings.push(`meta.json: ${(err as Error).message}`);
      if (opts.strict) return null;
    }
  }

  // Fall back to SKILL.md frontmatter for missing fields.
  if (!meta.name || !meta.description || metaParseFailed) {
    const fm = readSkillMeta(skillDir);
    if (fm) {
      if (!meta.name && fm.name) meta.name = fm.name;
      if (!meta.description && fm.description)
        meta.description = fm.description;
      if (!meta.version && fm.version) meta.version = fm.version;
      if (!meta.author && fm.author) meta.author = fm.author;
    }
  }

  if (!hasMetaJson) {
    warnings.push("missing meta.json (using SKILL.md frontmatter)");
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
    source: readSkillSource(skillDir),
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
      source: { source: "yours" },
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
    source: { source: "yours" },
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

/**
 * Compute the per-skill publish state in one batched git pass:
 *   - "untracked": working-tree has uncommitted changes inside the skill folder
 *   - "draft":     latest commit touching the folder is local-only (not in upstream)
 *   - "pushed":    latest commit is reachable from the upstream branch
 *   - "unknown":   not a git repo, or no upstream configured
 *
 * Returns an empty map (treated as "unknown" by callers) when the
 * registry root isn't a git working tree or git isn't on PATH. We do
 * three execs total — porcelain status, the unpushed SHA list, and a
 * single bulk `git log` — independent of skill count.
 */
function computePublishStates(registryRoot: string): Map<string, PublishState> {
  const out = new Map<string, PublishState>();
  if (!fs.existsSync(path.join(registryRoot, ".git"))) return out;

  const exec = (cmd: string): string | null => {
    try {
      return execSync(cmd, {
        cwd: registryRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch {
      return null;
    }
  };

  // Untracked / modified files under skills/<name>/...
  const porcelain = exec(`git status --porcelain skills/`);
  if (porcelain !== null) {
    for (const line of porcelain.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Status format: "XY path" — path always starts at column 3.
      const filePath = line.slice(3);
      const m = /^skills\/([^/]+)\//.exec(filePath);
      if (m && m[1]) out.set(m[1], "untracked");
    }
  }

  // No upstream → nothing to compare against; everything tracked is "unknown".
  const upstream = exec(`git rev-parse --abbrev-ref @{u}`)?.trim();
  if (!upstream) {
    // Fall back: leave already-set untracked entries; everything else is unknown.
    return out;
  }

  // Set of commits present locally but not in upstream.
  const unpushedRaw = exec(`git rev-list ${upstream}..HEAD`);
  const unpushedSet = new Set<string>(
    (unpushedRaw ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  // Bulk: latest commit per skill folder via name-only diff. Iterate
  // each skill's last commit cheaply. Walks the bucket subtree via
  // walkSkills so we get the right relPath for the git log scope.
  for (const ref of walkSkills(registryRoot)) {
    if (out.has(ref.name)) continue; // already untracked
    const sha = exec(`git log -1 --format=%H -- "${ref.relPath}"`)?.trim();
    if (!sha) {
      // Folder has no commit history → counts as a local edit.
      out.set(ref.name, "untracked");
      continue;
    }
    out.set(ref.name, unpushedSet.has(sha) ? "draft" : "pushed");
  }
  return out;
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
