import fs from "node:fs";
import path from "node:path";
import { readSkillMeta } from "./registry.js";

/**
 * Per-skill discovery output from `discoverSkillsInTree`. Captures
 * just enough to mount the skill into the active registry root:
 * the canonical name (from SKILL.md frontmatter, with folder basename
 * as fallback), the source-tree location, and the path relative to
 * the walk root so callers can stamp `upstream.skillPath` round-trip-safely.
 */
export interface SkillDiscovery {
  /** Canonical skill name. */
  name: string;
  /** Absolute path of the discovered skill folder in the source tree. */
  sourceDir: string;
  /** Path relative to the walk root (no leading slash). */
  relPath: string;
  /** Path to SKILL.md within `sourceDir`. */
  skillMdRelPath: string;
}

export interface DiscoveryReport {
  discoveries: SkillDiscovery[];
  /**
   * Skill-name collisions across the tree. Reported but never auto-
   * resolved: the caller (sync, link) decides whether to abort or
   * surface to the user.
   */
  collisions: { name: string; paths: string[] }[];
  /**
   * A skill folder (SKILL.md / meta.json present) located inside
   * another skill folder. The outer is still discovered; the inner
   * is suppressed and surfaced here so the caller can warn rather
   * than silently mount a half-skill.
   */
  nested: { outer: string; inner: string }[];
}

export interface DiscoveryOptions {
  /**
   * Directory basenames to skip. Defaults to `.git`, `node_modules`,
   * `dist`, `build`, plus any basename starting with `.`.
   */
  skipDirs?: Set<string>;
  /**
   * Max walk depth (1 = direct children of `root`). Default 8 — covers
   * `docs/skills/<category>/<name>/` patterns while bounding accidental
   * filesystem loops.
   */
  maxDepth?: number;
}

const DEFAULT_SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  ".skills-bank",
]);

const DEFAULT_MAX_DEPTH = 8;

/**
 * Walk a source tree and identify every skill folder by file
 * convention: a directory containing `SKILL.md` and/or `meta.json`.
 * Stops descending into a directory the moment it's recognized as
 * a skill — anything skill-shaped underneath is surfaced via
 * `nested`, never emitted as its own discovery.
 *
 * Pure read; no mutations. Designed for use during link/sync flows
 * where the source layout is whatever the linked/curated repo
 * happens to use (flat, bucketed, deeply nested, anything).
 */
export function discoverSkillsInTree(
  root: string,
  opts: DiscoveryOptions = {},
): DiscoveryReport {
  const skipDirs = opts.skipDirs ?? DEFAULT_SKIP_DIRS;
  const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;

  const discoveries: SkillDiscovery[] = [];
  const nested: { outer: string; inner: string }[] = [];

  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    return { discoveries, collisions: [], nested };
  }

  walk(root, "", 0);

  // Group by name + report cross-path collisions. Discoveries that
  // collide are dropped from the report — the caller must resolve
  // before mounting.
  const byName = new Map<string, SkillDiscovery[]>();
  for (const d of discoveries) {
    const list = byName.get(d.name) ?? [];
    list.push(d);
    byName.set(d.name, list);
  }
  const collisions: { name: string; paths: string[] }[] = [];
  const deduped: SkillDiscovery[] = [];
  for (const [name, list] of byName) {
    if (list.length > 1) {
      collisions.push({ name, paths: list.map((d) => d.relPath) });
    } else {
      deduped.push(list[0]!);
    }
  }
  deduped.sort((a, b) => a.name.localeCompare(b.name));

  return { discoveries: deduped, collisions, nested };

  function walk(dir: string, relDir: string, depth: number): void {
    if (depth > maxDepth) return;

    const skillMd = path.join(dir, "SKILL.md");
    const hasSkillMd = fs.existsSync(skillMd) && fs.statSync(skillMd).isFile();

    // Recognized as a skill folder — emit + STOP descending. Anything
    // skill-shaped underneath is surfaced via `nested`.
    if (hasSkillMd && relDir !== "") {
      const meta = readSkillMeta(dir);
      const folderBase = path.basename(dir);
      const name = meta?.name ?? folderBase;
      discoveries.push({
        name,
        sourceDir: dir,
        relPath: relDir,
        skillMdRelPath: path.join(relDir, "SKILL.md"),
      });
      collectNested(dir, relDir);
      return;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (skipDirs.has(ent.name) || ent.name.startsWith(".")) continue;
      walk(
        path.join(dir, ent.name),
        relDir === "" ? ent.name : path.posix.join(relDir, ent.name),
        depth + 1,
      );
    }
  }

  function collectNested(outerDir: string, outerRel: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(outerDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (DEFAULT_SKIP_DIRS.has(ent.name) || ent.name.startsWith(".")) continue;
      const innerDir = path.join(outerDir, ent.name);
      const innerSkillMd = path.join(innerDir, "SKILL.md");
      if (fs.existsSync(innerSkillMd)) {
        nested.push({
          outer: outerRel,
          inner: path.posix.join(outerRel, ent.name),
        });
      }
      // Recurse so a skill three deep inside another skill still surfaces.
      collectNested(innerDir, path.posix.join(outerRel, ent.name));
    }
  }
}
