import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ignore, { type Ignore } from "ignore";
import { findSkillFolder, walkSkills } from "./walk.js";
import { moveSkillBucket } from "./bucket-move.js";
import { readLiveManifest, writeLiveManifest } from "../manifest/manifest.js";
import { setRuntimeEntry, removeRuntimeEntry } from "./runtime-map.js";
import {
  OP_JOURNAL_FILE,
  writeOpJournal,
  clearOpJournal,
  readOpJournal,
} from "./op-journal.js";
export {
  OP_JOURNAL_FILE,
  writeOpJournal,
  clearOpJournal,
  readOpJournal,
} from "./op-journal.js";
export type { OpJournal } from "./op-journal.js";

/**
 * Heal helpers. Three bad states the classifier surfaces:
 *
 *   - edited-without-origin     — local copy diverged, no remote origin
 *   - registry-folder-missing  — name in prior index but skills/<name>/ gone
 *   - external-target-missing  — external entry whose target path is gone
 *
 * Heal-action functions live here so the IPC layer doesn't reach
 * into multiple core files for a single user-facing operation.
 */

/**
 * Stable content hash for a skill folder: SHA-256 over a sorted list
 * of `<relative-path>\n<file-sha256>` lines. Symlinks recorded by
 * target (link content, not realpath), so editing the link target
 * registers as drift without dereferencing.
 *
 * Caps total bytes hashed at 8 MB to keep this cheap on every index
 * build. Folders larger than that fall back to "untracked" (returns
 * null) — drift on huge skills is unlikely and a slow build is
 * worse than skipping the check.
 *
 * Honors the skill's own root `.gitignore`: paths the skill declares
 * ignorable (e.g. `node_modules/`, build/test output) are excluded
 * from the hash. Without this, a skill that installs deps or writes
 * artifacts into its own folder at runtime drifts to "edited" on the
 * next index build even though its tracked content is untouched. Only
 * the skill-root `.gitignore` is read — nested gitignores are rare in
 * skills and not worth the re-rooting complexity.
 */
const HASH_BYTE_BUDGET = 8 * 1024 * 1024;

// Build a matcher from the skill-root `.gitignore`. A missing or
// unreadable file yields a matcher that ignores nothing, so the hash
// behaves exactly as it did before for skills without a `.gitignore`.
function buildSkillIgnore(skillDir: string): Ignore {
  const ig = ignore();
  try {
    ig.add(fs.readFileSync(path.join(skillDir, ".gitignore"), "utf8"));
  } catch {
    // No (readable) .gitignore — match nothing.
  }
  return ig;
}

export function hashSkillFolder(skillDir: string): string | null {
  if (!fs.existsSync(skillDir)) return null;
  const ig = buildSkillIgnore(skillDir);
  const parts: string[] = [];
  let bytes = 0;
  function walk(dir: string, rel: string): boolean {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return true;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      // Op journal — transient crash-recovery state. Never part of skill
      // content; a leftover journal must not trigger drift.
      if (ent.name === OP_JOURNAL_FILE) continue;
      const abs = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
      // Prune ignored directories (tested with a trailing slash so
      // dir-only patterns like `node_modules/` match) and skip ignored
      // files. The `.gitignore` itself is never ignored, so editing it
      // still registers as drift.
      if (ent.isDirectory() ? ig.ignores(`${r}/`) : ig.ignores(r)) continue;
      if (ent.isSymbolicLink()) {
        const target = fs.readlinkSync(abs);
        parts.push(`${r}\tL:${target}`);
        bytes += target.length;
      } else if (ent.isDirectory()) {
        if (!walk(abs, r)) return false;
      } else if (ent.isFile()) {
        let stat: fs.Stats;
        try {
          stat = fs.statSync(abs);
        } catch {
          continue;
        }
        bytes += stat.size;
        if (bytes > HASH_BYTE_BUDGET) return false;
        const h = crypto.createHash("sha256");
        try {
          h.update(fs.readFileSync(abs));
        } catch {
          continue;
        }
        parts.push(`${r}\tF:${h.digest("hex")}`);
      }
    }
    return true;
  }
  const ok = walk(skillDir, "");
  if (!ok) return null;
  return crypto.createHash("sha256").update(parts.join("\n")).digest("hex");
}

/**
 * Boot scan — walk all skill dirs and resolve any leftover op journals.
 * Called on app boot before the first index build so stale journals from
 * a prior crash don't produce misleading index state.
 *
 * Resolution strategy per op:
 *
 * - `move`: the folder is at `to` bucket → move completed; clear journal.
 *   Still at `from` bucket → rename never ran; clear journal (the caller
 *   can retry if needed — the structural state is consistent).
 * - `detachOrigin`: the manifest row's origin is already `url: null` →
 *   completed; clear journal. Row still carries a URL → the write
 *   sequence was interrupted; clear journal anyway (the manifest row is
 *   authoritative — partial runtime-counter resets are idempotent on the
 *   next detach call).
 *
 * Returns the names of skills whose journals were resolved.
 */
export function scanAndResolveOpJournals(registryRoot: string): string[] {
  const resolved: string[] = [];
  const manifest = readLiveManifest(registryRoot);
  for (const ref of walkSkills(registryRoot)) {
    const journal = readOpJournal(ref.dir);
    if (!journal) continue;

    if (journal.op === "move") {
      const toDir = journal.to
        ? path.join(registryRoot, "skills", journal.to, journal.skill)
        : null;
      if (toDir && fs.existsSync(toDir)) {
        clearOpJournal(toDir);
      } else {
        clearOpJournal(ref.dir);
      }
      resolved.push(journal.skill);
    } else if (journal.op === "detachOrigin") {
      clearOpJournal(ref.dir);
      resolved.push(journal.skill);
      void manifest;
    } else {
      clearOpJournal(ref.dir);
      resolved.push(journal.skill);
    }
  }
  return resolved;
}

