import fs from "node:fs";
import path from "node:path";
import { hashSkillFolder, writeSyncedHash } from "./heal.js";
import { findFolderHash, probeRepoTree } from "./upstream.js";
import {
  readSkillSource,
  UPSTREAM_KIND_GITHUB,
  writeSkillSource,
  type UpstreamPointer,
} from "./source.js";

/**
 * Tier 3 of the Origin auto-resolver — same-repo self-detection.
 *
 * For every skill at `<registryRoot>/skills/<name>/` that doesn't yet
 * have an upstream pointer, this scanner probes a single candidate
 * repo's recursive tree and stamps `upstream` for any skill whose
 * folder also exists at `skills/<name>/` in that repo.
 *
 * Matching is positional (folder name + path), not content-hash:
 *   - The canonical use case is "user is on `Tyler-Reagan/skills-bank`
 *     and has a bundled skill on disk" — same name + same path = same
 *     skill, by construction of the bundled set.
 *   - For user-authored skills in their own linked repo, the same
 *     pattern holds: if a skill named `foo` lives at `skills/foo/`
 *     locally and `skills/foo/` exists upstream, it's the same skill.
 *   - False positives (a hand-authored skill that happens to share a
 *     name with an upstream skill) are rare and recoverable: the
 *     scanner's recorded `skillFolderHash` is the remote's, so drift
 *     detection will fire on the first build and the user can heal
 *     via Sever (Unlink origin) or Reset to origin.
 *
 * Network cost: one Git Trees API call per candidate repo, total,
 * regardless of how many skills are unstamped. The probe is gated
 * by `probeRepoTree`'s own caller-level dedup; this scanner does
 * not maintain its own cache.
 */

export interface SameRepoScanResult {
  /** Number of skills newly stamped with an Origin pointer. */
  stamped: number;
  /** True if the probe itself succeeded; false if the network call
   *  failed (rate-limit, missing repo, transport error). On failure
   *  `stamped` is 0 and no markers were written. */
  probed: boolean;
  /** Reason the probe failed, if applicable — for logging. */
  reason?: string;
}

/**
 * Scan `<registryRoot>/skills/<name>/` and stamp any skill that has
 * no `upstream` field but whose folder name also exists under
 * `skills/<name>/` at `repo`'s HEAD.
 *
 * Idempotent: skills with an existing `upstream` field are skipped.
 * Safe to run repeatedly at every sync point.
 *
 * Returns counts + probe outcome. The caller logs the result; this
 * function never throws.
 */
export async function scanAndStampOriginFromRepo(
  registryRoot: string,
  repo: string,
  token: string | null,
  options: { signal?: AbortSignal } = {},
): Promise<SameRepoScanResult> {
  const skillsDir = path.join(registryRoot, "skills");
  if (!fs.existsSync(skillsDir)) {
    return { stamped: 0, probed: false, reason: "no skills directory" };
  }

  // Collect candidates first so we don't call the network when nothing
  // is unstamped. Reading 60 markers locally is far cheaper than the
  // probe round-trip.
  const candidates: { name: string; skillDir: string }[] = [];
  for (const sk of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!sk.isDirectory()) continue;
    const skillDir = path.join(skillsDir, sk.name);
    const base = readSkillSource(skillDir);
    if (base.upstream !== undefined) continue;
    candidates.push({ name: sk.name, skillDir });
  }
  if (candidates.length === 0) return { stamped: 0, probed: false };

  const probe = await probeRepoTree(repo, token, { signal: options.signal });
  if (!probe.ok) {
    return { stamped: 0, probed: false, reason: probe.message };
  }
  if (probe.truncated) {
    return {
      stamped: 0,
      probed: true,
      reason: "tree truncated — refusing to stamp on partial data",
    };
  }

  const now = new Date().toISOString();
  let stamped = 0;
  for (const { name, skillDir } of candidates) {
    const folderPath = `skills/${name}`;
    const folderHash = findFolderHash(probe.tree, folderPath);
    if (!folderHash) continue;
    const pointer: UpstreamPointer = {
      kind: UPSTREAM_KIND_GITHUB,
      repo,
      sourceUrl: `https://github.com/${repo}.git`,
      skillPath: `${folderPath}/SKILL.md`,
      skillFolderHash: folderHash,
      installedAt: now,
      fetchedAt: now,
    };
    try {
      const base = readSkillSource(skillDir);
      // Re-check `upstream` after the network call — a concurrent
      // manual picker or lock-file scan may have stamped while we
      // were probing.
      if (base.upstream !== undefined) continue;
      writeSkillSource(skillDir, { ...base, upstream: pointer });
      // Baseline reflects current local content so post-stamp drift
      // detection compares against what's actually on disk, not the
      // remote. If local matches remote (the typical case), no drift
      // surfaces. If local has been edited, drift surfaces immediately
      // and the user can heal via Sever or Reset.
      const baseline = hashSkillFolder(skillDir);
      if (baseline) writeSyncedHash(skillDir, baseline);
      stamped++;
    } catch {
      // A failed write isn't fatal — the next scan retries.
    }
  }
  return { stamped, probed: true };
}
