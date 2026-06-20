#!/usr/bin/env tsx
//
// Maintainer-internal: vendor a skill from an upstream GitHub repo
// into this bundled-skills repo. Forward-vendoring tool — the
// counterpart to `discover-bundled-upstream.ts` (which is backfill).
//
// Usage:
//
//   pnpm bank vendor <owner/repo>@<skill-id>
//   pnpm bank vendor <owner/repo> --path <path-to-SKILL.md>
//   pnpm bank vendor <owner/repo>@<skill-id> --as <local-name>
//   pnpm bank vendor <owner/repo>@<skill-id> --force
//   pnpm bank vendor <owner/repo>@<skill-id> --no-synthesize-meta
//
// The script:
//   1. Resolves the in-repo path to the skill's SKILL.md (via
//      `npx skills find` against the catalog when `@skill-id` is
//      supplied, or via the explicit `--path` flag).
//   2. Mirrors the skill folder into `<repo-root>/skills/<name>/`
//      using the shared `installSkillFiles` helper from core.
//   3. Writes `.skills-bank.json` with `kind: "github"`, repo,
//      sourceUrl, skillPath, skillFolderHash, installedAt, fetchedAt.
//   4. Writes `.skills-bank-hash` as the drift baseline.
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
  installSkillFiles,
  readSkillSource,
  ORIGIN_KIND_GITHUB,
  writeSkillSource,
  writeSyncedHash,
  type OriginPointer,
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
  bucket: import("../packages/core/src/index.js").SkillBucket;
  force: boolean;
}

function usage(): never {
  console.error(
    "usage: pnpm bank vendor <owner/repo>@<skill-id> [--as <name>] [--personal] [--force]\n" +
      "       pnpm bank vendor <owner/repo> --path <SKILL.md path> [--as <name>] [--personal] [--force]\n" +
      "\n" +
      "Defaults destination to skills/vendored/<name>/. Pass --personal to write\n" +
      "to skills/personal/<name>/ instead — for forks the maintainer is taking\n" +
      "ownership of.",
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
    bucket: "vendored",
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
    } else if (args[i] === "--personal") {
      out.bucket = "personal";
    } else if (args[i] === "--vendored") {
      out.bucket = "vendored";
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
 * same fallback discover-bundled-upstream uses. Lets bank vendor
 * succeed when skills.sh's skill-id doesn't match the source folder
 * name. Only fires when `--path` isn't supplied.
 */
async function resolveSkillPath(
  repo: string,
  skillId: string,
  token: string | null,
): Promise<string | null> {
  const { fetchOriginTree, findFolderHash } =
    await import("../packages/core/src/index.js");
  void findFolderHash; // silence unused-import in this scope; mirror handles it
  const probe = await fetchOriginTree(repo, token);
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
  const destDir = path.join(repoRoot, "skills", args.bucket, localName);
  const destRel = `skills/${args.bucket}/${localName}`;

  if (fs.existsSync(destDir) && !args.force) {
    console.error(
      `${destRel}/ already exists. Pass --force to overwrite, ` +
        `or --as <name> to vendor under a different folder name.`,
    );
    process.exit(1);
  }

  // Cross-bucket collision: bail rather than silently shadow.
  const otherBucket = args.bucket === "personal" ? "vendored" : "personal";
  const otherPath = path.join(repoRoot, "skills", otherBucket, localName);
  if (fs.existsSync(otherPath)) {
    console.error(
      `${localName} already exists in skills/${otherBucket}/. Skill names must ` +
        `be unique across buckets. Use --as <name> to disambiguate.`,
    );
    process.exit(1);
  }

  console.log(`vendoring ${args.repo}/${folderPath} → ${destRel}/ ...`);

  const mirror = await installSkillFiles(args.repo, folderPath, destDir, token);
  if (!mirror.ok) {
    console.error(`mirror failed: ${mirror.message}`);
    process.exit(1);
  }

  // Write marker + baseline.
  const now = new Date().toISOString();
  const pointer: OriginPointer = {
    kind: ORIGIN_KIND_GITHUB,
    repo: args.repo,
    sourceUrl: `https://github.com/${args.repo}.git`,
    skillPath,
    skillFolderHash: mirror.folderHash,
    installedAt: now,
    fetchedAt: now,
  };
  const existing = readSkillSource(destDir);
  // Source axis follows the bucket: a third-party vendor → `vendored`; a
  // fork the maintainer is taking ownership of (`--personal`) → `user`.
  writeSkillSource(destDir, {
    ...existing,
    source: args.bucket === "personal" ? "user" : "vendored",
    origin: pointer,
  });
  const baseline = hashSkillFolder(destDir);
  if (baseline) writeSyncedHash(destDir, baseline);

  console.log(
    `\nvendored ${mirror.fileCount} files. Review with:\n` +
      `  git status ${destRel}/\n` +
      `  git diff ${destRel}/\n` +
      `\nWhen happy, stage + commit.`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
