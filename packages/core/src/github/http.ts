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
