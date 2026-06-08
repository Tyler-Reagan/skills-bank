import { GH_API, ghFetch } from "./http.js";

/** A GitHub repo as the registry-link picker needs it. */
export interface GithubRepoSummary {
  fullName: string;
  isPrivate: boolean;
  defaultBranch: string;
  description: string | null;
}

/**
 * List the authenticated user's repos (owner + collaborator + org),
 * newest-first, paginating up to `maxPages` (×100). Throws on any
 * non-ok page — the picker surfaces it as a load failure.
 */
export async function fetchUserRepos(
  token: string,
  opts: { maxPages?: number } = {},
): Promise<GithubRepoSummary[]> {
  const maxPages = opts.maxPages ?? 3;
  const out: GithubRepoSummary[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await ghFetch<
      Array<{
        full_name: string;
        private: boolean;
        default_branch: string;
        description: string | null;
      }>
    >(
      `${GH_API}/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      { method: "GET" },
      token,
    );
    if (!res.ok) throw new Error(`GitHub /user/repos: ${res.status}`);
    for (const r of res.body) {
      out.push({
        fullName: r.full_name,
        isPrivate: r.private,
        defaultBranch: r.default_branch,
        description: r.description ?? null,
      });
    }
    if (res.body.length < 100) break;
  }
  return out;
}

/**
 * The repo's default branch, or undefined on any failure — non-fatal so
 * callers fall back to "main" for push/read base targeting.
 */
export async function fetchRepoDefaultBranch(
  fullName: string,
  token: string,
): Promise<string | undefined> {
  try {
    const res = await ghFetch<{ default_branch: string }>(
      `${GH_API}/repos/${fullName}`,
      { method: "GET" },
      token,
    );
    return res.ok ? res.body.default_branch : undefined;
  } catch {
    return undefined;
  }
}
