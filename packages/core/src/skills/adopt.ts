import { applyRegistration, scanExistingInstalls } from "./register.js";
import type { InstalledKind, InstalledSkill } from "../shared/types.js";

/**
 * Adopt an npx-installed skill into skills-bank's registry (issue #193 —
 * the cross-machine hinge of the npx-interop spec #188). npx *acquired*
 * the skill; skills-bank now *versions and carries* it.
 *
 * This is a thin wrapper over the ordinary Register path (ADR-0022 —
 * Registered ⇔ files live under `skills/`): `applyRegistration({type:
 * "register"})` moves the skill's real content into `skills/personal/<name>`,
 * converges every agent-dir symlink onto the in-bank copy, and — since #200 —
 * leaves npx's canonical store (`.agents/skills/`) untouched rather than
 * recreating a link there. Origin backfill is NOT done here either: it falls
 * out of the caller's post-mutation reconcile, which recovers the origin from
 * npx's global lockfile by name (#191). So adopt adds nothing to Register
 * beyond scan + eligibility guards.
 */
export interface AdoptResult {
  ok: boolean;
  message: string;
}

const KIND_RANK: Record<InstalledKind, number> = {
  "real-directory": 4,
  ours: 3,
  "foreign-symlink": 2,
  "broken-symlink": 1,
};

export function adoptNpxSkill(registryRoot: string, name: string): AdoptResult {
  const report = scanExistingInstalls(registryRoot);
  // Pick the strongest scan entry for this name. npx installs its real
  // content into the canonical store (`.agents/skills/<name>`, a
  // real-directory) and symlinks the agent dirs at it, so the real
  // directory (rank 4) is what we want to move — the same kindRank dedup
  // the bulk-register handler uses.
  let entry: InstalledSkill | undefined;
  for (const e of report.entries) {
    if (e.name !== name) continue;
    if (!entry || KIND_RANK[e.kind] > KIND_RANK[entry.kind]) entry = e;
  }
  if (!entry) {
    return {
      ok: false,
      message: `no installed skill named "${name}" found to adopt`,
    };
  }
  if (entry.kind === "ours") {
    return { ok: false, message: `"${name}" is already in the registry` };
  }

  const result = applyRegistration(
    entry,
    { type: "register", name },
    { registryRoot, confirmDestructive: true },
  );
  return { ok: result.ok, message: result.message };
}
