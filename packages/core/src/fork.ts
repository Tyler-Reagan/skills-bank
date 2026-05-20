import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir } from "./agents.js";
import { flipSourceToUser, unlinkOrigin } from "./heal.js";
import { type SkillFolderRef } from "./registry.js";
import { readSkillSource } from "./source.js";

/**
 * Phase 5 (v1.5) — fork primitive per ADR-0006.
 *
 * "Fork" is the publish-time composition that converts an edited
 * vendored skill into a user-owned skill the user can push to
 * their linked repo. It is irreversible without re-vendoring.
 *
 * The composition: unlinkOrigin (drop origin pointer) +
 * flipSourceToUser (source: curated → user) + bucket move
 * (vendored → personal) + best-effort agent-symlink repoint.
 *
 * Atomicity is via scratch-dir + atomic rename. Steps before the
 * rename leave zero registry state changes; steps after are
 * best-effort and rely on existing collision-detection
 * (`walkSkills`) to converge.
 */

export interface ForkSkillResult_Ok {
  ok: true;
  /** Absolute path of the new `skills/personal/<name>/` location. */
  newDir: string;
  ref: SkillFolderRef;
  /** Agent-dir symlinks that were repointed at the new location. */
  symlinksRepointed: number;
}

export type ForkSkillResult =
  | ForkSkillResult_Ok
  | { ok: false; reason: "no-origin"; message: string }
  | { ok: false; reason: "source-missing"; message: string }
  | { ok: false; reason: "not-vendored"; message: string }
  | {
      ok: false;
      reason: "collision";
      message: string;
      existingDir: string;
    }
  | { ok: false; reason: "swap-failed"; message: string };

/**
 * Atomic fork of a vendored skill. See ADR-0006 for the full
 * invariant pin. Returns a discriminated result keyed on `reason`;
 * the caller (typically the Publish IPC handler) maps the variants
 * to user-facing surfaces.
 */
export function forkSkill(
  registryRoot: string,
  name: string,
): ForkSkillResult {
  // Step 1 — input validation. Direct fs checks against each
  // bucket so a cross-bucket-collision state (both vendored AND
  // personal have the name — pathological, but possible if a prior
  // failed fork left a leftover) doesn't throw via
  // SkillNameCollisionError. Order: vendored existence →
  // not-vendored (personal-only) → personal collision → origin
  // pointer. Each pre-check is bucket-local + cheap.
  const vendoredDir = path.join(
    registryRoot,
    "skills",
    "vendored",
    name,
  );
  const personalDest = path.join(
    registryRoot,
    "skills",
    "personal",
    name,
  );
  const vendoredExists = fs.existsSync(vendoredDir);
  const personalExists = fs.existsSync(personalDest);

  if (!vendoredExists && personalExists) {
    return {
      ok: false,
      reason: "not-vendored",
      message: `"${name}" lives in skills/personal/. Fork only applies to vendored skills.`,
    };
  }
  if (!vendoredExists) {
    return {
      ok: false,
      reason: "source-missing",
      message: `No skill named "${name}" in the registry.`,
    };
  }
  if (personalExists) {
    return {
      ok: false,
      reason: "collision",
      message: `A skill named "${name}" already exists in skills/personal/. Resolve the conflict before forking.`,
      existingDir: personalDest,
    };
  }
  const source = readSkillSource(vendoredDir);
  if (!source.origin) {
    return {
      ok: false,
      reason: "no-origin",
      message: `"${name}" has no origin pointer — Fork only applies to skills with a curated upstream.`,
    };
  }

  // Step 2 — scratch-dir population. Lives under the gitignored
  // .skills-bank/ root so a partial copy can never accidentally
  // leak into source control.
  const scratchRoot = path.join(
    registryRoot,
    ".skills-bank",
    "scratch",
  );
  const scratchDir = path.join(
    scratchRoot,
    `fork-${crypto.randomBytes(8).toString("hex")}`,
  );
  const scratchSkillDir = path.join(scratchDir, name);
  try {
    fs.mkdirSync(scratchSkillDir, { recursive: true });
    fs.cpSync(vendoredDir, scratchSkillDir, { recursive: true });
  } catch (err) {
    cleanupScratch(scratchDir);
    return {
      ok: false,
      reason: "swap-failed",
      message: `Failed to populate scratch dir: ${(err as Error).message}`,
    };
  }

  // Step 3 — rewrite source markers on the scratch copy. unlinkOrigin
  // drops the origin pointer + the synced-hash baseline; flipSourceToUser
  // moves source: curated → user.
  try {
    unlinkOrigin(scratchSkillDir);
    flipSourceToUser(scratchSkillDir);
  } catch (err) {
    cleanupScratch(scratchDir);
    return {
      ok: false,
      reason: "swap-failed",
      message: `Failed to rewrite source markers: ${(err as Error).message}`,
    };
  }

  // Step 4 — atomic commit point. Once this rename succeeds, the
  // user-visible registry has the new personal/<name>/. Failures
  // before this leave nothing committed.
  try {
    fs.mkdirSync(path.dirname(personalDest), { recursive: true });
    fs.renameSync(scratchSkillDir, personalDest);
  } catch (err) {
    cleanupScratch(scratchDir);
    return {
      ok: false,
      reason: "swap-failed",
      message: `Atomic swap failed: ${(err as Error).message}`,
    };
  }

  // Step 5 — remove the vendored leftover. If this fails the
  // transient duplicate surfaces on the next `walkSkills` build via
  // SkillNameCollisionError — the heal flow converges by removing
  // the leftover. ADR-0006 Invariant 1 carves this out.
  try {
    fs.rmSync(vendoredDir, { recursive: true, force: true });
  } catch {
    // Acceptable per ADR-0006 — atomicity envelope ends at step 4.
  }

  // Step 6 — best-effort agent-symlink repoint. Agent dirs follow
  // the registry; if a symlink under `~/.claude/skills/<name>` etc.
  // resolves to the old vendored path, rewrite it to the new
  // personal path. Failure here doesn't roll back the fork.
  let symlinksRepointed = 0;
  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      continue;
    }
    if (!stat.isSymbolicLink()) continue;
    let resolved = "";
    try {
      resolved = fs.realpathSync(linkPath);
    } catch {
      // Broken symlink — leave alone; repair flow handles it.
      continue;
    }
    if (path.resolve(resolved) !== path.resolve(vendoredDir)) continue;
    try {
      fs.unlinkSync(linkPath);
      fs.symlinkSync(personalDest, linkPath, "dir");
      symlinksRepointed++;
    } catch {
      // Per-agent failure stays per-agent. Best-effort.
    }
  }

  cleanupScratch(scratchDir);

  return {
    ok: true,
    newDir: personalDest,
    ref: {
      name,
      bucket: "personal",
      dir: personalDest,
      relPath: `skills/personal/${name}`,
    },
    symlinksRepointed,
  };
}

function cleanupScratch(scratchDir: string): void {
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true });
  } catch {
    // Swallow — leftover scratch is non-fatal. The
    // .skills-bank/scratch/ dir is gitignored.
  }
}
