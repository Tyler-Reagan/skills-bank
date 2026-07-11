import fs from "node:fs";
import path from "node:path";
import { getAgentSkillsDir } from "../shared/agents.js";
import { applyRegistration, scanExistingInstalls } from "./register.js";
import type { InstalledKind, InstalledSkill } from "../shared/types.js";

/**
 * Adopt an npx-installed skill into skills-bank's registry (issue #193 —
 * the cross-machine hinge of the npx-interop spec #188). npx *acquired*
 * the skill; skills-bank now *versions and carries* it.
 *
 * The move-in itself is the ordinary Register path (ADR-0022 — Registered
 * ⇔ files live under `skills/`): `applyRegistration({type:"register"})`
 * moves the skill's real content into `skills/personal/<name>` and
 * converges every agent-dir symlink onto the in-bank copy. Origin backfill
 * is NOT done here — it falls out of the caller's post-mutation reconcile,
 * which recovers the origin from npx's global lockfile by name (#191). So
 * adopt has exactly one job beyond Register: sever npx's canonical-store
 * link (see {@link severSharedAgentsLink}).
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
  if (!result.ok) return { ok: false, message: result.message };

  severSharedAgentsLink(name);
  return { ok: true, message: result.message };
}

/**
 * Register's sweep recreates a symlink at the vacated source location. When
 * that source was npx's canonical store (`.agents/skills/<name>`), the
 * recreated link points from npx's turf into skills-bank's registry — which
 * `npx update` could later clobber, silently double-managing the adopted
 * skill. skills-bank complements npx and never writes its store (#189 /
 * change 1): remove any shared-agents link left behind so npx's lockfile
 * entry simply goes stale (the accepted edge of change 5). Only ever
 * unlinks a symlink — a real directory there is content, not ours to touch.
 */
function severSharedAgentsLink(name: string): void {
  const link = path.join(getAgentSkillsDir("agents"), name);
  let stat: fs.Stats | null = null;
  try {
    stat = fs.lstatSync(link);
  } catch {
    stat = null;
  }
  if (stat?.isSymbolicLink()) fs.unlinkSync(link);
}
