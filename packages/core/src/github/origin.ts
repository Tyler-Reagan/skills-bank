/**
 * Origin-read primitives: probe, mirror, and update operations
 * against a skill's Origin repo (the GitHub repo where the skill is
 * authoritatively maintained).
 *
 * Auth is always the user's own OAuth token from the Device Flow —
 * never a bundled maintainer PAT. The user's account is the
 * rate-limit budget (5000/hr authenticated, 60/hr unauth per-IP).
 *
 * Callers are expected to dedup by repo before probing: many skills
 * often share a source repo (`vercel-labs/skills` backs dozens), so
 * one tree fetch per repo covers every skill from that repo. The
 * desktop runner does this dedup; the primitives here stay
 * single-repo and stateless.
 */

import type { RateLimitInfo } from "./http.js";

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
  url?: string;
}

export interface RepoTreeProbeOk {
  ok: true;
  /** Commit SHA the tree was resolved from. */
  rootSha: string;
  /** Flat list of every entry under the root, in tree-traversal order. */
  tree: GitTreeEntry[];
  /**
   * True if GitHub returned a truncated tree. Very rare for skills
   * repos (the limit is ~100k entries / 7MB); callers should surface
   * a clear "couldn't probe — repo too large" rather than acting on
   * partial data, since a missing entry could be misread as "skill
   * removed upstream."
   */
  truncated: boolean;
}

export interface RepoTreeProbeErr {
  ok: false;
  /** HTTP status code, or 0 for transport-level failure. We map
   *  GitHub's "403 with X-RateLimit-Remaining: 0" quirk to 429 here
   *  so callers branch on the semantically-correct code. */
  status: number;
  /** Human-readable reason — short, no jargon. The desktop renderer
   *  formats this directly into the toast. */
  message: string;
  /** Populated when `status === 429`. Lets the renderer show the
   *  exact ceiling, time-to-reset, and a "sign in" affordance. */
  rateLimit?: RateLimitInfo;
}

export type RepoTreeProbe = RepoTreeProbeOk | RepoTreeProbeErr;

export interface ProbeOptions {
  /** Branch / tag / commit to probe. Defaults to `HEAD`. */
  ref?: string;
  /** AbortSignal for cancellation (e.g. on app quit). */
  signal?: AbortSignal;
  /**
   * When true, bypass the idempotency guard and always re-fetch even
   * if `destDir` already exists and is non-empty. Used by
   * `applyOriginUpdate` which intentionally overwrites an existing
   * skill folder with the latest upstream content.
   */
  force?: boolean;
}

/**
 * Fetch a repo's recursive tree at the given ref. Returns the flat
 * entry list; callers scan it locally via `findFolderHash` to look
 * up per-path SHAs.
 */
export async function fetchOriginTree(
  repo: string,
  token: string | null,
  options: ProbeOptions = {},
): Promise<RepoTreeProbe> {
  const ref = options.ref ?? "HEAD";
  const url = `https://api.github.com/repos/${repo}/git/trees/${ref}?recursive=true`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "skills-bank",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: options.signal });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `transport: ${(err as Error).message}`,
    };
  }
  if (!res.ok) {
    // GitHub returns 403 (not 429) when the rate-limit window is
    // exhausted, distinguishable only by `X-RateLimit-Remaining: 0`.
    // Translate to a structured rate-limit error so the renderer
    // can show "60/hr, resets at 4:12 PM" rather than a bare
    // "403 Forbidden."
    const remainingHdr = res.headers.get("x-ratelimit-remaining");
    if (res.status === 403 && remainingHdr === "0") {
      const limit = Number(res.headers.get("x-ratelimit-limit") ?? "0") || 60;
      const resetEpoch = Number(res.headers.get("x-ratelimit-reset") ?? "0");
      const resetAt =
        resetEpoch > 0
          ? new Date(resetEpoch * 1000).toISOString()
          : new Date(Date.now() + 60 * 60 * 1000).toISOString();
      const unauthenticated = !token;
      return {
        ok: false,
        status: 429,
        message: unauthenticated
          ? `GitHub rate limit reached (${limit}/hr, unauthenticated)`
          : `GitHub rate limit reached (${limit}/hr)`,
        rateLimit: { limit, remaining: 0, resetAt, unauthenticated },
      };
    }
    return {
      ok: false,
      status: res.status,
      message: `${res.status} ${res.statusText}`,
    };
  }
  const body = (await res.json()) as {
    sha: string;
    tree: GitTreeEntry[];
    truncated: boolean;
  };
  return {
    ok: true,
    rootSha: body.sha,
    tree: body.tree,
    truncated: body.truncated,
  };
}

