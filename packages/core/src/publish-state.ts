import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { hashSkillFolder } from "./heal.js";
import { walkSkills } from "./registry.js";
import { findFolderHash, fetchOriginTree } from "./origin.js";
import type { RateLimitInfo } from "./github-http.js";
import type { PublishState } from "./types.js";

/**
 * Per-skill publish-state computation. Per ADR-0008 there are two
 * paths plus a thin auto-detector — never silently fall back from
 * one to the other (that would dress up a regression as resilience).
 *
 *   - Git mode (`computePublishStatesFromGit`): execs `git`
 *     against the registry's working tree. Used in dev / CI / the
 *     maintainer's local clone.
 *   - Remote-API mode (`computePublishStatesFromRemote`): probes
 *     the linked repo's recursive tree via `fetchOriginTree` and
 *     compares per-skill folder hashes locally. Used by the
 *     packaged Electron app where `git` isn't on PATH.
 *
 * `publishState` is NOT stored on `RegistryEntry` post-v1.5 (ADR-0008
 * Invariant 7). Every consumer that needs the value asks for it via
 * one of the functions below; main-process consumers may cache the
 * remote tree under a 5-minute TTL (see ADR-0008 Invariant 7).
 *
 * The four-value vocabulary is preserved:
 *   - `pushed`    — linked repo's default branch has the local content
 *   - `draft`     — has local commits / edits not on the default branch
 *   - `untracked` — uncommitted working-tree changes (git-mode only)
 *   - `unknown`   — couldn't determine (not a git repo / tree truncated / no mode viable)
 */

// ─── Git mode ──────────────────────────────────────────────────────

/**
 * Three execs total — porcelain status, the unpushed SHA list, and
 * one bulk `git log` per skill (still cheap relative to fetch).
 * Returns an empty map (callers default missing entries to `unknown`)
 * when the registry root isn't a git working tree or `git` isn't
 * on PATH.
 */
export function computePublishStatesFromGit(
  registryRoot: string,
): Map<string, PublishState> {
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
      const filePath = line.slice(3);
      const m = /^skills\/[^/]+\/([^/]+)\//.exec(filePath);
      if (m && m[1]) out.set(m[1], "untracked");
    }
  }

  const upstream = exec(`git rev-parse --abbrev-ref @{u}`)?.trim();
  if (!upstream) return out;

  const unpushedRaw = exec(`git rev-list ${upstream}..HEAD`);
  const unpushedSet = new Set<string>(
    (unpushedRaw ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean),
  );

  for (const ref of walkSkills(registryRoot)) {
    if (out.has(ref.name)) continue;
    const sha = exec(`git log -1 --format=%H -- "${ref.relPath}"`)?.trim();
    if (!sha) {
      out.set(ref.name, "untracked");
      continue;
    }
    out.set(ref.name, unpushedSet.has(sha) ? "draft" : "pushed");
  }
  return out;
}

// ─── Remote-API mode ───────────────────────────────────────────────

export interface ComputePublishStatesFromRemoteOptions {
  registryRoot: string;
  /** Linked repo `owner/name`. */
  repo: string;
  /** Authenticated token for the tree probe. Null = unauth (60/hr). */
  token: string | null;
  /** Default branch on the linked repo. Defaults to `"main"`. */
  baseBranch?: string;
}

export interface ComputePublishStatesFromRemoteResult {
  /** name → state map. Always populated (every walked skill present). */
  states: Map<string, PublishState>;
  /**
   * Set when the tree probe returned `truncated: true` (ADR-0008
   * Invariant 5). All states collapse to `unknown` in that case;
   * the caller surfaces a structured warning rather than guessing.
   */
  truncated?: boolean;
  /** Set on rate-limit failures — caller surfaces sticky error. */
  rateLimit?: RateLimitInfo;
}

/**
 * Remote-API mode. ONE tree probe + N local hash comparisons.
 * Per ADR-0008 Invariant 4. The function never returns an
 * exception result — transient failures collapse to all-`unknown`
 * with structured context for the caller.
 */
export async function computePublishStatesFromRemote(
  opts: ComputePublishStatesFromRemoteOptions,
): Promise<ComputePublishStatesFromRemoteResult> {
  const baseBranch = opts.baseBranch ?? "main";
  const refs = walkSkills(opts.registryRoot);
  const allUnknown = (): Map<string, PublishState> => {
    const m = new Map<string, PublishState>();
    for (const r of refs) m.set(r.name, "unknown");
    return m;
  };
  if (refs.length === 0) {
    return { states: new Map() };
  }

  const probe = await fetchOriginTree(opts.repo, opts.token, {
    ref: baseBranch,
  });
  if (!probe.ok) {
    if (probe.status === 429 && probe.rateLimit) {
      return { states: allUnknown(), rateLimit: probe.rateLimit };
    }
    return { states: allUnknown() };
  }
  if (probe.truncated) {
    return { states: allUnknown(), truncated: true };
  }

  const states = new Map<string, PublishState>();
  for (const r of refs) {
    // Compare against the linked repo's tree at the skill's local
    // relPath (`skills/<bucket>/<name>`). This matches the path
    // convention v1.2's discovery-mount established.
    const remoteHash = findFolderHash(probe.tree, r.relPath);
    if (remoteHash === null) {
      // Folder absent on the remote — definitely not pushed. Use
      // `draft` per ADR-0008 Invariant 6's collapse rule.
      states.set(r.name, "draft");
      continue;
    }
    const localHash = hashSkillFolder(r.dir);
    if (localHash === null) {
      // Local hash unavailable (e.g. folder exceeds the budget).
      // Conservative: `unknown` so the canon gate stays safe.
      states.set(r.name, "unknown");
      continue;
    }
    states.set(r.name, localHash === remoteHash ? "pushed" : "draft");
  }
  return { states };
}

// ─── Auto-detector ─────────────────────────────────────────────────

export interface LinkedRepoLike {
  /** `owner/repo`. */
  fullName: string;
}

export type PublishStateMode =
  | { kind: "git" }
  | { kind: "remote"; repo: string; token: string | null };

export interface DetectPublishStateModeContext {
  linkedRepo: LinkedRepoLike | null;
  token: string | null;
}

/**
 * Decide which path to take. Single decision point — consumers
 * call this once at startup and cache the result; redo on
 * linked-repo change. No try-git-fall-back-to-API magic; a
 * transient git failure in dev mode doesn't silently flip the
 * consumer to the remote path.
 *
 * Priority — linked repo wins:
 *   1. If a linked repo is configured, use remote mode. The user
 *      cares about "is this skill on my linked repo?", which only
 *      the remote tree probe can answer. The maintainer's local
 *      working-tree-of-skills-bank case is the same surface —
 *      `linkedRepo` is set to the curated repo there too.
 *   2. Otherwise (no linked repo), use git mode when the registry
 *      IS a git working tree. Covers the rare "I'm running against
 *      a local-only registry root" case.
 *   3. Otherwise null — caller treats every skill as `unknown`.
 *
 * Returns `null` when neither mode is viable.
 */
export function detectPublishStateMode(
  registryRoot: string,
  ctx: DetectPublishStateModeContext,
): PublishStateMode | null {
  if (ctx.linkedRepo) {
    return {
      kind: "remote",
      repo: ctx.linkedRepo.fullName,
      token: ctx.token,
    };
  }
  if (fs.existsSync(path.join(registryRoot, ".git"))) {
    try {
      execSync("git --version", {
        cwd: registryRoot,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      return { kind: "git" };
    } catch {
      // `git` not on PATH — no mode viable.
    }
  }
  return null;
}
