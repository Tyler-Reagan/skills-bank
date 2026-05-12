import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readExternalRegistry, removeExternalRegistryEntry } from "./external.js";
import { readSkillSource, writeSkillSource } from "./source.js";

/**
 * M6 heal helpers. Three new bad states the classifier surfaces:
 *
 *   - canon-drift           — local copy diverged from synced commit
 *   - registry-folder-missing — name in prior index but skills/<name>/ gone
 *   - external-target-missing — external entry whose target path is gone
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
 */
const HASH_BYTE_BUDGET = 8 * 1024 * 1024;

export function hashSkillFolder(skillDir: string): string | null {
  if (!fs.existsSync(skillDir)) return null;
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
      // Skip the app-state sidecars — `.skills-bank.json` (source +
      // syncedAt timestamps) and `.skills-bank-hash` (the recorded
      // post-sync hash itself). Including either makes drift fire
      // spuriously: `.skills-bank.json` because syncedAt changes per
      // pull; `.skills-bank-hash` because sync writes it AFTER
      // computing the hash, so the next build's walk sees the hash
      // file in-tree and the comparison never matches.
      if (ent.name === ".skills-bank.json") continue;
      if (ent.name === ".skills-bank-hash") continue;
      const abs = path.join(dir, ent.name);
      const r = rel ? `${rel}/${ent.name}` : ent.name;
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
 * Snapshot of the synced-commit hash recorded with the canonical
 * sync. Stored alongside the `.skills-bank.json` source marker so
 * sync writes can persist the post-sync hash that subsequent builds
 * compare against.
 */
const SYNCED_HASH_FILE = ".skills-bank-hash";

export function readSyncedHash(skillDir: string): string | null {
  const p = path.join(skillDir, SYNCED_HASH_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return fs.readFileSync(p, "utf8").trim() || null;
  } catch {
    return null;
  }
}

export function writeSyncedHash(skillDir: string, hash: string): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, SYNCED_HASH_FILE), hash + "\n");
}

/**
 * Heal action — keep-mine on a canon-drift state. Clears the source
 * marker so the skill's `source` becomes "user" going forward and
 * subsequent syncs leave it alone. Idempotent.
 */
export function acceptDriftKeepLocal(skillDir: string): void {
  const src = readSkillSource(skillDir);
  if (src.source !== "canonical") return;
  writeSkillSource(skillDir, { source: "user" });
  // Drop the synced-hash so the next build doesn't flag this as
  // drift again.
  const hashPath = path.join(skillDir, SYNCED_HASH_FILE);
  if (fs.existsSync(hashPath)) {
    try {
      fs.unlinkSync(hashPath);
    } catch {
      // ignore
    }
  }
}

/**
 * Heal action — take-canonical on a canon-drift state. The user
 * acknowledges that the current on-disk content is the canonical
 * baseline going forward: re-snapshot the hash so the next build
 * sees no drift. Source marker stays `canonical` — Sync still owns
 * the skill and would still overwrite on the next pull.
 *
 * Distinct from acceptDriftKeepLocal (which flips source to user
 * and detaches from Sync entirely). Use this when the drift
 * indicator surfaced after a sync but the post-sync state is what
 * you want — clearing the indicator without reclassifying the skill.
 */
export function acceptDriftTakeCanonical(skillDir: string): void {
  const src = readSkillSource(skillDir);
  if (src.source !== "canonical") return;
  const h = hashSkillFolder(skillDir);
  if (h) writeSyncedHash(skillDir, h);
}

/**
 * Heal action — forget a missing or broken entry. Removes the entry
 * from external.json (non-adopted) and any persisted index reference;
 * the next buildRegistryIndex omits it naturally.
 */
export function forgetMissingEntry(
  registryRoot: string,
  name: string,
): { ok: boolean; message: string } {
  // Non-adopted entries live in external.json.
  const ext = readExternalRegistry(registryRoot);
  if (ext.find((e) => e.name === name)) {
    removeExternalRegistryEntry(registryRoot, name);
    return {
      ok: true,
      message: `forgot ${name} (external entry removed)`,
    };
  }
  // Adopted entries with missing folders aren't tracked in external;
  // they live in the prior index.json. The next index build won't
  // include them because the folder is gone — nothing to do here.
  return {
    ok: true,
    message: `forgot ${name}`,
  };
}