/**
 * Look up a folder's tree-entry SHA from a flat recursive tree.
 * `folderPath` is the path from repo root, no trailing slash —
 * e.g. `"skills/find-skills"`. Returns null when the folder isn't
 * present (deleted upstream — a separate state from "unchanged"
 * that callers should surface as `upstream-missing` rather than
 * `origin-update-available`).
 */
export function findFolderHash(
  tree: GitTreeEntry[],
  folderPath: string,
): string | null {
  for (const entry of tree) {
    if (entry.path === folderPath && entry.type === "tree") return entry.sha;
  }
  return null;
}

/**
 * Derive a folder path from a SKILL.md path. The CLI's lock file
 * always points at the SKILL.md file; the folder hash is the tree
 * SHA of its parent directory.
 *
 *   "skills/find-skills/SKILL.md" → "skills/find-skills"
 *   "SKILL.md"                    → ""           (root-level skill)
 *   ""                            → ""           (defensive)
 */
export function folderPathFromSkillPath(skillPath: string): string {
  const i = skillPath.lastIndexOf("/");
  if (i < 0) return "";
  return skillPath.slice(0, i);
}

/**
 * Build a `folder-leaf-name → SKILL.md-path` map from a repo's recursive
 * tree. Each skill folder is keyed by its containing-folder leaf — e.g.
 * `skills/keyboard/qmk/qmk-keymap/SKILL.md` → `qmk-keymap` →
 * `skills/keyboard/qmk/qmk-keymap/SKILL.md`. This lets a caller resolve
 * where a skill (identified by its registry `name`, which equals the
 * folder leaf) actually lives in a repo whose layout it doesn't otherwise
 * know — the linked repo's category folders are decoupled from the local
 * bucket layout.
 *
 * A leaf that appears for two distinct folders is ambiguous and dropped:
 * callers must treat an absent key as "not resolvable" rather than guess.
 */
export function buildSkillFolderMap(tree: GitTreeEntry[]): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const entry of tree) {
    if (entry.type !== "blob" || !entry.path.endsWith("/SKILL.md")) continue;
    const folder = folderPathFromSkillPath(entry.path);
    const leaf = folder.slice(folder.lastIndexOf("/") + 1);
    if (!leaf) continue;
    const existing = map.get(leaf);
    if (existing !== undefined && existing !== entry.path) {
      ambiguous.add(leaf);
      continue;
    }
    map.set(leaf, entry.path);
  }
  for (const leaf of ambiguous) map.delete(leaf);
  return map;
}

export interface MirrorResultOk {
  ok: true;
  /** SHA-1 git tree hash of the upstream folder — write this into the
   *  skill's `upstream.skillFolderHash` marker so subsequent probes
   *  compare against the just-mirrored snapshot. */
  folderHash: string;
  /** Number of files mirrored. Used for telemetry / human-readable
   *  return messages; not load-bearing. */
  fileCount: number;
}

export interface MirrorResultErr {
  ok: false;
  /** HTTP status when known; 0 for transport errors or refusal; 429
   *  when the upstream-side rate limit is exhausted. */
  status: number;
  message: string;
  /** Set when `status === 429` so the renderer can show ceiling +
   *  reset time + auth affordance. */
  rateLimit?: RateLimitInfo;
}

export type MirrorResult = MirrorResultOk | MirrorResultErr;

/**
 * Fetch every file under `<folderPath>/` from `repo` and write them
 * into `destDir`. Wipe + recopy semantics — `destDir` is cleared
 * before writing, so files removed upstream are removed locally too.
 *
 * The fetch is a single recursive Git Trees probe + one blob fetch
 * per file. Typical skill folders (≤10 files) → ~11 API calls.
 *
 * Errors abort before any disk mutation: a transport failure
 * mid-loop is detected before the local folder is wiped. Callers
 * can retry without worrying about partial state.
 *
 * Does NOT write `.skills-bank.json` / `.skills-bank-hash` sidecars —
 * those are app-state concerns the caller wires after the install
 * succeeds (so vendor-new-skill, update-in-place, and
 * preview-into-temp-dir can each manage marker state appropriately).
 *
 * Idempotent: if `destDir` already exists and is non-empty the function
 * returns immediately with `{ ok: true, folderHash: "", fileCount: 0 }`.
 * This makes it safe to call even when files are already present — the
 * Browse "Install" two-primitive chain relies on this property.
 */
