import {
  readSkillSource,
  writeSkillSource,
  ORIGIN_KIND_GITHUB,
  type OriginPointer,
} from "./source.js";
import { readRuntimeState, writeRuntimeState } from "./heal.js";
import { walkSkills } from "./walk.js";

/**
 * Keep each skill's `origin` truthful against the linked repo's actual
 * layout. A skill whose folder leaf is present in `linkedRepoFolders`
 * genuinely lives in the linked repo, so its origin must point there at
 * its real path — regardless of any stale ancestral pointer (e.g. the
 * third-party repo a skill was originally vendored from before being
 * adopted into the linked repo). Skills not present in the map are
 * genuinely vendored and left untouched.
 *
 * This is the single mechanism that keeps origins correct over time: it
 * runs after each ingestion that gives us the linked tree (push, link/
 * sync), is idempotent, and both prevents drift (a future adopted skill
 * self-corrects) and repairs any historical staleness. When it rewrites
 * a skill's origin to a self-origin, it also clears that skill's runtime
 * probe-failure counter — the skill is no longer a third-party probe
 * target, so a stale counter must not keep surfacing `originUnreachable`.
 */
export interface ReconcileResidentOriginsResult {
  /** Resident skills whose origin was corrected this run. */
  rewritten: string[];
  /** Resident skills whose origin was already correct. */
  unchanged: string[];
  /** Skills not in the linked repo — left as-is (genuinely vendored). */
  vendored: string[];
}

export function reconcileResidentOrigins(
  registryRoot: string,
  linkedRepoFolders: Map<string, string>,
  linkedRepo: string,
): ReconcileResidentOriginsResult {
  const result: ReconcileResidentOriginsResult = {
    rewritten: [],
    unchanged: [],
    vendored: [],
  };

  for (const ref of walkSkills(registryRoot)) {
    const realPath = linkedRepoFolders.get(ref.name);
    if (realPath === undefined) {
      result.vendored.push(ref.name);
      continue;
    }
    const existing = readSkillSource(ref.dir);
    const o = existing.origin;
    if (
      o?.kind === ORIGIN_KIND_GITHUB &&
      o.repo === linkedRepo &&
      o.skillPath === realPath
    ) {
      result.unchanged.push(ref.name);
      continue;
    }
    const origin: OriginPointer = {
      kind: ORIGIN_KIND_GITHUB,
      repo: linkedRepo,
      skillPath: realPath,
    };
    // `installedAt` is the immutable first-install timestamp — carry it
    // through; the stale `skillFolderHash`/`repo` of the prior pointer
    // are deliberately dropped.
    if (existing.origin?.installedAt) {
      origin.installedAt = existing.origin.installedAt;
    }
    writeSkillSource(ref.dir, { ...existing, origin });
    clearProbeFailures(ref.dir);
    result.rewritten.push(ref.name);
  }

  return result;
}

/**
 * Drop the probe-failure fields from a skill's runtime sidecar while
 * preserving `fetchedAt`. A no-op when no failures were recorded.
 */
function clearProbeFailures(skillDir: string): void {
  const rt = readRuntimeState(skillDir);
  if (
    rt.probeFailureCount === undefined &&
    rt.lastProbeFailureAt === undefined
  ) {
    return;
  }
  writeRuntimeState(skillDir, {
    ...(rt.fetchedAt ? { fetchedAt: rt.fetchedAt } : {}),
  });
}
