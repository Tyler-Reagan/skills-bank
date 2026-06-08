/**
 * Shared GitHub REST API client. All GitHub-touching modules in core
 * import from here — never inline fetch calls with hand-rolled auth
 * headers. The upstream Device Flow OAuth token is the single auth
 * source; no bundled PATs, no shared credentials.
 *
 * Rate-limit normalization: GitHub returns 403 (not 429) when the
 * hourly budget is exhausted, distinguishable only by
 * `X-RateLimit-Remaining: 0`. `ghFetch` maps this to 429 so callers
 * branch on the semantically-correct code.
 */

export const GH_API = "https://api.github.com";

/**
 * GitHub hourly request quota info. Populated on 429 (or the
 * 403-mapped-to-429 quirk) so the renderer can show ceiling +
 * time-to-reset + a "sign in" affordance rather than a bare error.
 */
export interface RateLimitInfo {
  /** Hourly request ceiling — 60 for unauth-per-IP, 5000 for authed. */
  limit: number;
  /** Requests remaining in the current window. 0 means exhausted. */
  remaining: number;
  /** ISO timestamp at which the window resets and quota replenishes. */
  resetAt: string;
  /** True iff the caller was operating on the unauthenticated ceiling. */
  unauthenticated: boolean;
}

export interface GhFetchResult<T> {
  ok: true;
  status: number;
  body: T;
}

export interface GhFetchErr {
  ok: false;
  status: number;
  message: string;
  rateLimit?: RateLimitInfo;
}

/**
 * Authenticated GitHub REST helper. Handles the 403→429 rate-limit
 * quirk, attaches required API version headers, and returns a
 * discriminated result — callers never touch raw Response objects.
 */
export async function ghFetch<T>(
  url: string,
  init: RequestInit,
  token: string,
): Promise<GhFetchResult<T> | GhFetchErr> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "skills-bank",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    return {
      ok: false,
      status: 0,
      message: `transport: ${(err as Error).message}`,
    };
  }
  if (
    res.status === 429 ||
    (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0")
  ) {
    const limit = Number(res.headers.get("x-ratelimit-limit") ?? "0") || 5000;
    const resetEpoch = Number(res.headers.get("x-ratelimit-reset") ?? "0");
    const resetAt =
      resetEpoch > 0
        ? new Date(resetEpoch * 1000).toISOString()
        : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    return {
      ok: false,
      status: 429,
      message: `GitHub rate limit reached (${limit}/hr)`,
      rateLimit: { limit, remaining: 0, resetAt, unauthenticated: false },
    };
  }
  if (!res.ok) {
    let body = "";
    try {
      body = await res.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      message: `${res.status} ${res.statusText}${body ? `: ${body}` : ""}`,
    };
  }
  const data = (await res.json()) as T;
  return { ok: true, status: res.status, body: data };
}

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
