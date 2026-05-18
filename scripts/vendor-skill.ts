#!/usr/bin/env tsx
//
// Maintainer-internal: vendor a skill from an upstream GitHub repo
// into this bundled-skills repo. Forward-vendoring tool — the
// counterpart to `discover-bundled-upstream.ts` (which is backfill).
//
// Usage:
//
//   pnpm vendor:skill <owner/repo>@<skill-id>
//   pnpm vendor:skill <owner/repo> --path <path-to-SKILL.md>
//   pnpm vendor:skill <owner/repo>@<skill-id> --as <local-name>
//   pnpm vendor:skill <owner/repo>@<skill-id> --force
//
// The script:
//   1. Resolves the in-repo path to the skill's SKILL.md (via
//      `npx skills find` against the catalog when `@skill-id` is
//      supplied, or via the explicit `--path` flag).
//   2. Mirrors the skill folder into `<repo-root>/skills/<name>/`
//      using the shared `mirrorSkillFolder` helper from core.
//   3. Writes `.skills-bank.json` with `kind: "github"`, repo,
//      sourceUrl, skillPath, skillFolderHash, installedAt, fetchedAt.
//   4. Writes `.skills-bank-hash` as the drift baseline (post-vendor
//      content == new clean state).
//   5. Prints `git status` for the maintainer to review and commit.
//
// Refuses to overwrite an existing `skills/<name>/` unless `--force`
// is given — protects against accidental clobbering.
//
// Authentication: uses GITHUB_TOKEN env var if present. Without it,
// hits the 60/hr unauth ceiling — fine for one-off invocations.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  folderPathFromSkillPath,
  hashSkillFolder,
  mirrorSkillFolder,
  readSkillSource,
  UPSTREAM_KIND_GITHUB,
  writeSkillSource,
  writeSyncedHash,
  type UpstreamPointer,
} from "../packages/core/src/index.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const ANSI_RE = /\x1b\[[0-9;]*m/g;

interface ParsedArg {
  repo: string;
  skillId: string | null;
  explicitPath: string | null;
  localName: string | null;
  force: boolean;
}

function usage(): never {
  console.error(
    "usage: pnpm vendor:skill <owner/repo>@<skill-id> [--as <name>] [--force]\n" +
      "       pnpm vendor:skill <owner/repo> --path <SKILL.md path> [--as <name>] [--force]",
  );
  process.exit(1);
}

function parseArgs(): ParsedArg {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();
  const spec = args[0]!;
  const out: ParsedArg = {
    repo: "",
    skillId: null,
    explicitPath: null,
    localName: null,
    force: false,
  };
  const atIdx = spec.indexOf("@");
  if (atIdx >= 0) {
    out.repo = spec.slice(0, atIdx);
    out.skillId = spec.slice(atIdx + 1);
  } else {
    out.repo = spec;
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(out.repo)) {
    console.error(`invalid owner/repo: ${out.repo}`);
    usage();
  }
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--path") {
      out.explicitPath = args[++i] ?? null;
    } else if (args[i] === "--as") {
      out.localName = args[++i] ?? null;
    } else if (args[i] === "--force") {
      out.force = true;
    } else {
      console.error(`unknown arg: ${args[i]}`);
      usage();
    }
  }
  if (!out.skillId && !out.explicitPath) {
    console.error(
      "must supply either @<skill-id> on the spec or --path <SKILL.md path>",
    );
    usage();
  }
  return out;
}

interface FindResult {
  owner: string;
  repo: string;
  skillId: string;
}

/**
 * Look up the in-repo skill path via `npx skills find` and pick the
 * row matching `<owner>/<repo>@<skill-id>` exactly. Returns the
 * skills.sh URL's reported skill-id; the actual SKILL.md path is
 * resolved by probing later.
 */
async function npxFindMatch(
  repo: string,
  skillId: string,
): Promise<FindResult | null> {
  let stdout: string;
  try {
    const r = await execFileAsync("npx", ["-y", "skills", "find", skillId], {
      timeout: 30_000,
    });
    stdout = r.stdout;
  } catch (err) {
    const e = err as { stdout?: string };
    if (typeof e.stdout !== "string") return null;
    stdout = e.stdout;
  }
  const [wantOwner, wantRepo] = repo.split("/");
  const re = /^([\w.-]+)\/([\w.-]+)@([\w.-]+)/;
  for (const line of stdout.replace(ANSI_RE, "").split("\n")) {
    const m = line.match(re);
    if (!m) continue;
    if (m[1] === wantOwner && m[2] === wantRepo && m[3] === skillId) {
      return { owner: m[1]!, repo: m[2]!, skillId: m[3]! };
    }
  }
  return null;
}

