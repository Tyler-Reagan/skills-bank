import { parseOwnerRepo } from "../github/url.js";
import type { SkillBucket } from "./walk.js";

/**
 * Origin semantics (ADR-0019/0020). Provenance is a single nullable URL
 * living in the manifest row — there is no `source` axis and no per-skill
 * sidecar. This module holds the two derivations everything downstream
 * shares: "is this mine?" (self-origin) and "which bucket does it land
 * in?".
 */

/**
 * Does this origin URL point back at the registry's own linked repo
 * (a self-origin, authored here), rather than a third-party upstream?
 * The single self-vs-external decider (ADR-0012's surviving remnant),
 * now a URL compare: the URL's `owner/repo` equals the active linked
 * repo. `null` (local), a non-GitHub URL, or no linked repo → not self.
 */
export function isSelfOrigin(
  url: string | null | undefined,
  linkedRepo: string | undefined,
): boolean {
  if (!url || !linkedRepo) return false;
  const ownerRepo = parseOwnerRepo(url);
  return ownerRepo !== null && ownerRepo === linkedRepo;
}

/**
 * Bucket a skill's content lands in, derived once at acquisition
 * (ADR-0020). `url: null` (local) or a self-origin → `personal`; any
 * other (external) URL → `vendored`. Thereafter the folder location is
 * the record — nothing re-derives this live against the mutable link.
 */
export function bucketForOrigin(
  url: string | null | undefined,
  linkedRepo: string | undefined,
): SkillBucket {
  if (!url) return "personal";
  return isSelfOrigin(url, linkedRepo) ? "personal" : "vendored";
}
