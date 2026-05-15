/**
 * Probe primitives for GitHub-hosted skills. The desktop app calls
 * these to detect upstream changes by comparing a skill's stored
 * `skillFolderHash` (from its `.skills-bank.json` upstream pointer)
 * against the current SHA at the same path in the source repo's
 * recursive tree.
 *
 * Auth is always the user's own OAuth token from plan-02's Device
 * Flow — never a bundled maintainer PAT and never proxied through
 * shared credentials. The user's account is the rate-limit budget
 * (5000/hr authenticated, 60/hr unauth per-IP) and the audit trail.
 *
 * Callers are expected to dedup by repo before probing: many skills
 * often share a source repo (`vercel-labs/skills` backs dozens), so
 * one tree fetch per repo covers every skill from that repo. The
 * desktop runner does this dedup; the primitives here stay
 * single-repo and stateless.
 */

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
  /** HTTP status code, or 0 for transport-level failure. */
  status: number;
  /** Human-readable reason for surfacing to the user. */
  message: string;
}

export type RepoTreeProbe = RepoTreeProbeOk | RepoTreeProbeErr;

export interface ProbeOptions {
  /** Branch / tag / commit to probe. Defaults to `HEAD`. */
  ref?: string;
  /** AbortSignal for cancellation (e.g. on app quit). */
  signal?: AbortSignal;
}

/**
 * Fetch a repo's recursive tree at the given ref. Returns the flat
 * entry list; callers scan it locally via `findFolderHash` to look
 * up per-path SHAs.
 */
export async function probeRepoTree(
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
 * `upstream-update-available`).
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
