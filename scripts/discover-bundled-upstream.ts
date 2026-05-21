#!/usr/bin/env tsx
//
// Maintainer-internal: discover the authoritative upstream for each
// bundled skill that doesn't yet have an `upstream` field in its
// `.skills-bank.json`. Uses `npx skills find <name>` (non-interactive,
// unauthenticated, parses skills.sh's catalog) to resolve owner/repo +
// skill-id, then probes the resolved repo's recursive tree to locate
// the SKILL.md path and capture the current folder tree hash.
//
// Workflow:
//
//   tsx scripts/discover-bundled-upstream.ts                            # write candidate JSON to stdout
//   tsx scripts/discover-bundled-upstream.ts --out CAND.json            # write to file
//   tsx scripts/discover-bundled-upstream.ts --apply CAND.json          # apply markers from JSON
//   tsx scripts/discover-bundled-upstream.ts --apply CAND.json --source yours
//                                                                       # override default source axis
//
// The two-phase split is deliberate: discovery emits a candidate
// mapping the maintainer can review (and hand-correct for skills
// where the top match is wrong) before any markers get written.
//
// Apply-phase markers default to `source: "bundled"` — this tool is
// for skills the maintainer is intentionally adding to the bundled
// set. Pass `--source yours` for the rare personal-skill case.
//
// Authentication: probes use the GITHUB_TOKEN env var if present,
// else fall back to the unauthenticated 60/hr ceiling. For a 39-skill
// run, unauth is borderline — supply a token to be safe:
//
//   GITHUB_TOKEN=ghp_... tsx scripts/discover-bundled-upstream.ts

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  findFolderHash,
  folderPathFromSkillPath,
  hashSkillFolder,
  probeOriginTree,
  readSkillSource,
  ORIGIN_KIND_GITHUB,
  walkSkills,
  writeSkillSource,
  writeSyncedHash,
  type SkillOrigin,
  type OriginPointer,
} from "../packages/core/src/index.js";

const execFileAsync = promisify(execFile);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

interface Candidate {
  /** GitHub `owner/repo` resolved from `npx skills find`. */
  repo: string;
  /** Path to SKILL.md within `repo`, resolved by probing the tree. */
  skillPath: string;
  /** SHA-1 git tree hash of the skill folder at probe time. */
  skillFolderHash: string;
  /** Best-match skill-id from skills.sh (typically equals the bundled
   *  folder name, but recorded for audit). */
  skillId: string;
  /** Installs count reported by skills.sh — surfaces popularity for
   *  the maintainer's audit pass. */
  installs: number;
}

interface CandidateMap {
  version: 1;
  /** Skills the script couldn't resolve. Maintainer either adds them
   *  manually here before re-running with --apply, or stamps them as
   *  self-authored via stamp-self-authored.ts. */
  unresolved: string[];
  /** Successfully-resolved skills, keyed by local folder name. */
  skills: Record<string, Candidate>;
}