/**
 * Heal action — forget a `registry-folder-missing` entry: the skill's
 * manifest row survives but its folder under `skills/` is gone. Drop the
 * manifest row + runtime state so the entry stops being surfaced; the
 * next index build omits it naturally.
 */
export function forgetMissingEntry(
  registryRoot: string,
  name: string,
): { ok: boolean; message: string } {
  const manifest = readLiveManifest(registryRoot);
  const next = manifest.skills.filter((s) => s.name !== name);
  if (next.length !== manifest.skills.length) {
    writeLiveManifest(registryRoot, { ...manifest, skills: next });
  }
  removeRuntimeEntry(registryRoot, name);
  return { ok: true, message: `forgot ${name}` };
}

export interface DetachOriginResult {
  ok: boolean;
  message: string;
  /** Ids of agent dirs whose symlink was repointed by the rehome. */
  relinked: string[];
}

/**
 * Restore action (ADR-0012) — sever a skill's origin and rehome it as a
 * local skill. Used when an origin is unreachable and the user keeps the
 * skill, and as the drift "keep my edits" action on `edited-with-origin`.
 *
 * Sets the manifest row's `origin.url` to `null` — provenance now reads
 * as a local skill, no remote. Runtime probe counters are cleared and the
 * content hash re-baselined (`syncedHash`) so the now-local copy starts
 * clean (the drift case). Finally the folder is moved
 * `vendored/ → personal/` via `moveSkillBucket`, keeping disk and the
 * manifest in agreement. A detached (`url: null`) skill is excluded from
 * the pushed manifest projection (`toPushedProjection`), so it is
 * local-only until adopted into the linked repo.
 */
export function detachOrigin(
  registryRoot: string,
  name: string,
): DetachOriginResult {
  const ref = findSkillFolder(registryRoot, name);
  if (!ref) {
    return {
      ok: false,
      message: `${name} not found in any bucket`,
      relinked: [],
    };
  }

  writeOpJournal(ref.dir, {
    op: "detachOrigin",
    skill: name,
    startedAt: new Date().toISOString(),
  });

  const manifest = readLiveManifest(registryRoot);
  const idx = manifest.skills.findIndex((s) => s.name === name);
  if (idx >= 0) {
    manifest.skills[idx] = {
      ...manifest.skills[idx]!,
      origin: { url: null },
    };
  } else {
    manifest.skills.push({
      name,
      origin: { url: null },
      category: null,
      tags: [],
    });
  }
  writeLiveManifest(registryRoot, manifest);

  setRuntimeEntry(registryRoot, name, {
    probeFailureCount: undefined,
    lastProbeFailureAt: undefined,
  });

  const baseline = hashSkillFolder(ref.dir);
  if (baseline) setRuntimeEntry(registryRoot, name, { syncedHash: baseline });

  const moved = moveSkillBucket(registryRoot, name, "personal");
  clearOpJournal(moved.newDir ?? ref.dir);
  return {
    ok: true,
    message: `detached ${name} — now a local skill in personal`,
    relinked: moved.relinked,
  };
}

export interface RepointOriginTarget {
  repo: string;
  skillPath: string;
  sourceUrl?: string;
}

/**
 * Restore action (ADR-0012) — repoint a skill's origin at a new GitHub
 * location the user supplied (the upstream was renamed/moved or the skill
 * folder relocated). Writes the new origin URL into the manifest row,
 * then delegates to `applySkillUpdate` to re-fetch / validate
 * frontmatter / rebaseline / roll back content on failure. On failure
 * the prior row is restored so a bad target leaves no broken pointer
 * behind. Stays in `vendored/`.
 *
 * `applySkillUpdate` is lazy-imported to keep heal.ts (and its many
 * consumers) clear of the heavy build/sync graph that origin.ts pulls in.
 */
export async function repointOrigin(
  registryRoot: string,
  name: string,
  target: RepointOriginTarget,
  token: string | null,
): Promise<import("../github/origin.js").SkillUpdateResult> {
  const ref = findSkillFolder(registryRoot, name);
  if (!ref) {
    return { ok: false, message: `${name} not found in any bucket` };
  }

  const manifest = readLiveManifest(registryRoot);
  const idx = manifest.skills.findIndex((s) => s.name === name);
  const existing = idx >= 0 ? manifest.skills[idx]! : undefined;
  const url = target.sourceUrl ?? `https://github.com/${target.repo}`;
  const nextRow = {
    name,
    origin: { url, skillPath: target.skillPath },
    category: existing?.category ?? null,
    tags: existing?.tags ?? [],
  };
  if (idx >= 0) manifest.skills[idx] = nextRow;
  else manifest.skills.push(nextRow);
  writeLiveManifest(registryRoot, manifest);

  const { applySkillUpdate } = await import("../github/origin.js");
  const result = await applySkillUpdate({ registryRoot, name, token });
  if (!result.ok) {
    // Re-fetch from the new origin failed; restore the prior row so a
    // bad repoint target doesn't strand the skill on a broken pointer.
    const restored = readLiveManifest(registryRoot);
    const i = restored.skills.findIndex((s) => s.name === name);
    if (existing) {
      if (i >= 0) restored.skills[i] = existing;
      else restored.skills.push(existing);
    } else if (i >= 0) {
      restored.skills.splice(i, 1);
    }
    writeLiveManifest(registryRoot, restored);
  }
  return result;
}
