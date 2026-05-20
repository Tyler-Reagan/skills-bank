import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  externalRegistryPath,
  readExternalRegistry,
  removeExternalRegistryEntry,
} from "./external.js";
import { readSkillSource, writeSkillSource } from "./source.js";

/**
 * Heal helpers. Three bad states the classifier surfaces:
 *
 *   - edited-without-origin     — local copy diverged from synced commit
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
      // Runtime sidecar — fetchedAt etc. Excluded for the same reason
      // as the others: mutates per probe, would force spurious drift
      // detection on every app launch.
      if (ent.name === ".skills-bank-runtime.json") continue;
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
 * Snapshot of the synced-commit hash recorded with the bundled sync.
 * Stored alongside the `.skills-bank.json` source marker so sync
 * writes can persist the post-sync hash that subsequent builds
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
 * Runtime state sidecar. `.skills-bank.json` is the committed Skill
 * record (bundled-repo convention); fields that mutate on every probe
 * — like `fetchedAt` — caused unstaged churn after each app launch
 * (`docs/bug-reports/2026-05-18-fetchedAt-churn.md`). They live here
 * instead, alongside `.skills-bank-hash` in the gitignored set
 * (ADR-0002).
 *
 * Shape is intentionally a JSON object so future runtime fields can
 * extend it without a new sidecar.
 */
const RUNTIME_STATE_FILE = ".skills-bank-runtime.json";

export interface RuntimeState {
  /** ISO-8601 timestamp of the last successful upstream fetch. */
  fetchedAt?: string;
  /**
   * Consecutive failed origin probes for this skill. Reset to 0 on
   * the next successful probe; rate-limit (429) failures are not
   * counted (they don't reflect origin reachability). Drives the
   * `origin-unreachable` drawer state at threshold (see
   * `ORIGIN_UNREACHABLE_THRESHOLD` in `skill-state.ts`). v1.4.
   */
  probeFailureCount?: number;
  /** ISO-8601 timestamp of the most recent probe failure. Diagnostic. */
  lastProbeFailureAt?: string;
}

export function readRuntimeState(skillDir: string): RuntimeState {
  const p = path.join(skillDir, RUNTIME_STATE_FILE);
  if (!fs.existsSync(p)) return {};
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<RuntimeState>;
    const out: RuntimeState = {};
    if (typeof raw.fetchedAt === "string") out.fetchedAt = raw.fetchedAt;
    if (typeof raw.probeFailureCount === "number" && raw.probeFailureCount > 0) {
      out.probeFailureCount = raw.probeFailureCount;
    }
    if (typeof raw.lastProbeFailureAt === "string") {
      out.lastProbeFailureAt = raw.lastProbeFailureAt;
    }
    return out;
  } catch {
    return {};
  }
}

export function writeRuntimeState(
  skillDir: string,
  state: RuntimeState,
): void {
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, RUNTIME_STATE_FILE),
    JSON.stringify(state, null, 2) + "\n",
  );
}

/**
 * Heal action — keep-mine on a edited-without-origin state. Clears
 * the source marker so the skill's `source` becomes "user" going
 * forward and subsequent syncs leave it alone. Idempotent.
 */
export function acceptDriftKeepLocal(skillDir: string): void {
  const src = readSkillSource(skillDir);
  if (src.source !== "curated") return;
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
 * Heal action — clear the per-skill origin pointer on an
 * `edited-with-origin` state. The user keeps their local edits and
 * unlinks the origin so future probes don't surface the skill as
 * having an update available. The source axis (`curated` / `user`)
 * is preserved — this is a per-skill-origin operation, not a
 * registry-level one. Idempotent on skills without an `origin` field.
 *
 * Renamed from `acceptDriftSeverUpstream` in v1.3 to match UL canon.
 */
export function unlinkOrigin(skillDir: string): void {
  const src = readSkillSource(skillDir);
  if (!src.origin) return;
  const next: typeof src = { ...src };
  delete next.origin;
  writeSkillSource(skillDir, next);
  // Drop the synced-hash so the next build doesn't flag this as
  // edited-with-origin again. (The drift gate in build.ts
  // checks `source.origin` and `source.source === "curated"`;
  // with origin cleared and source unchanged, drift detection
  // disengages for non-curated skills.)
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
 * @deprecated v1.3 — renamed to `unlinkOrigin`. Removal targeted
 * for v1.4. Behavior identical.
 */
export const acceptDriftSeverUpstream = unlinkOrigin;

/**
 * Heal action — revert on a edited-without-origin state. The user
 * acknowledges that the current on-disk content is the curated
 * baseline going forward: re-snapshot the hash so the next build
 * sees no drift. Source marker stays `curated` — Sync still owns
 * the skill and would still overwrite on the next pull.
 *
 * Distinct from acceptDriftKeepLocal (which flips source to `user`
 * and detaches from Sync entirely). Use this when the drift
 * indicator surfaced after a sync but the post-sync state is what
 * you want — clearing the indicator without reclassifying the skill.
 */
export function acceptDriftTakeCanonical(skillDir: string): void {
  const src = readSkillSource(skillDir);
  if (src.source !== "curated") return;
  const h = hashSkillFolder(skillDir);
  if (h) writeSyncedHash(skillDir, h);
}

/**
 * Heal action — repoint a non-adopted external entry whose target has
 * moved. Validates the new target exists and contains a SKILL.md, then
 * rewrites the external.json row in place (preserving `registeredAt`).
 * No-op for adopted entries — those have no external.json row to
 * repoint; the user should re-register them instead.
 */
export function repointExternalEntry(
  registryRoot: string,
  name: string,
  newTarget: string,
): { ok: boolean; message: string } {
  if (!fs.existsSync(newTarget)) {
    return { ok: false, message: `path does not exist: ${newTarget}` };
  }
  if (!fs.statSync(newTarget).isDirectory()) {
    return { ok: false, message: `not a directory: ${newTarget}` };
  }
  if (!fs.existsSync(path.join(newTarget, "SKILL.md"))) {
    return {
      ok: false,
      message: `no SKILL.md found at: ${newTarget}`,
    };
  }
  const list = readExternalRegistry(registryRoot);
  const entry = list.find((e) => e.name === name);
  if (!entry) {
    return {
      ok: false,
      message: `no external entry for ${name} — adopted entries can't be repointed`,
    };
  }
  const next = list.map((e) =>
    e.name === name ? { ...e, target: newTarget } : e,
  );
  const p = externalRegistryPath(registryRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
  return { ok: true, message: `repointed ${name} → ${newTarget}` };
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