const ANSI_RE = /\x1b\[[0-9;]*m/g;

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

function parseInstalls(raw: string): number {
  const m = raw.trim().match(/^([\d.]+)([KMB]?)$/);
  if (!m) return 0;
  const [, num, unit] = m;
  const mult = unit === "K" ? 1e3 : unit === "M" ? 1e6 : unit === "B" ? 1e9 : 1;
  return Math.round(parseFloat(num!) * mult);
}

interface FindResult {
  owner: string;
  repo: string;
  skillId: string;
  installs: number;
}

/**
 * Run `npx skills find <name>` and parse the line-oriented output.
 *
 *   pbakaus/impeccable@impeccable  99.6K installs
 *
 * Returns all matches in encountered order. Empty array on no
 * matches or any CLI failure (treated as "unresolved").
 */
async function npxFind(name: string): Promise<FindResult[]> {
  let stdout: string;
  try {
    const r = await execFileAsync("npx", ["-y", "skills", "find", name], {
      // Empty stdin so the CLI's interactive prompt short-circuits.
      input: "",
      timeout: 30_000,
      // The CLI emits ANSI; we strip below. `FORCE_COLOR=0` would also
      // work but is brittler across versions.
    } as Parameters<typeof execFileAsync>[2]);
    stdout = r.stdout;
  } catch (err) {
    // Some `find` invocations exit non-zero when there are no matches.
    // Treat the stdout we did capture as authoritative.
    const e = err as { stdout?: string };
    if (typeof e.stdout === "string") {
      stdout = e.stdout;
    } else {
      return [];
    }
  }
  const lines = stripAnsi(stdout).split("\n");
  const results: FindResult[] = [];
  const lineRe = /^([\w.-]+)\/([\w.-]+)@([\w.-]+)\s+([\d.]+[KMB]?)\s+installs?/;
  for (const line of lines) {
    const m = line.match(lineRe);
    if (!m) continue;
    const [, owner, repo, skillId, installsRaw] = m;
    results.push({
      owner: owner!,
      repo: repo!,
      skillId: skillId!,
      installs: parseInstalls(installsRaw!),
    });
  }
  return results;
}

/**
 * Pick the best `npx skills find` match for a bundled folder name.
 * Exact `@skill-id` match wins; ties broken by install count desc.
 * Returns null when no row exact-matches.
 */
function pickMatch(
  bundledName: string,
  matches: FindResult[],
): FindResult | null {
  const exact = matches.filter((m) => m.skillId === bundledName);
  if (exact.length === 0) return null;
  exact.sort((a, b) => b.installs - a.installs);
  return exact[0]!;
}

type ProbeTree =
  ReturnType<typeof probeOriginTree> extends Promise<infer R>
    ? R extends { ok: true; tree: infer T }
      ? T
      : never
    : never;

/**
 * Locate the SKILL.md path for `skillId` within the repo's tree.
 *
 * Two strategies, in order:
 *   1. Folder-name match — most repos use `<...>/<skill-id>/SKILL.md`.
 *      Pick shallowest match.
 *   2. Frontmatter `name:` match — skills.sh assigns skill-ids that
 *      don't always equal the source folder name (e.g.
 *      kostja94/marketing-skills's `404-page-generator` lives at
 *      `skills/pages/utility/404/SKILL.md`). When folder-match fails,
 *      fetch each SKILL.md blob and parse YAML frontmatter for
 *      `name: <skill-id>`. Costs ~N blob fetches per repo (where N
 *      is the SKILL.md count); only triggered when the cheap match
 *      misses.
 */
async function findSkillPath(
  repo: string,
  tree: ProbeTree,
  skillId: string,
  token: string | null,
): Promise<string | null> {
  // Pass 1: folder-name match.
  const folderMatches: string[] = [];
  for (const e of tree) {
    if (e.type !== "blob") continue;
    if (!e.path.endsWith("/SKILL.md") && e.path !== "SKILL.md") continue;
    const folder = folderPathFromSkillPath(e.path);
    if (folder.endsWith(`/${skillId}`) || folder === skillId) {
      folderMatches.push(e.path);
    }
  }
  if (folderMatches.length > 0) {
    folderMatches.sort((a, b) => a.split("/").length - b.split("/").length);
    return folderMatches[0]!;
  }

  // Pass 2: frontmatter name match.
  const skillMdEntries = tree.filter(
    (e) =>
      e.type === "blob" &&
      (e.path.endsWith("/SKILL.md") || e.path === "SKILL.md"),
  );
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.raw",
    "User-Agent": "skills-bank",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const nameRe = /^name:\s*([^\s#]+)/m;
  for (const entry of skillMdEntries) {
    const url = `https://api.github.com/repos/${repo}/contents/${entry.path}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) continue;
      const body = await res.text();
      const m = body.match(nameRe);
      if (!m) continue;
      if (m[1] === skillId) return entry.path;
    } catch {
      // Skip transport failures; next iteration tries next blob.
    }
  }
  return null;
}

async function discoverPhase(): Promise<CandidateMap> {
  const token = process.env["GITHUB_TOKEN"] ?? null;
  const treeCache = new Map<
    string,
    Awaited<ReturnType<typeof probeOriginTree>>
  >();

  async function probeCached(repo: string) {
    if (treeCache.has(repo)) return treeCache.get(repo)!;
    const r = await probeOriginTree(repo, token);
    treeCache.set(repo, r);
    return r;
  }

  const skills: Record<string, Candidate> = {};
  const unresolved: string[] = [];

  for (const ref of walkSkills(repoRoot)) {
    const name = ref.name;
    const base = readSkillSource(ref.dir);
    if (base.upstream !== undefined) continue;

    process.stderr.write(`  ${name} ... `);
    const matches = await npxFind(name);
    const best = pickMatch(name, matches);
    if (!best) {
      process.stderr.write(`no exact match (${matches.length} rows)\n`);
      unresolved.push(name);
      continue;
    }

    const repo = `${best.owner}/${best.repo}`;
    const probe = await probeCached(repo);
    if (!probe.ok) {
      process.stderr.write(`probe failed (${probe.message})\n`);
      unresolved.push(name);
      continue;
    }
    if (probe.truncated) {
      process.stderr.write(`tree truncated\n`);
      unresolved.push(name);
      continue;
    }

    const skillPath = await findSkillPath(
      repo,
      probe.tree,
      best.skillId,
      token,
    );
    if (!skillPath) {
      process.stderr.write(`SKILL.md not located in tree\n`);
      unresolved.push(name);
      continue;
    }
    const folderPath = folderPathFromSkillPath(skillPath);
    const folderHash = findFolderHash(probe.tree, folderPath);
    if (!folderHash) {
      process.stderr.write(`folder hash not in tree\n`);
      unresolved.push(name);
      continue;
    }

    skills[name] = {
      repo,
      skillPath,
      skillFolderHash: folderHash,
      skillId: best.skillId,
      installs: best.installs,
    };
    process.stderr.write(`${repo} :: ${skillPath}\n`);
  }

  return { version: 1, unresolved, skills };
}

function parseSourceFlag(): SkillOrigin {
  const idx = process.argv.indexOf("--source");
  if (idx < 0) return "bundled";
  const v = process.argv[idx + 1];
  if (v === "bundled" || v === "yours") return v;
  console.error(
    `--source must be "bundled" or "yours" (got: ${v ?? "<missing>"})`,
  );
  process.exit(1);
}

function applyPhase(cand: CandidateMap, sourceDefault: SkillOrigin): void {
  const refsByName = new Map(
    walkSkills(repoRoot).map((r) => [r.name, r] as const),
  );
  const now = new Date().toISOString();
  let stamped = 0;
  for (const [name, c] of Object.entries(cand.skills)) {
    const ref = refsByName.get(name);
    if (!ref) {
      console.warn(`skip ${name}: folder missing`);
      continue;
    }
    const skillDir = ref.dir;
    const base = readSkillSource(skillDir);
    if (base.upstream !== undefined) {
      console.warn(`skip ${name}: already stamped`);
      continue;
    }
    const pointer: OriginPointer = {
      kind: ORIGIN_KIND_GITHUB,
      repo: c.repo,
      sourceUrl: `https://github.com/${c.repo}.git`,
      skillPath: c.skillPath,
      skillFolderHash: c.skillFolderHash,
      installedAt: now,
      fetchedAt: now,
    };
    // Default new markers to `source: "bundled"` — this tool stamps
    // skills the maintainer is intentionally adding to the bundled
    // set. `readSkillSource` returns `source: "yours"` both when the
    // marker file is missing AND when it exists with that value, so
    // we can't distinguish; just write the desired default directly.
    // `--source yours` overrides for the rare personal-skill case.
    writeSkillSource(skillDir, {
      ...base,
      source: sourceDefault,
      upstream: pointer,
    });
    const baseline = hashSkillFolder(skillDir);
    if (baseline) writeSyncedHash(skillDir, baseline);
    stamped++;
  }
  console.log(`stamped: ${stamped}`);
  if (cand.unresolved.length > 0) {
    console.log(
      `unresolved (${cand.unresolved.length}) — stamp via ` +
        `scripts/stamp-self-authored.ts or hand-edit the candidate JSON:`,
    );
    for (const n of cand.unresolved) console.log(`  ${n}`);
  }
}

async function main(): Promise<void> {
  const applyIdx = process.argv.indexOf("--apply");
  if (applyIdx >= 0) {
    const p = process.argv[applyIdx + 1];
    if (!p) {
      console.error("--apply requires a JSON path");
      process.exit(1);
    }
    const cand = JSON.parse(fs.readFileSync(p, "utf8")) as CandidateMap;
    if (cand.version !== 1) {
      console.error(`unexpected candidate JSON version: ${cand.version}`);
      process.exit(1);
    }
    const sourceDefault = parseSourceFlag();
    applyPhase(cand, sourceDefault);
    return;
  }

  process.stderr.write("discovering upstreams via npx skills find:\n");
  const cand = await discoverPhase();
  const outIdx = process.argv.indexOf("--out");
  const json = JSON.stringify(cand, null, 2);
  if (outIdx >= 0 && process.argv[outIdx + 1]) {
    fs.writeFileSync(process.argv[outIdx + 1]!, json + "\n");
    process.stderr.write(
      `\nwrote ${Object.keys(cand.skills).length} resolved, ` +
        `${cand.unresolved.length} unresolved → ${process.argv[outIdx + 1]}\n`,
    );
  } else {
    console.log(json);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
