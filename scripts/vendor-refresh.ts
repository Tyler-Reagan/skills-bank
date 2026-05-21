#!/usr/bin/env tsx
//
// Maintainer-internal: bulk-refresh vendored skills against their
// upstream GitHub sources. The single-skill counterpart is
// `vendor-skill.ts --force`; this script walks every vendored skill
// and applies the same refresh in batch.
//
// Usage:
//
//   pnpm vendor:refresh                 # review mode — print drift report, no writes
//   pnpm vendor:refresh --apply         # re-mirror skills whose upstream hash changed
//   pnpm vendor:refresh --only foo,bar  # restrict to a subset (comma-separated names)
//   pnpm vendor:refresh --json          # machine-readable report on stdout
//
// Per-skill opt-out: add `"refresh": "manual"` at the top level of
// `<skill>/.skills-bank.json` to pin a vendored skill against bulk
// refresh — used when the local copy has intentional forks/patches
// the maintainer doesn't want overwritten.
//
// What the script does NOT do automatically (by design):
//
//   * Follow GitHub repo renames/moves. A 404 on the upstream is
//     reported as "missing"; the maintainer updates the pointer by
//     hand or via `vendor:skill <new-owner/repo>@<id> --force`.
//   * Delete locally vendored skills whose upstream has vanished —
//     reported as "missing"; removal is a maintainer decision.
//   * Rewrite source markers beyond the upstream block. `source`
//     stays as-is; `skillFolderHash` and `installedAt` are updated
//     when --apply mirrors a new snapshot.
//
// Authentication: reads GITHUB_TOKEN from the environment. Without
// it the 60/hr unauth ceiling is hit quickly given the bank has
// 30+ vendored skills; warn-and-continue, since cached probes from
// distinct repos may still succeed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  findFolderHash,
  folderPathFromSkillPath,
  mirrorSkillFolder,
  ORIGIN_KIND_GITHUB,
  probeOriginTree,
  readSkillSource,
  writeSkillSource,
  writeSyncedHash,
  type GitTreeEntry,
  type SkillSource,
} from "../packages/core/src/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const VENDORED_ROOT = path.join(repoRoot, "skills", "vendored");

interface Args {
  apply: boolean;
  only: Set<string> | null;
  json: boolean;
}

