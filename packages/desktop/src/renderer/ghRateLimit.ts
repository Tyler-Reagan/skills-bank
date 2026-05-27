import type { RateLimitInfo } from "@skills-bank/core";

/**
 * Shared prefix for GitHub rate-limit messages, e.g.
 * "GitHub rate limit reached (60/hr, unauthenticated)". Callers append
 * their own guidance (retry-after-reset vs sign-in-for-a-higher-ceiling).
 */
export function rateLimitReached(rl: RateLimitInfo): string {
  return `GitHub rate limit reached (${rl.limit}/hr${
    rl.unauthenticated ? ", unauthenticated" : ""
  })`;
}