/**
 * Locate SKILL.md in the repo via frontmatter `name:` match — the
 * same fallback discover-bundled-upstream uses. Lets vendor:skill
 * succeed when skills.sh's skill-id doesn't match the source folder
 * name. Only fires when `--path` isn't supplied.
 */
async function resolveSkillPath(
  repo: string,
  skillId: string,
  token: string | null,
): Promise<string | null> {
  const { probeRepoTree, findFolderHash } = await import(
    "../packages/core/src/index.js"
  );
  void findFolderHash; // silence unused-import in this scope; mirror handles it
  const probe = await probeRepoTree(repo, token);
  if (!probe.ok || probe.truncated) return null;
  const skillMd = probe.tree.filter(
    (e) =>
      e.type === "blob" &&
      (e.path.endsWith("/SKILL.md") || e.path === "SKILL.md"),
  );
  // Folder match first.
  const folderMatches = skillMd
    .filter((e) => {
      const folder = folderPathFromSkillPath(e.path);
      return folder.endsWith(`/${skillId}`) || folder === skillId;
    })
    .map((e) => e.path);
  if (folderMatches.length > 0) {
    folderMatches.sort((a, b) => a.split("/").length - b.split("/").length);
    return folderMatches[0]!;
  }
  // Frontmatter fallback.
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "skills-bank",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const nameRe = /^name:\s*([^\s#]+)/m;
  for (const e of skillMd) {
    const url = `https://api.github.com/repos/${repo}/contents/${e.path}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const body = await res.text();
      const m = body.match(nameRe);
      if (m && m[1] === skillId) return e.path;
    } catch {
      // continue
    }
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const token = process.env["GITHUB_TOKEN"] ?? null;

  // Resolve the in-repo SKILL.md path.
  let skillPath: string;
  if (args.explicitPath) {
    skillPath = args.explicitPath;
    if (!skillPath.endsWith("SKILL.md")) {
      console.error(`--path must end in SKILL.md: ${skillPath}`);
      process.exit(1);
    }
  } else {
    const find = await npxFindMatch(args.repo, args.skillId!);
    if (!find) {
      console.error(
        `no match for ${args.repo}@${args.skillId} in skills.sh's catalog. ` +
          `Supply --path to override.`,
      );
      process.exit(1);
    }
    const resolved = await resolveSkillPath(args.repo, args.skillId!, token);
    if (!resolved) {
      console.error(
        `couldn't locate SKILL.md for ${args.skillId} in ${args.repo}. ` +
          `Supply --path to override.`,
      );
      process.exit(1);
    }
    skillPath = resolved;
  }

  const folderPath = folderPathFromSkillPath(skillPath);
  const folderLeaf = folderPath.slice(folderPath.lastIndexOf("/") + 1);
  const localName = args.localName ?? args.skillId ?? folderLeaf;
  const destDir = path.join(repoRoot, "skills", localName);

  if (fs.existsSync(destDir) && !args.force) {
    console.error(
      `skills/${localName}/ already exists. Pass --force to overwrite, ` +
        `or --as <name> to vendor under a different folder name.`,
    );
    process.exit(1);
  }

  console.log(
    `vendoring ${args.repo}/${folderPath} → skills/${localName}/ ...`,
  );

  const mirror = await mirrorSkillFolder(
    args.repo,
    folderPath,
    destDir,
    token,
  );
  if (!mirror.ok) {
    console.error(`mirror failed: ${mirror.message}`);
    process.exit(1);
  }

  // Write marker + baseline.
  const now = new Date().toISOString();
  const pointer: UpstreamPointer = {
    kind: UPSTREAM_KIND_GITHUB,
    repo: args.repo,
    sourceUrl: `https://github.com/${args.repo}.git`,
    skillPath,
    skillFolderHash: mirror.folderHash,
    installedAt: now,
    fetchedAt: now,
  };
  const existing = readSkillSource(destDir);
  writeSkillSource(destDir, { ...existing, upstream: pointer });
  const baseline = hashSkillFolder(destDir);
  if (baseline) writeSyncedHash(destDir, baseline);

  console.log(
    `\nvendored ${mirror.fileCount} files. Review with:\n` +
      `  git status skills/${localName}/\n` +
      `  git diff skills/${localName}/\n` +
      `\nWhen happy, stage + commit.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
