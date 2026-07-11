/**
 * Phase 4 (v1.5): GitHub-URL parser for the in-app install flow.
 * Pure URL pattern matching — never probes GitHub. A follow-up
 * `installSkillFiles` call at install time validates that the
 * parsed `{repo, skillPath}` actually contains a SKILL.md.
 *
 * Accepts the two URL shapes that GitHub's web UI exposes for a
 * skill folder:
 *
 *   - Folder URL: `https://github.com/<owner>/<repo>/tree/<branch>/<path>`
 *   - Blob URL:   `https://github.com/<owner>/<repo>/blob/<branch>/<path>/SKILL.md`
 *
 * Repo-root URLs (no `/tree/` or `/blob/` segment) are rejected
 * with `not-a-skill-folder`; the user is expected to drill into
 * a specific skill folder. Non-github hosts are rejected with
 * `not-github`. Everything else is `malformed`.
 *
 * Output `skillPath` is always canonicalized to end with
 * `/SKILL.md` so it round-trips with `origin.skillPath` (the
 * convention v1.2's discovery walker established).
 */

export interface ParsedSkillUrl {
  /** GitHub `owner/repo`. */
  repo: string;
  /** Path within the repo, ending in `/SKILL.md`. */
  skillPath: string;
  /** Branch/ref encoded in the URL, when present. */
  ref?: string;
}

export interface UrlParseError {
  kind: "not-github" | "not-a-skill-folder" | "malformed";
  message: string;
}

/**
 * Is this origin URL one the app's GitHub machinery (probe / mirror /
 * adopt-PR) can drive? A capability check on the URL's host, not a stored
 * taxonomy value (ADR-0020). `null` (local skill, no remote) is never
 * GitHub-operable. A non-github host (GitLab, self-hosted) is a valid
 * external origin the app simply can't re-fetch yet — this returns false
 * for it honestly.
 */
export function isGithubUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "github.com" || host === "www.github.com";
  } catch {
    return false;
  }
}

/**
 * Normalize a repo origin URL for storage and comparison: strip a
 * trailing `.git` suffix and any trailing slashes so `…/owner/repo` and
 * `…/owner/repo.git` collapse to one origin group (they otherwise split
 * self-origin skills across two groups). Host-agnostic — a plain string
 * transform, not a GitHub check. Non-string input becomes `null`.
 */
export function normalizeOriginUrl(
  url: string | null | undefined,
): string | null {
  if (typeof url !== "string") return null;
  return url.replace(/\/+$/, "").replace(/\.git$/, "");
}

/**
 * Extract `owner/repo` from a GitHub URL, or null if it isn't a GitHub URL
 * with at least owner + repo segments. Used at display/probe call sites
 * that previously read `origin.repo` directly. Tolerates the full spread
 * of GitHub URL shapes (repo root, `/tree/`, `/blob/`, `.git` suffix).
 */
export function parseOwnerRepo(url: string | null | undefined): string | null {
  if (!isGithubUrl(url)) return null;
  try {
    const segs = new URL(url as string).pathname
      .split("/")
      .filter((s) => s.length > 0);
    if (segs.length < 2) return null;
    const owner = segs[0]!;
    const repo = segs[1]!.replace(/\.git$/, "");
    if (!owner || !repo) return null;
    return `${owner}/${repo}`;
  } catch {
    return null;
  }
}

export interface ParsedNpxAdd {
  /** GitHub `owner/repo`. */
  repo: string;
  /** The `--skill <name>` value — a skill's registry name, not a path. */
  skillName: string;
}

/**
 * Recognize the install command skills.sh copies to the clipboard:
 *
 *   npx skills add https://github.com/<owner>/<repo> --skill <skill-name>
 *
 * Returns `{repo, skillName}` or null if the input isn't that shape. Pure —
 * never probes GitHub (preserves this module's "never touches the network"
 * invariant that `manifest/import` and `probe` rely on). The skill's actual
 * folder path is NOT derivable here: the repo tree must be searched by name
 * in the main process (`resolveSkillFolderByName` in `origin.ts`), because
 * the skill can live at any depth under a category folder.
 */
export function parseNpxSkillsAdd(raw: string): ParsedNpxAdd | null {
  const m = raw.trim().match(/npx\s+skills\s+add\s+(\S+)\s+--skill\s+(\S+)/);
  if (!m) return null;
  const repo = parseOwnerRepo(m[1]);
  if (!repo) return null;
  return { repo, skillName: m[2]! };
}

export function parseGithubSkillUrl(
  url: string,
): ParsedSkillUrl | UrlParseError {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return {
      kind: "malformed",
      message:
        "Couldn't parse that as a URL. Paste a GitHub link to a skill folder.",
    };
  }

  if (
    parsed.hostname !== "github.com" &&
    parsed.hostname !== "www.github.com"
  ) {
    return {
      kind: "not-github",
      message:
        "Only GitHub URLs are supported. Paste a github.com link to a skill folder.",
    };
  }

  // Strip leading / trailing slashes; split into path segments.
  const segs = parsed.pathname.split("/").filter((s) => s.length > 0);

  if (segs.length < 2) {
    return {
      kind: "malformed",
      message:
        "URL needs to point at a specific repo. Format: github.com/<owner>/<repo>/tree/<branch>/<path>.",
    };
  }

  const owner = segs[0]!;
  const repoName = segs[1]!;
  const repo = `${owner}/${repoName}`;

  // Repo-root URL (no /tree/ or /blob/). Reject with a guiding
  // message — the user almost certainly didn't mean to mount the
  // entire repo as one skill.
  if (segs.length === 2) {
    return {
      kind: "not-a-skill-folder",
      message:
        "URL points at the repo root, not a skill folder. Drill into a specific skill (the folder that contains SKILL.md) and paste that URL.",
    };
  }

  const refType = segs[2]!;
  if (refType !== "tree" && refType !== "blob") {
    return {
      kind: "malformed",
      message:
        "URL doesn't look like a folder or file path. Expected github.com/<owner>/<repo>/tree/<branch>/<path> or .../blob/<branch>/<path>/SKILL.md.",
    };
  }

  if (segs.length < 5) {
    // /tree/<branch> with no path — same as repo-root for our purposes.
    return {
      kind: "not-a-skill-folder",
      message:
        "URL doesn't include a path inside the repo. Drill into a specific skill folder and paste that URL.",
    };
  }

  const ref = segs[3]!;
  const pathSegs = segs.slice(4);
  const rawPath = pathSegs.join("/");

  if (refType === "blob") {
    // Blob URL must end with SKILL.md. Anything else means the user pointed
    // at a different file in the skill folder; the install path
    // would still find SKILL.md, but accepting non-SKILL.md blob
    // URLs would let the user mistake e.g. references/THEMES.md
    // for the install target. Reject; guide them to the parent
    // folder.
    if (!rawPath.endsWith("/SKILL.md") && rawPath !== "SKILL.md") {
      return {
        kind: "not-a-skill-folder",
        message:
          "Blob URL doesn't end in SKILL.md. Either paste the folder URL (.../tree/<branch>/<path>) or the SKILL.md blob URL specifically.",
      };
    }
    return { repo, skillPath: rawPath, ref };
  }

  // Folder URL — canonicalize to <path>/SKILL.md.
  return {
    repo,
    skillPath: rawPath.endsWith("/")
      ? `${rawPath}SKILL.md`
      : `${rawPath}/SKILL.md`,
    ref,
  };
}
