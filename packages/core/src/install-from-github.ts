import fs from "node:fs";
import path from "node:path";
import { hashSkillFolder, writeSyncedHash } from "./heal.js";
import { findSkillFolder, readSkillMeta } from "./registry.js";
import { writeSkillSource, type OriginPointer } from "./source.js";
import type { RateLimitInfo } from "./github-http.js";
import { folderPathFromSkillPath, mirrorSkillFolder } from "./origin.js";

/**
 * Phase 4 (v1.5): one-shot install of a single skill from a GitHub
 * URL. Composes existing primitives — no new fetch logic. The
 * user-facing entry point is `Settings → Install a skill from
 * GitHub`; this is the core primitive the IPC handler calls.
 *
 * See `docs/plans/in-app-install-from-discover.md` for the
 * full design discussion + the deferred Discover-tab integration.
 */

export interface InstallFromGithubOptions {
  registryRoot: string;
  /** GitHub `owner/repo`. */
  repo: string;
  /** Path within the repo ending in `/SKILL.md` — canonical
   *  output from `parseGithubSkillUrl`. */
  skillPath: string;
  /**
   * Local bucket the installed skill lands in. Default: `personal`.
   * Rule: `personal` when the origin repo is the user's linked registry
   * (user-authored content); `vendored` for everything else (third-party
   * Discover tab installs, any origin repo the user doesn't own).
   */
  bucket?: "personal" | "vendored";
  /**
   * GitHub OAuth token for the fetch. Null = unauthenticated
   * (60/hr per-IP).
   */
  token: string | null;
}

export type InstallFromGithubResult =
  | {
      ok: true;
      name: string;
      bucket: "personal" | "vendored";
      destDir: string;
      folderHash: string;
    }
  | {
      ok: false;
      reason: "mirror-failed";
      message: string;
      rateLimit?: RateLimitInfo;
    }
  | {
      ok: false;
      reason: "name-collision";
      name: string;
      existingBucket: "personal" | "vendored";
      existingDir: string;
    }
  | {
      ok: false;
      reason: "no-skill-md";
      message: string;
    };

export async function installSkillFromGithub(
  opts: InstallFromGithubOptions,
): Promise<InstallFromGithubResult> {
  const bucket = opts.bucket ?? "personal";
  const source = bucket === "personal" ? "user" : "vendored";
  const folderPath = folderPathFromSkillPath(opts.skillPath);

  // Provisional name = final segment of the folder path. We rename
  // post-mirror if the meta.json or SKILL.md frontmatter declares a
  // different canonical name. (Most skills' folder basenames match
  // their canonical names; the rename case is uncommon but handled
  // for correctness.)
  const provisionalName =
    folderPath
      .split("/")
      .filter((s) => s.length > 0)
      .pop() ?? "skill";

  const existing = findSkillFolder(opts.registryRoot, provisionalName);
  if (existing) {
    return {
      ok: false,
      reason: "name-collision",
      name: provisionalName,
      existingBucket: existing.bucket,
      existingDir: existing.dir,
    };
  }

  const destDir = path.join(
    opts.registryRoot,
    "skills",
    bucket,
    provisionalName,
  );
  fs.mkdirSync(path.dirname(destDir), { recursive: true });

  const mirror = await mirrorSkillFolder(
    opts.repo,
    folderPath,
    destDir,
    opts.token,
  );
  if (!mirror.ok) {
    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    return {
      ok: false,
      reason: "mirror-failed",
      message: mirror.message,
      ...(mirror.rateLimit ? { rateLimit: mirror.rateLimit } : {}),
    };
  }

  const meta = readSkillMeta(destDir);
  if (!meta) {
    fs.rmSync(destDir, { recursive: true, force: true });
    return {
      ok: false,
      reason: "no-skill-md",
      message: `${opts.repo}/${folderPath} doesn't contain a SKILL.md with frontmatter. Make sure the URL points at a skill folder.`,
    };
  }

  // Canonical-name rename. The destination directory follows the
  // canonical name so future Updates re-fetch into the same path.
  let finalName = provisionalName;
  let finalDir = destDir;
  if (meta.name && meta.name !== provisionalName) {
    // Late-discovered name. Re-check collision; if free, rename
    // the folder.
    const collide = findSkillFolder(opts.registryRoot, meta.name);
    if (collide) {
      fs.rmSync(destDir, { recursive: true, force: true });
      return {
        ok: false,
        reason: "name-collision",
        name: meta.name,
        existingBucket: collide.bucket,
        existingDir: collide.dir,
      };
    }
    const renamed = path.join(opts.registryRoot, "skills", bucket, meta.name);
    fs.renameSync(destDir, renamed);
    finalName = meta.name;
    finalDir = renamed;
  }

  const origin: OriginPointer = {
    kind: "github",
    repo: opts.repo,
    skillPath: opts.skillPath,
    skillFolderHash: mirror.folderHash,
    installedAt: new Date().toISOString(),
  };
  writeSkillSource(finalDir, { source, origin });
  // Baseline the synced-hash sidecar using the LOCAL folder hash (same
  // algorithm as drift detection) rather than the git tree SHA stored in
  // origin.skillFolderHash — those are different hash functions and would
  // immediately trigger false-positive drift on every fresh install.
  const localHash = hashSkillFolder(finalDir);
  if (localHash) writeSyncedHash(finalDir, localHash);

  return {
    ok: true,
    name: finalName,
    bucket,
    destDir: finalDir,
    folderHash: mirror.folderHash,
  };
}
