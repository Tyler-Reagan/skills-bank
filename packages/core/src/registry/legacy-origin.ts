import fs from "node:fs";
import path from "node:path";
import type { ManifestOrigin } from "../manifest/manifest.js";
import { normalizeOriginUrl } from "../github/url.js";

/**
 * Pre-#159 per-skill sidecar file. Retired by the origin-only provenance
 * model (ADR-0020/0021) — new installs never write one — but existing
 * registries seeded before the cut still carry these on disk, and they
 * hold the only surviving record of a skill's upstream. Reconcile reads
 * them to recover origin for a `url:null` row rather than discarding
 * provenance on upgrade (finding F5).
 */
const LEGACY_SIDECAR_FILENAME = ".skills-bank.json";

interface LegacySidecarOrigin {
  kind?: string;
  repo?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
}

/**
 * Read and map a folder's legacy `.skills-bank.json` origin to a v6
 * `ManifestOrigin`, or return null when there's nothing recoverable — no
 * sidecar, unreadable, or a genuinely local skill (`kind: "none"`, no
 * `sourceUrl`/`repo`). Returning null lets the caller keep the honest
 * `url: null` resting state; this never invents a remote.
 *
 * Mapping: old `{sourceUrl|repo, skillPath, skillFolderHash}` →
 * v6 `{url, skillPath, hash}`, with the URL `.git`-normalized so it
 * groups with lean remote rows.
 */
export function readLegacyOrigin(skillDir: string): ManifestOrigin | null {
  const p = path.join(skillDir, LEGACY_SIDECAR_FILENAME);
  if (!fs.existsSync(p)) return null;
  let parsed: { origin?: LegacySidecarOrigin };
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  const o = parsed.origin;
  if (!o || typeof o !== "object") return null;

  const rawUrl =
    typeof o.sourceUrl === "string" && o.sourceUrl
      ? o.sourceUrl
      : typeof o.repo === "string" && o.repo
        ? `https://github.com/${o.repo}`
        : null;
  const url = normalizeOriginUrl(rawUrl);
  if (!url) return null;

  const origin: ManifestOrigin = { url };
  if (typeof o.skillPath === "string" && o.skillPath) {
    origin.skillPath = o.skillPath;
  }
  if (typeof o.skillFolderHash === "string" && o.skillFolderHash) {
    origin.hash = o.skillFolderHash;
  }
  return origin;
}
