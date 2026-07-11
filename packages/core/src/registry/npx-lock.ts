import fs from "node:fs";
import path from "node:path";
import { normalizeOriginUrl } from "../github/url.js";
import type { ManifestOrigin } from "../manifest/manifest.js";
import { getRealHome } from "../shared/home.js";

/**
 * Reader for the `npx skills` CLI's global lockfile — the only on-disk
 * signal of where an npx-installed skill came from (the skill folder
 * itself is indistinguishable from a hand-authored one; SKILL.md
 * frontmatter carries no provenance). skills-bank reads this to backfill
 * origin for a `url:null` skill that was installed via npx outside the
 * app, turning it into a portable, syncable manifest row.
 *
 * READ-ONLY, always. skills-bank never writes or reconciles npx's
 * lockfile — that's npx-owned state, and seizing it would break the
 * "complement, not conflict" boundary (see the no-mutation note on
 * `installSkillFiles`/`applySkillUpdate` in `github/origin.ts`). This
 * module exposes no writer by construction.
 *
 * Lockfile shape (vercel-labs/skills `src/skill-lock.ts`, version 3):
 * `{ version, skills: { <skillName>: SkillLockEntry } }`.
 */

interface NpxLockEntry {
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  ref?: string;
  skillPath?: string;
  skillFolderHash?: string;
}

interface NpxLockFile {
  version?: number;
  skills?: Record<string, NpxLockEntry>;
}

/** The `skills` map from the lockfile, keyed by skill name. */
export type NpxLock = Record<string, NpxLockEntry>;

/**
 * Path to npx's global lockfile. Honors `$XDG_STATE_HOME` (npx writes
 * `$XDG_STATE_HOME/skills/.skill-lock.json` when that's set), else
 * `~/.agents/.skill-lock.json`. Resolved against `getRealHome()`, NOT
 * `getIsolatedHome()`: npx always writes the real home regardless of
 * skills-bank's dev isolation, so reading the isolated home would make
 * backfill silently dead in unpackaged dev runs.
 */
export function npxGlobalLockPath(): string {
  const xdg = process.env.XDG_STATE_HOME;
  if (xdg) return path.join(xdg, "skills", ".skill-lock.json");
  return path.join(getRealHome(), ".agents", ".skill-lock.json");
}

/**
 * Read + parse the global lockfile's `skills` map. Returns `{}` on any
 * miss — file absent, unreadable, malformed JSON, or no `skills` object
 * — so callers treat "no npx lockfile" and "empty lockfile" alike.
 */
export function readNpxLock(lockPath: string = npxGlobalLockPath()): NpxLock {
  let raw: string;
  try {
    raw = fs.readFileSync(lockPath, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as NpxLockFile;
    return parsed.skills && typeof parsed.skills === "object"
      ? parsed.skills
      : {};
  } catch {
    return {};
  }
}

/**
 * Map an npx lock entry to a v6 `ManifestOrigin`, or null when there's
 * nothing honest to adopt. Returns null for a genuinely-local entry
 * (`sourceType: "local"`, mirroring `readLegacyOrigin`'s `kind: "none"`
 * guard) or a missing/empty `sourceUrl`, leaving the `url:null` resting
 * state intact. Does NOT filter to GitHub — a GitLab/other `sourceUrl`
 * is a valid honest origin (ADR-0020); GitHub-capability is a probe-time
 * check, not an adoption gate.
 */
export function npxEntryOrigin(
  entry: NpxLockEntry | undefined,
): ManifestOrigin | null {
  if (!entry || entry.sourceType === "local") return null;
  const url = normalizeOriginUrl(entry.sourceUrl ?? null);
  if (!url) return null;
  const origin: ManifestOrigin = { url };
  if (typeof entry.skillPath === "string" && entry.skillPath) {
    origin.skillPath = entry.skillPath;
  }
  if (typeof entry.skillFolderHash === "string" && entry.skillFolderHash) {
    origin.hash = entry.skillFolderHash;
  }
  return origin;
}

/**
 * An npx-installed skill that skills-bank could adopt: present in npx's
 * lockfile but absent from skills-bank's registry. `origin` is the entry
 * mapped through {@link npxEntryOrigin} — a real `{url, …}` when the
 * lockfile records a usable source, or `null` for a genuinely-local
 * entry (`sourceType: "local"` / no `sourceUrl`). A `null` origin does
 * NOT disqualify adoption: the skill still comes under management (as a
 * `url:null` local row); it just carries no upstream to re-fetch from.
 */
export interface AdoptableNpxSkill {
  name: string;
  origin: ManifestOrigin | null;
}

/**
 * The "in npx, not in the registry" set. Given npx's lockfile map and the
 * names already in skills-bank's registry, returns one entry per npx skill
 * whose name is NOT already registered — the adoptable frontier the
 * Discover tab surfaces (issue #192). Pure set difference by name; the
 * actual adopt action (move-in + origin backfill) lands separately (#193).
 * Result is sorted by name for stable rendering.
 */
export function adoptableNpxSkills(
  npxLock: NpxLock,
  existingRegistryNames: Iterable<string>,
): AdoptableNpxSkill[] {
  const registered = new Set(existingRegistryNames);
  return Object.entries(npxLock)
    .filter(([name]) => !registered.has(name))
    .map(([name, entry]) => ({ name, origin: npxEntryOrigin(entry) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