function parseArgs(): Args {
  const out: Args = { apply: false, only: null, json: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--apply") out.apply = true;
    else if (a === "--json") out.json = true;
    else if (a === "--only") {
      const v = argv[++i];
      if (!v) {
        console.error("--only requires a comma-separated list of skill names");
        process.exit(1);
      }
      out.only = new Set(
        v
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === "--help" || a === "-h") {
      console.log(
        "usage: pnpm vendor:refresh [--apply] [--only name1,name2] [--json]",
      );
      process.exit(0);
    } else {
      console.error(`unknown arg: ${a}`);
      process.exit(1);
    }
  }
  return out;
}

interface Candidate {
  name: string;
  skillDir: string;
  source: SkillSource;
  /** "owner/repo" */
  repo: string;
  /** Path to SKILL.md within the upstream repo. */
  skillPath: string;
  /** Stored folder hash from the marker (may be missing on legacy markers). */
  storedHash: string | null;
}

type RefreshStatus =
  | "in-sync"
  | "drift"
  | "applied"
  | "missing"
  | "unreachable"
  | "manual-skip"
  | "skipped";

interface Result {
  name: string;
  status: RefreshStatus;
  detail?: string;
  upstreamHash?: string;
  storedHash?: string | null;
}

// Read the raw `.skills-bank.json` so we can spot the opt-out marker
// `refresh: "manual"` — readSkillSource drops unknown fields by
// design. Returns null when no marker file exists.
function readRefreshOptOut(skillDir: string): boolean {
  const p = path.join(skillDir, ".skills-bank.json");
  if (!fs.existsSync(p)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<
      string,
      unknown
    >;
    return raw["refresh"] === "manual";
  } catch {
    return false;
  }
}

function loadCandidates(only: Set<string> | null): {
  candidates: Candidate[];
  manualSkips: string[];
  skipped: { name: string; reason: string }[];
} {
  if (!fs.existsSync(VENDORED_ROOT)) {
    return { candidates: [], manualSkips: [], skipped: [] };
  }
  const candidates: Candidate[] = [];
  const manualSkips: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  for (const entry of fs.readdirSync(VENDORED_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name;
    if (only && !only.has(name)) continue;
    const skillDir = path.join(VENDORED_ROOT, name);
    const src = readSkillSource(skillDir);
    if (readRefreshOptOut(skillDir)) {
      manualSkips.push(name);
      continue;
    }
    const upstream = src.upstream;
    if (!upstream || upstream.kind !== ORIGIN_KIND_GITHUB) {
      skipped.push({ name, reason: "no github upstream pointer" });
      continue;
    }
    if (!upstream.repo || !upstream.skillPath) {
      skipped.push({ name, reason: "incomplete upstream pointer" });
      continue;
    }
    candidates.push({
      name,
      skillDir,
      source: src,
      repo: upstream.repo,
      skillPath: upstream.skillPath,
      storedHash: upstream.skillFolderHash ?? null,
    });
  }
  return { candidates, manualSkips, skipped };
}

// Bucket candidates by repo so each repo's tree is probed once
// regardless of how many vendored skills share it (vercel-labs/skills
// alone backs ~10 skills in this bank).
function groupByRepo(candidates: Candidate[]): Map<string, Candidate[]> {
  const m = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const bucket = m.get(c.repo);
    if (bucket) bucket.push(c);
    else m.set(c.repo, [c]);
  }
  return m;
}

async function refresh(): Promise<void> {
  const args = parseArgs();
  const token = process.env.GITHUB_TOKEN ?? null;
  if (!token && !args.json) {
    console.warn(
      "warn: GITHUB_TOKEN not set; running against the 60/hr unauth ceiling.",
    );
  }
  const { candidates, manualSkips, skipped } = loadCandidates(args.only);
  const results: Result[] = [];
  for (const name of manualSkips) {
    results.push({ name, status: "manual-skip" });
  }
  for (const s of skipped) {
    results.push({ name: s.name, status: "skipped", detail: s.reason });
  }
  const byRepo = groupByRepo(candidates);
  for (const [repo, group] of byRepo) {
    const probe = await probeOriginTree(repo, token);
    if (!probe.ok) {
      const detail = `probe failed (${probe.status}): ${probe.message}`;
      for (const c of group) {
        results.push({
          name: c.name,
          status: "unreachable",
          detail,
          storedHash: c.storedHash,
        });
      }
      continue;
    }
    if (probe.truncated) {
      for (const c of group) {
        results.push({
          name: c.name,
          status: "unreachable",
          detail: "upstream tree truncated; cannot diff safely",
          storedHash: c.storedHash,
        });
      }
      continue;
    }
    for (const c of group) {
      const folderPath = folderPathFromSkillPath(c.skillPath);
      const upstreamHash = findFolderHash(
        probe.tree as GitTreeEntry[],
        folderPath,
      );
      if (!upstreamHash) {
        results.push({
          name: c.name,
          status: "missing",
          detail: `${folderPath} not found in ${repo}@${probe.rootSha.slice(0, 7)}`,
          storedHash: c.storedHash,
        });
        continue;
      }
      if (c.storedHash && c.storedHash === upstreamHash) {
        results.push({
          name: c.name,
          status: "in-sync",
          storedHash: c.storedHash,
          upstreamHash,
        });
        continue;
      }
      if (!args.apply) {
        results.push({
          name: c.name,
          status: "drift",
          storedHash: c.storedHash,
          upstreamHash,
        });
        continue;
      }
      const mirror = await mirrorSkillFolder(
        c.repo,
        folderPath,
        c.skillDir,
        token,
      );
      if (!mirror.ok) {
        results.push({
          name: c.name,
          status: "unreachable",
          detail: `mirror failed (${mirror.status}): ${mirror.message}`,
          storedHash: c.storedHash,
          upstreamHash,
        });
        continue;
      }
      // Re-stamp the upstream pointer + drift baseline so the desktop
      // app's probe loop sees a clean state after the refresh commit
      // lands. installedAt is preserved (first-install timestamp is
      // immutable); only the hash baseline moves.
      const nextSource: SkillSource = {
        ...c.source,
        upstream: {
          ...c.source.upstream!,
          skillFolderHash: mirror.folderHash,
        },
      };
      writeSkillSource(c.skillDir, nextSource);
      writeSyncedHash(c.skillDir, mirror.folderHash);
      results.push({
        name: c.name,
        status: "applied",
        storedHash: c.storedHash,
        upstreamHash: mirror.folderHash,
      });
    }
  }
  if (args.json) {
    process.stdout.write(JSON.stringify(results, null, 2) + "\n");
    return;
  }
  printReport(results, args.apply);
}

function printReport(results: Result[], applied: boolean): void {
  const groups: Record<RefreshStatus, Result[]> = {
    "in-sync": [],
    drift: [],
    applied: [],
    missing: [],
    unreachable: [],
    "manual-skip": [],
    skipped: [],
  };
  for (const r of results) groups[r.status].push(r);
  const order: RefreshStatus[] = applied
    ? ["applied", "in-sync", "missing", "unreachable", "manual-skip", "skipped"]
    : ["drift", "in-sync", "missing", "unreachable", "manual-skip", "skipped"];
  const labels: Record<RefreshStatus, string> = {
    "in-sync": "In sync",
    drift: "Drift (re-run with --apply to refresh)",
    applied: "Refreshed",
    missing: "Missing upstream (404 / relocated)",
    unreachable: "Unreachable",
    "manual-skip": "Manual-refresh skips",
    skipped: "Skipped",
  };
  for (const status of order) {
    const rs = groups[status];
    if (rs.length === 0) continue;
    console.log(`\n== ${labels[status]} (${rs.length}) ==`);
    for (const r of rs) {
      const detail = r.detail ? `  — ${r.detail}` : "";
      const hashes =
        r.storedHash && r.upstreamHash && r.storedHash !== r.upstreamHash
          ? `  ${r.storedHash.slice(0, 7)} → ${r.upstreamHash.slice(0, 7)}`
          : "";
      console.log(`  ${r.name}${hashes}${detail}`);
    }
  }
  if (applied && groups.applied.length > 0) {
    console.log(
      "\nReview the working tree with `git diff` / `git status`, run " +
        "`pnpm validate && pnpm build:index`, and commit when satisfied.",
    );
  }
}

refresh().catch((err) => {
  console.error("vendor:refresh failed:", err);
  process.exit(1);
});
