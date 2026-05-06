import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import pc from "picocolors";
import {
  getClaudeSkillsDir,
  resolveRegistryRoot,
} from "@skills-bank/core";

interface Options {
  dryRun?: boolean;
  yes?: boolean;
  root?: string;
}

interface Plan {
  folderMoves: Array<{ from: string; to: string }>;
  metaScrubs: Array<{ path: string; willRemove: string[] }>;
  symlinkRepoints: Array<{
    linkPath: string;
    fromTarget: string;
    toTarget: string;
  }>;
}

/**
 * One-time migration: flatten skills/<category>/<name>/ to skills/<name>/,
 * remove `domain` from every meta.json, and re-point any installed
 * symlink that pointed at the old nested path. Idempotent: running again
 * is a no-op once the tree is flat.
 */
export async function migrateCategoriesCommand(
  opts: Options,
): Promise<void> {
  const root = resolveRegistryRoot(opts.root);
  const skillsDir = path.join(root, "skills");
  const claudeSkills = getClaudeSkillsDir();

  const plan: Plan = {
    folderMoves: [],
    metaScrubs: [],
    symlinkRepoints: [],
  };

  if (!fs.existsSync(skillsDir)) {
    console.log(pc.dim("No skills/ directory; nothing to do."));
    return;
  }

  // 1. Find all category subdirs that actually contain skill folders.
  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const catDir = path.join(skillsDir, ent.name);
    // A skill folder has meta.json or SKILL.md directly inside.
    const looksLikeSkillItself =
      fs.existsSync(path.join(catDir, "meta.json")) ||
      fs.existsSync(path.join(catDir, "SKILL.md"));
    if (looksLikeSkillItself) continue; // already a flat skill folder
    // Otherwise treat as a category dir; queue every child as a move.
    for (const child of fs.readdirSync(catDir, { withFileTypes: true })) {
      if (!child.isDirectory()) continue;
      const from = path.join(catDir, child.name);
      const to = path.join(skillsDir, child.name);
      if (fs.existsSync(to)) {
        console.error(
          pc.red(
            `Cannot move ${path.relative(root, from)} → ${path.relative(
              root,
              to,
            )}: destination already exists. Resolve manually before re-running.`,
          ),
        );
        process.exit(1);
      }
      plan.folderMoves.push({ from, to });
    }
  }

  // 2. Plan meta.json scrubs. Read each meta.json at its CURRENT path
  //    (pre-move for things being moved, in-place for things already flat),
  //    but record the POST-move path on the plan so the execute step uses
  //    the correct location regardless of move ordering.
  type ScrubCandidate = { currentPath: string; finalPath: string };
  const scrubCandidates: ScrubCandidate[] = [];
  // Already-flat skills (skills/<name>/meta.json).
  for (const ent of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!ent.isDirectory()) continue;
    const dir = path.join(skillsDir, ent.name);
    const metaPath = path.join(dir, "meta.json");
    if (!fs.existsSync(metaPath)) continue;
    // Skip category dirs whose immediate children are skills (these are
    // covered by folderMoves below, and the meta.json doesn't live here).
    const looksLikeSkill =
      fs.existsSync(metaPath) || fs.existsSync(path.join(dir, "SKILL.md"));
    if (!looksLikeSkill) continue;
    scrubCandidates.push({ currentPath: metaPath, finalPath: metaPath });
  }
  // Skills being moved: read meta.json from m.from but write to m.to.
  for (const m of plan.folderMoves) {
    const currentPath = path.join(m.from, "meta.json");
    const finalPath = path.join(m.to, "meta.json");
    if (fs.existsSync(currentPath))
      scrubCandidates.push({ currentPath, finalPath });
  }
  for (const c of scrubCandidates) {
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(fs.readFileSync(c.currentPath, "utf8"));
    } catch {
      continue;
    }
    const willRemove: string[] = [];
    if ("domain" in raw) willRemove.push("domain");
    if (willRemove.length > 0)
      plan.metaScrubs.push({ path: c.finalPath, willRemove });
  }

  // 3. Find symlinks under ~/.claude/skills that point into the old nested
  //    layout (skills/<cat>/<name>) and need to be re-pointed to skills/<name>.
  if (fs.existsSync(claudeSkills)) {
    for (const name of fs.readdirSync(claudeSkills)) {
      const linkPath = path.join(claudeSkills, name);
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(linkPath);
      } catch {
        continue;
      }
      if (!stat.isSymbolicLink()) continue;
      const target = path.resolve(claudeSkills, fs.readlinkSync(linkPath));
      // Match if target is exactly <root>/skills/<cat>/<name>
      const skillsPrefix = path.resolve(skillsDir) + path.sep;
      if (!target.startsWith(skillsPrefix)) continue;
      const rest = target.slice(skillsPrefix.length).split(path.sep);
      if (rest.length !== 2) continue; // not the nested case
      const flatTarget = path.join(skillsDir, rest[1]!);
      // Only re-point if the new flat path is what's coming, or already exists.
      const flatWillExist =
        fs.existsSync(flatTarget) ||
        plan.folderMoves.some((m) => m.to === flatTarget);
      if (!flatWillExist) continue;
      plan.symlinkRepoints.push({
        linkPath,
        fromTarget: target,
        toTarget: flatTarget,
      });
    }
  }

  // ─── Print the plan ──────────────────────────────────────────────
  console.log(pc.bold("migrate-categories"));
  console.log(`  registry: ${root}`);
  console.log();

  if (
    plan.folderMoves.length === 0 &&
    plan.metaScrubs.length === 0 &&
    plan.symlinkRepoints.length === 0
  ) {
    console.log(pc.green("Already migrated — nothing to do."));
    return;
  }

  if (plan.folderMoves.length > 0) {
    console.log(
      pc.bold(
        `Folder moves (${plan.folderMoves.length}):`,
      ),
    );
    for (const m of plan.folderMoves) {
      console.log(
        `  ${pc.cyan("⇄")} ${path.relative(root, m.from)} → ${path.relative(
          root,
          m.to,
        )}`,
      );
    }
    console.log();
  }
  if (plan.metaScrubs.length > 0) {
    console.log(pc.bold(`meta.json scrubs (${plan.metaScrubs.length}):`));
    for (const s of plan.metaScrubs) {
      console.log(
        `  ${pc.yellow("✎")} ${path.relative(root, s.path)} — drop ${s.willRemove.join(", ")}`,
      );
    }
    console.log();
  }
  if (plan.symlinkRepoints.length > 0) {
    console.log(
      pc.bold(`Symlink re-points (${plan.symlinkRepoints.length}):`),
    );
    for (const s of plan.symlinkRepoints) {
      console.log(
        `  ${pc.cyan("→")} ${s.linkPath}\n      from ${s.fromTarget}\n      to   ${s.toTarget}`,
      );
    }
    console.log();
  }

  if (opts.dryRun) {
    console.log(pc.dim("--dry-run: no changes made."));
    return;
  }

  if (!opts.yes) {
    const ok = await prompt("Apply this plan? [y/N] ");
    if (!/^y(es)?$/i.test(ok.trim())) {
      console.log(pc.dim("aborted"));
      return;
    }
  }

  // ─── Execute ─────────────────────────────────────────────────────
  console.log();
  for (const m of plan.folderMoves) {
    fs.mkdirSync(path.dirname(m.to), { recursive: true });
    fs.renameSync(m.from, m.to);
    console.log(`  ${pc.green("✓")} moved ${path.relative(root, m.from)}`);
  }
  for (const s of plan.metaScrubs) {
    try {
      const raw = JSON.parse(fs.readFileSync(s.path, "utf8")) as Record<string, unknown>;
      for (const k of s.willRemove) delete raw[k];
      fs.writeFileSync(s.path, JSON.stringify(raw, null, 2) + "\n");
      console.log(`  ${pc.green("✓")} scrubbed ${path.relative(root, s.path)}`);
    } catch (err) {
      console.log(
        `  ${pc.red("✗")} ${path.relative(root, s.path)}: ${(err as Error).message}`,
      );
    }
  }
  for (const s of plan.symlinkRepoints) {
    fs.unlinkSync(s.linkPath);
    fs.symlinkSync(s.toTarget, s.linkPath, "dir");
    console.log(`  ${pc.green("✓")} re-pointed ${s.linkPath}`);
  }

  // Remove now-empty category dirs.
  for (const cat of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!cat.isDirectory()) continue;
    const catDir = path.join(skillsDir, cat.name);
    const looksLikeSkill =
      fs.existsSync(path.join(catDir, "meta.json")) ||
      fs.existsSync(path.join(catDir, "SKILL.md"));
    if (looksLikeSkill) continue;
    if (fs.readdirSync(catDir).length === 0) {
      fs.rmdirSync(catDir);
      console.log(`  ${pc.green("✓")} removed empty ${path.relative(root, catDir)}/`);
    }
  }

  console.log();
  console.log(pc.green("Done."));
}

function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