export async function installSkillFiles(
  repo: string,
  folderPath: string,
  destDir: string,
  token: string | null,
  options: ProbeOptions = {},
): Promise<MirrorResult> {
  const fs = await import("node:fs");
  const path = await import("node:path");

  // Idempotency guard: if destDir already exists and has files, skip the
  // download entirely. Safe to call multiple times (e.g. Browse Install chain).
  // Pass `options.force = true` to bypass (used by applyOriginUpdate which
  // intentionally overwrites an existing folder with fresh upstream content).
  if (
    !options.force &&
    fs.existsSync(destDir) &&
    fs.readdirSync(destDir).length > 0
  ) {
    return { ok: true, folderHash: "", fileCount: 0 };
  }

  const probe = await fetchOriginTree(repo, token, options);
  if (!probe.ok) {
    const err: MirrorResultErr = {
      ok: false,
      status: probe.status,
      message: probe.message,
    };
    if (probe.rateLimit) err.rateLimit = probe.rateLimit;
    return err;
  }
  if (probe.truncated) {
    return {
      ok: false,
      status: 0,
      message: `tree truncated for ${repo} — refusing to mirror on partial data`,
    };
  }
  const folderHash = findFolderHash(probe.tree, folderPath);
  if (!folderHash) {
    return {
      ok: false,
      status: 404,
      message: `${folderPath} not found in ${repo}`,
    };
  }

  const folderPrefix = `${folderPath}/`;
  const blobs = probe.tree.filter(
    (e) => e.type === "blob" && e.path.startsWith(folderPrefix),
  );
  if (blobs.length === 0) {
    return {
      ok: false,
      status: 0,
      message: `${folderPath} in ${repo} contains no files`,
    };
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "skills-bank",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Fetch all blobs into memory before touching disk — partial fetch
  // failures must not leave destDir half-mirrored.
  const fetched: { relPath: string; content: Buffer }[] = [];
  for (const blob of blobs) {
    const url = `https://api.github.com/repos/${repo}/git/blobs/${blob.sha}`;
    let body: { content?: string; encoding?: string };
    try {
      const res = await fetch(url, { headers, signal: options.signal });
      if (!res.ok) {
        return {
          ok: false,
          status: res.status,
          message: `failed to fetch ${blob.path} (${res.status} ${res.statusText})`,
        };
      }
      body = (await res.json()) as typeof body;
    } catch (err) {
      return {
        ok: false,
        status: 0,
        message: `transport error fetching ${blob.path}: ${(err as Error).message}`,
      };
    }
    if (body.encoding !== "base64" || typeof body.content !== "string") {
      return {
        ok: false,
        status: 0,
        message: `unexpected blob encoding for ${blob.path}`,
      };
    }
    fetched.push({
      relPath: blob.path.slice(folderPrefix.length),
      content: Buffer.from(body.content, "base64"),
    });
  }

  // Commit to disk. Wipe destDir to drop files the upstream tree no
  // longer carries, then write each fetched blob.
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  for (const { relPath, content } of fetched) {
    const dest = path.join(destDir, relPath);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }

  return { ok: true, folderHash, fileCount: fetched.length };
}

/**
 * Per-skill upstream Update operation. Mirrors the canonical author's
 * folder into the user's registry, then rewrites the local marker +
 * hash sidecars so the next probe disengages drift detection.
 *
 * Lifted from `packages/desktop/src/main/main.ts` in v0.11.9 M4 so
 * the CLI and future test surfaces can exercise the same primitive
 * without depending on Electron. The desktop wrapper keeps the
 * probe-cache cleanup + notification side effects (those are UI
 * concerns, not core concerns).
 *
 * Side effects: writes to disk under `<registryRoot>/skills/<entry.path>`.
 * No network access beyond `installSkillFiles`'s own fetches; no
 * mutation of `~/.agents/.skill-lock.json` or any other CLI-owned
 * state.
 */
export interface OriginUpdateResultOk {
  ok: true;
  message: string;
}

export interface OriginUpdateResultErr {
  ok: false;
  message: string;
  /** Populated only on rate-limit failures. */
  rateLimit?: RateLimitInfo;
  /** Free-form diagnostic blob — surfaces in the renderer's
   *  Copy-details affordance on the sticky-error toast. */
  diagnostic?: string;
}

export type OriginUpdateResult = OriginUpdateResultOk | OriginUpdateResultErr;

export interface OriginUpdateContext {
  registryRoot: string;
  /** Skill name (the registry index key, not the folder name). */
  name: string;
  /** GitHub OAuth token. Null is fine — falls through to unauthenticated
   *  GitHub probes, with the usual 60/hr rate limit. */
  token: string | null;
}

export async function applyOriginUpdate(
  ctx: OriginUpdateContext,
): Promise<OriginUpdateResult> {
  // Lazy imports keep this file tree-shake-friendly for the renderer's
  // skill-state subpath consumers — none of them want the build/sync
  // dependency graph that buildRegistryIndex pulls in.
  const { buildRegistryIndex } = await import("../registry/build.js");
  const { readSkillSource, writeSkillSource } =
    await import("../registry/source.js");
  const { hashSkillFolder, writeRuntimeState, writeSyncedHash } =
    await import("../registry/heal.js");
  const path = await import("node:path");

  const index = buildRegistryIndex(ctx.registryRoot);
  const entry = index.entries.find((e) => e.name === ctx.name);
  if (!entry) {
    return { ok: false, message: `${ctx.name} is not in the registry` };
  }
  const origin = entry.source.origin;
  if (origin?.kind !== "github" || !origin.repo || !origin.skillPath) {
    return {
      ok: false,
      message: `${ctx.name} has no GitHub origin — nothing to update`,
    };
  }

  const folderPath = folderPathFromSkillPath(origin.skillPath);
  const registrySkillDir = path.resolve(
    ctx.registryRoot,
    entry.path || `skills/${ctx.name}`,
  );
  const existingSource = readSkillSource(registrySkillDir);

  const fs = await import("node:fs");

  // Stash the pre-mirror skill folder so we can roll back if the
  // post-mirror invariants check fails (synthesis can't fill in,
  // validation rejects). Without this stash a broken upstream would
  // poison the local copy and the new baseline hash would freeze
  // the broken state as "the new normal" — see
  // docs/bug-reports/2026-05-19-origin-update-missing-validation.md.
  const crypto = await import("node:crypto");
  const scratchRoot = path.resolve(ctx.registryRoot, ".skills-bank", "scratch");
  const scratchPath = path.join(
    scratchRoot,
    `origin-update-${crypto.randomBytes(8).toString("hex")}`,
  );
  fs.mkdirSync(scratchRoot, { recursive: true });
  if (fs.existsSync(registrySkillDir)) {
    fs.cpSync(registrySkillDir, scratchPath, { recursive: true });
  }
  const restoreFromScratch = (): void => {
    if (!fs.existsSync(scratchPath)) return;
    fs.rmSync(registrySkillDir, { recursive: true, force: true });
    fs.renameSync(scratchPath, registrySkillDir);
  };
  const cleanupScratch = (): void => {
    if (fs.existsSync(scratchPath)) {
      fs.rmSync(scratchPath, { recursive: true, force: true });
    }
  };

  const mirror = await installSkillFiles(
    origin.repo,
    folderPath,
    registrySkillDir,
    ctx.token,
    { force: true },
  );
  if (!mirror.ok) {
    // installSkillFiles didn't mutate destDir (ADR-0001 Suite 4); just
    // discard the scratch and propagate.
    cleanupScratch();
    if (mirror.status === 429 && mirror.rateLimit) {
      return {
        ok: false,
        message: mirror.message,
        rateLimit: mirror.rateLimit,
      };
    }
    const recoveryHint =
      mirror.status === 404
        ? " Sever to keep local, or Unlink the pointer."
        : "";
    return {
      ok: false,
      message: `Update failed: ${mirror.message}.${recoveryHint}`,
      diagnostic:
        `name=${ctx.name}\n` +
        `repo=${origin.repo}\n` +
        `skillPath=${origin.skillPath}\n` +
        `status=${mirror.status}\n` +
        `message=${mirror.message}`,
    };
  }

  // Validate the mirrored SKILL.md frontmatter. If the upstream ships
  // a SKILL.md with missing required fields, reject and roll back rather
  // than freezing bad state as the new baseline.
  const { validateSkillMeta } = await import("../registry/frontmatter.js");
  const metaCheck = validateSkillMeta(registrySkillDir);
  if (!metaCheck.ok) {
    // Roll back: discard the mirrored content, restore from stash.
    // The user retries Update once the upstream-side issue is fixed,
    // or accepts the existing local copy via heal.
    restoreFromScratch();
    const detail =
      metaCheck.reason === "schema-violation"
        ? metaCheck.errors.join("; ")
        : metaCheck.reason;
    return {
      ok: false,
      message:
        `Update from ${origin.repo} fetched cleanly but failed frontmatter validation; ` +
        `local content restored. Cause: ${detail}.`,
      diagnostic:
        `name=${ctx.name}\n` +
        `repo=${origin.repo}\n` +
        `skillPath=${origin.skillPath}\n` +
        `reason=${metaCheck.reason}\n` +
        `detail=${detail}`,
    };
  }
  cleanupScratch();

  // Refresh marker with the new probed folder hash. `fetchedAt` lives
  // in the gitignored runtime sidecar (ADR-0002) so this write doesn't
  // churn the committed `.skills-bank.json` when only the timestamp
  // shifts.
  const now = new Date().toISOString();
  writeSkillSource(registrySkillDir, {
    ...existingSource,
    origin: {
      ...origin,
      skillFolderHash: mirror.folderHash,
    },
  });
  writeRuntimeState(registrySkillDir, { fetchedAt: now });
  // Re-hash so the baseline reflects the final on-disk state.
  const newBaseline = hashSkillFolder(registrySkillDir);
  if (newBaseline) writeSyncedHash(registrySkillDir, newBaseline);

  return { ok: true, message: `Updated ${ctx.name} from ${origin.repo}.` };
}
