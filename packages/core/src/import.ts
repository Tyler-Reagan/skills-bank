import fs from "node:fs";
import path from "node:path";
import {
  AGENTS,
  getAgent,
  getAgentSkillsDir,
  type AgentDef,
  type AgentId,
} from "./agents.js";
import { getStateDir } from "./paths.js";
import { listInstalled } from "./installed.js";
import { readSkillMeta } from "./registry.js";
import { buildRegistryIndex } from "./build.js";
import type {
  FinalizeResult,
  InstalledSkill,
  RegistrationAction,
  RegistrationResult,
  ScanReport,
  TopLevelSymlinkInfo,
} from "./types.js";

export function scanExistingInstalls(registryRoot: string): ScanReport {
  // Build the index once and reuse for the installed-list classification
  // so a stale on-disk index.json can't mislead either side.
  const index = buildRegistryIndex(registryRoot);
  const agentDirs: Record<string, string> = {};
  const topLevelSymlinks: TopLevelSymlinkInfo[] = [];
  for (const agent of AGENTS) {
    const dir = getAgentSkillsDir(agent);
    agentDirs[agent.id] = dir;
    const tls = detectTopLevelSymlink(agent, dir);
    if (tls) topLevelSymlinks.push(tls);
  }
  return {
    agentDirs,
    claudeSkillsDir: getAgentSkillsDir("claude"),
    registryRoot,
    entries: listInstalled(registryRoot, { index }),
    topLevelSymlinks,
  };
}

function detectTopLevelSymlink(
  agent: AgentDef,
  skillsDir: string,
): TopLevelSymlinkInfo | null {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(skillsDir);
  } catch {
    return null;
  }
  if (!stat.isSymbolicLink()) return null;
  let resolvedTarget: string;
  try {
    resolvedTarget = fs.realpathSync(skillsDir);
  } catch {
    // Broken symlink at the top level — read the link target verbatim.
    const raw = fs.readlinkSync(skillsDir);
    return {
      agent: agent.id,
      resolvedTarget: path.resolve(path.dirname(skillsDir), raw),
      exists: false,
    };
  }
  const exists = fs.existsSync(resolvedTarget);
  return { agent: agent.id, resolvedTarget, exists };
}

export interface RegisterOptions {
  registryRoot: string;
  /** Required to delete real directories or overwrite existing in-repo skill folders. */
  confirmDestructive?: boolean;
}

export function applyRegistration(
  entry: InstalledSkill,
  action: RegistrationAction,
  opts: RegisterOptions,
): RegistrationResult {
  try {
    switch (action.type) {
      case "skip":
        return { action, ok: true, message: `skipped ${entry.name}` };

      case "remove": {
        if (entry.kind !== "broken-symlink" && !opts.confirmDestructive) {
          return {
            action,
            ok: false,
            message: `refusing to remove ${entry.name}: not a broken symlink (set confirmDestructive)`,
          };
        }
        fs.unlinkSync(entry.linkPath);
        return { action, ok: true, message: `removed ${entry.linkPath}` };
      }

      case "register-external": {
        if (entry.kind !== "foreign-symlink" || !entry.target) {
          return {
            action,
            ok: false,
            message: `cannot register-external: ${entry.name} is ${entry.kind}`,
          };
        }
        registerExternal(opts.registryRoot, entry.name, entry.target);
        return {
          action,
          ok: true,
          message: `registered ${entry.name} as external (${entry.target})`,
        };
      }

      case "adopt": {
        return adoptIntoRegistry(entry, opts);
      }

      case "setAgents": {
        return setAgentLinks(entry, action.agents);
      }
    }
  } catch (err) {
    return {
      action,
      ok: false,
      message: String(err instanceof Error ? err.message : err),
    };
  }
}

/**
 * Reconcile the set of agent dirs that have this skill linked to match
 * `desired`. Adds symlinks for desired agents that don't currently have
 * one; removes symlinks for currently-present agents that aren't in the
 * desired list. Real-directory entries are never deleted — that's the
 * skill's actual content, not a removable link.
 *
 * Used to expose a skill to Claude Code (or any other agent) when it
 * was installed via the skills.sh CLI under a different agent dir, and
 * to back the same flow out by unchecking the box.
 */
function setAgentLinks(
  entry: InstalledSkill,
  desired: AgentId[],
): RegistrationResult {
  const action: RegistrationAction = {
    type: "setAgents",
    name: entry.name,
    agents: desired,
  };

  // Resolve the actual on-disk content of the skill via realpath so a
  // symlink chain doesn't mislead us. For real-directory entries the
  // linkPath IS the content.
  let realPath: string;
  try {
    realPath = fs.realpathSync(entry.linkPath);
  } catch (err) {
    return {
      action,
      ok: false,
      message: `cannot resolve real path for ${entry.name}: ${(err as Error).message}`,
    };
  }
  if (!fs.existsSync(realPath)) {
    return {
      action,
      ok: false,
      message: `source path missing for ${entry.name}: ${realPath}`,
    };
  }

  const desiredSet = new Set<AgentId>(desired);
  const added: string[] = [];
  const removed: string[] = [];
  const protectedAgents: string[] = [];

  for (const agent of AGENTS) {
    const skillsDir = getAgentSkillsDir(agent);
    const linkPath = path.join(skillsDir, entry.name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      stat = null;
    }
    const wanted = desiredSet.has(agent.id);

    // Real-directory entries house the actual content. Never remove,
    // and report so the caller knows we couldn't satisfy a removal.
    if (stat?.isDirectory() && !stat.isSymbolicLink()) {
      if (!wanted) protectedAgents.push(agent.label);
      continue;
    }

    if (wanted) {
      if (stat?.isSymbolicLink()) continue; // already linked
      fs.mkdirSync(skillsDir, { recursive: true });
      fs.symlinkSync(realPath, linkPath, "dir");
      added.push(agent.label);
    } else if (stat?.isSymbolicLink()) {
      fs.unlinkSync(linkPath);
      removed.push(agent.label);
    }
  }

  if (added.length === 0 && removed.length === 0) {
    return {
      action,
      ok: true,
      message: `no changes for ${entry.name}`,
    };
  }
  const parts: string[] = [];
  if (added.length > 0) parts.push(`linked: ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`unlinked: ${removed.join(", ")}`);
  if (protectedAgents.length > 0)
    parts.push(`source kept: ${protectedAgents.join(", ")}`);
  return {
    action,
    ok: true,
    message: `${entry.name} — ${parts.join("; ")}`,
  };
}

function adoptIntoRegistry(
  entry: InstalledSkill,
  opts: RegisterOptions,
): RegistrationResult {
  const action: RegistrationAction = { type: "adopt", name: entry.name };

  // Always resolve the actual on-disk source via realpath so we move
  // the real content (not a one-hop symlink target). Without this, an
  // adopt triggered from a foreign-symlink entry would copy contents
  // and leave the source dir behind in another agent — which is what
  // caused the "Not registered" duplicate-source bug.
  let sourcePath: string;
  try {
    sourcePath = fs.realpathSync(entry.linkPath);
  } catch (err) {
    return {
      action,
      ok: false,
      message: `cannot resolve source for ${entry.name}: ${(err as Error).message}`,
    };
  }
  if (!fs.existsSync(sourcePath)) {
    return {
      action,
      ok: false,
      message: `source path missing for ${entry.name}: ${sourcePath}`,
    };
  }

  const destDir = path.join(opts.registryRoot, "skills", entry.name);
  fs.mkdirSync(path.dirname(destDir), { recursive: true });

  const sourceIsAlreadyRegistry =
    path.resolve(sourcePath) === path.resolve(destDir);

  if (!sourceIsAlreadyRegistry) {
    if (fs.existsSync(destDir)) {
      if (!opts.confirmDestructive) {
        return {
          action,
          ok: false,
          message: `${destDir} already exists; pass confirmDestructive to overwrite`,
        };
      }
      fs.rmSync(destDir, { recursive: true, force: true });
    }
    fs.renameSync(sourcePath, destDir);
  }

  // Synthesize meta.json if missing (skills installed via the CLI rarely
  // ship one). Done after move so we write directly into the registry copy.
  const metaPath = path.join(destDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    const meta = readSkillMeta(destDir) ?? {
      name: entry.name,
      description: "(adopted via skills-bank import; description missing)",
    };
    fs.writeFileSync(
      metaPath,
      JSON.stringify({ ...meta, name: entry.name }, null, 2) + "\n",
    );
  }

  // Sweep every known agent dir and reconcile its <name> entry with the
  // registry copy:
  //   - missing entry at the now-emptied source location → recreate as symlink to destDir
  //   - existing symlink whose realpath != destDir → replace (handles broken chains, stale targets, and old foreign symlinks pointing at the moved source)
  //   - real directory at the same name in another agent → leave alone (could be intentional unrelated content)
  // This is what makes Adopt converge a duplicate-source state to a clean
  // single-source-in-registry state, which the prior copyDir flow couldn't.
  const swept: string[] = [];
  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), entry.name);
    let stat: fs.Stats | null = null;
    try {
      stat = fs.lstatSync(linkPath);
    } catch {
      stat = null;
    }

    if (!stat) {
      if (path.resolve(linkPath) === path.resolve(sourcePath)) {
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(destDir, linkPath, "dir");
        swept.push(agent.label);
      }
      continue;
    }

    if (stat.isSymbolicLink()) {
      let realTarget = "";
      try {
        realTarget = fs.realpathSync(linkPath);
      } catch {
        realTarget = "";
      }
      if (realTarget !== destDir) {
        fs.unlinkSync(linkPath);
        fs.symlinkSync(destDir, linkPath, "dir");
        swept.push(agent.label);
      }
    }
    // Real directories with the same name in another agent dir are not
    // touched — they may be unrelated to this skill.
  }

  recordRegistration(opts.registryRoot, {
    timestamp: new Date().toISOString(),
    name: entry.name,
    sourceKind: entry.kind,
    sourcePath,
    destPath: destDir,
    linkPath: entry.linkPath,
  });

  return {
    action,
    ok: true,
    message:
      swept.length > 0
        ? `registered ${entry.name}; updated ${swept.length} agent link(s)`
        : `registered ${entry.name}`,
  };
}

function copyDir(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDir(s, d);
    else if (ent.isSymbolicLink()) {
      fs.symlinkSync(fs.readlinkSync(s), d);
    } else fs.copyFileSync(s, d);
  }
}

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

interface ExternalEntry {
  name: string;
  target: string;
  registeredAt: string;
}

function externalRegistryPath(registryRoot: string): string {
  return path.join(getStateDir(registryRoot), "external.json");
}

function registerExternal(
  registryRoot: string,
  name: string,
  target: string,
): void {
  const p = externalRegistryPath(registryRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  let list: ExternalEntry[] = [];
  if (fs.existsSync(p)) {
    try {
      list = JSON.parse(fs.readFileSync(p, "utf8")) as ExternalEntry[];
    } catch {
      list = [];
    }
  }
  const filtered = list.filter((e) => e.name !== name);
  filtered.push({ name, target, registeredAt: new Date().toISOString() });
  fs.writeFileSync(p, JSON.stringify(filtered, null, 2) + "\n");
}

interface RegistrationLogEntry {
  timestamp: string;
  name: string;
  sourceKind: string;
  sourcePath: string;
  destPath: string;
  linkPath: string;
}

function recordRegistration(registryRoot: string, entry: RegistrationLogEntry): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `registration-${entry.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
}

export interface FinalizeOptions {
  registryRoot: string;
  /**
   * Which agent's top-level skills dir to finalize. Defaults to "claude"
   * (the historical behavior — Claude is by far the most common case
   * where ~/.claude/skills is itself a symlink).
   */
  agent?: AgentId;
  /** Required to actually swap the top-level symlink for a real directory. */
  confirmDestructive?: boolean;
}

/**
 * Replace a symlinked `<agent>/skills` with a real directory containing
 * the same per-skill symlinks, eliminating the double-hop indirection
 * that remains after adopting skills from a parent like `~/.agents/skills/`.
 *
 * Refuses to run unless every entry in the resolved directory is already a
 * symlink (i.e. all real-directory entries have been adopted via
 * applyRegistration first). The original top-level symlink is renamed to a
 * timestamped backup rather than deleted.
 */
export function finalizeSkillsDir(opts: FinalizeOptions): FinalizeResult {
  const agent = opts.agent ? getAgent(opts.agent) : getAgent("claude");
  const skillsDir = getAgentSkillsDir(agent);

  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(skillsDir);
  } catch {
    return { ok: false, message: `${skillsDir} does not exist` };
  }
  if (!stat.isSymbolicLink()) {
    return {
      ok: false,
      message: `${skillsDir} is already a real directory; nothing to finalize`,
    };
  }

  let resolved: string;
  try {
    resolved = fs.realpathSync(skillsDir);
  } catch (err) {
    return {
      ok: false,
      message: `cannot resolve target of ${skillsDir}: ${(err as Error).message}`,
    };
  }

  // Snapshot every entry so we can recreate them in the new real directory.
  interface EntrySnapshot {
    name: string;
    isSymlink: boolean;
    target?: string;
  }
  const snapshot: EntrySnapshot[] = [];
  const blocking: string[] = [];
  for (const name of fs.readdirSync(resolved)) {
    const p = path.join(resolved, name);
    let s: fs.Stats;
    try {
      s = fs.lstatSync(p);
    } catch {
      continue;
    }
    if (s.isSymbolicLink()) {
      const raw = fs.readlinkSync(p);
      snapshot.push({
        name,
        isSymlink: true,
        target: path.resolve(resolved, raw),
      });
    } else if (s.isDirectory()) {
      snapshot.push({ name, isSymlink: false });
      blocking.push(name);
    }
  }

  if (blocking.length > 0) {
    return {
      ok: false,
      message: `Cannot finalize: ${blocking.length} entr${
        blocking.length === 1 ? "y is" : "ies are"
      } still real director${
        blocking.length === 1 ? "y" : "ies"
      }. Register them first.`,
      blockingEntries: blocking,
    };
  }

  if (!opts.confirmDestructive) {
    return {
      ok: false,
      message: "set confirmDestructive to perform the rename + rebuild",
    };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${skillsDir}.bak.${stamp}`;

  // Step 1: move the top-level symlink to a backup name (renames the
  // symlink itself, not its target, since fs.renameSync doesn't follow the
  // trailing component).
  fs.renameSync(skillsDir, backupPath);

  // Step 2: create a fresh real directory at the original path.
  try {
    fs.mkdirSync(skillsDir, { recursive: true });
    // Step 3: recreate each per-skill symlink pointing directly at its
    // (now absolute) target — no more double-hop.
    for (const e of snapshot) {
      if (e.isSymlink && e.target) {
        fs.symlinkSync(e.target, path.join(skillsDir, e.name), "dir");
      }
    }
  } catch (err) {
    // Best-effort rollback: restore the original symlink.
    try {
      fs.rmSync(skillsDir, { recursive: true, force: true });
      fs.renameSync(backupPath, skillsDir);
    } catch {
      // Swallow — surface the original error.
    }
    return {
      ok: false,
      message: `finalize failed during rebuild; restored original symlink. (${
        (err as Error).message
      })`,
    };
  }

  recordFinalize(opts.registryRoot, {
    timestamp: new Date().toISOString(),
    skillsDir,
    backupPath,
    originalTarget: resolved,
    entries: snapshot,
  });

  return {
    ok: true,
    message: `${skillsDir} is now a real directory; original symlink saved at ${backupPath}`,
    backupPath,
  };
}

interface FinalizeLogEntry {
  timestamp: string;
  skillsDir: string;
  backupPath: string;
  originalTarget: string;
  entries: Array<{ name: string; isSymlink: boolean; target?: string }>;
}

function recordFinalize(registryRoot: string, entry: FinalizeLogEntry): void {
  const dir = getStateDir(registryRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(
    dir,
    `finalize-${entry.timestamp.replace(/[:.]/g, "-")}.json`,
  );
  fs.writeFileSync(file, JSON.stringify(entry, null, 2) + "\n");
}

// ─── Broken-link repair / removal ───────────────────────────────────────────
//
// Two-step affordance for skills that have at least one broken symlink in
// some agent dir (target deleted, registry copy gone, etc.):
//   1. Try to find a usable source for `name` from any non-broken
//      installation OR the registry. Repoint each broken symlink there.
//   2. Whatever can't be repaired is reported back; the caller (UI)
//      confirms with the user before calling removeBrokenLinks to delete.

export interface BrokenLinkRepairReport {
  repaired: { agent: AgentId; newTarget: string }[];
  unrepairable: { agent: AgentId; linkPath: string; reason: string }[];
}

export function repairBrokenLinks(
  registryRoot: string,
  name: string,
): BrokenLinkRepairReport {
  const installations = listInstalled(registryRoot).filter(
    (i) => i.name === name,
  );
  const broken = installations.filter((i) => i.kind === "broken-symlink");

  // Look for a source: any non-broken installation's realpath, falling back
  // to the registry path if that exists on disk.
  let source: string | null = null;
  for (const i of installations) {
    if (i.kind === "broken-symlink") continue;
    try {
      const real = fs.realpathSync(i.linkPath);
      if (fs.existsSync(real)) {
        source = real;
        break;
      }
    } catch {
      // try next
    }
  }
  if (!source) {
    const registryPath = path.join(registryRoot, "skills", name);
    if (fs.existsSync(registryPath)) source = registryPath;
  }

  const repaired: BrokenLinkRepairReport["repaired"] = [];
  const unrepairable: BrokenLinkRepairReport["unrepairable"] = [];

  if (!source) {
    for (const b of broken) {
      unrepairable.push({
        agent: b.agent,
        linkPath: b.linkPath,
        reason: "no source content found",
      });
    }
    return { repaired, unrepairable };
  }

  for (const b of broken) {
    try {
      fs.unlinkSync(b.linkPath);
      fs.symlinkSync(source, b.linkPath, "dir");
      repaired.push({ agent: b.agent, newTarget: source });
    } catch (err) {
      unrepairable.push({
        agent: b.agent,
        linkPath: b.linkPath,
        reason: (err as Error).message,
      });
    }
  }
  return { repaired, unrepairable };
}

export interface BrokenLinkRemoveReport {
  removed: AgentId[];
  errors: { agent: AgentId; message: string }[];
}

// ─── Registry-vs-installed conflict resolution ─────────────────────────────
//
// When a skill is BOTH registered (registry has it; some agent dir
// symlinks to the registry copy) AND has stragglers in other agent
// dirs (real-directory duplicates, foreign-symlinks pointing at random
// locations, etc.), we need a way to clean up the stragglers without
// touching the working registry symlinks.

export type ConflictResolveAction =
  | "replace-with-symlink" // wipe the straggler and symlink the agent dir at the registry copy
  | "delete" // wipe the straggler entirely (no replacement symlink)
  | "keep"; // leave it alone

export interface ConflictResolveDecision {
  agent: AgentId;
  action: ConflictResolveAction;
}

export interface ConflictResolveReport {
  applied: { agent: AgentId; action: ConflictResolveAction }[];
  errors: { agent: AgentId; action: ConflictResolveAction; message: string }[];
}

export function resolveSkillConflicts(
  registryRoot: string,
  name: string,
  decisions: ConflictResolveDecision[],
): ConflictResolveReport {
  const registryDir = path.join(registryRoot, "skills", name);
  if (!fs.existsSync(registryDir)) {
    return {
      applied: [],
      errors: decisions.map((d) => ({
        agent: d.agent,
        action: d.action,
        message: `${name} is not in the registry; cannot replace with symlinks to it`,
      })),
    };
  }

  const applied: ConflictResolveReport["applied"] = [];
  const errors: ConflictResolveReport["errors"] = [];
  for (const d of decisions) {
    const agent = getAgent(d.agent);
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    if (d.action === "keep") {
      applied.push({ agent: d.agent, action: "keep" });
      continue;
    }
    try {
      if (fs.existsSync(linkPath) || isSymlink(linkPath)) {
        const stat = fs.lstatSync(linkPath);
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(linkPath);
        } else if (stat.isDirectory()) {
          fs.rmSync(linkPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(linkPath);
        }
      }
      if (d.action === "replace-with-symlink") {
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(registryDir, linkPath, "dir");
      }
      applied.push({ agent: d.agent, action: d.action });
    } catch (err) {
      errors.push({
        agent: d.agent,
        action: d.action,
        message: (err as Error).message,
      });
    }
  }
  return { applied, errors };
}

export function removeBrokenLinks(
  registryRoot: string,
  name: string,
  agents: AgentId[],
): BrokenLinkRemoveReport {
  const removed: AgentId[] = [];
  const errors: BrokenLinkRemoveReport["errors"] = [];
  const installations = listInstalled(registryRoot).filter(
    (i) => i.name === name && agents.includes(i.agent),
  );
  for (const i of installations) {
    if (i.kind !== "broken-symlink") {
      errors.push({
        agent: i.agent,
        message: `${i.linkPath} is ${i.kind}, refusing to remove`,
      });
      continue;
    }
    try {
      fs.unlinkSync(i.linkPath);
      removed.push(i.agent);
    } catch (err) {
      errors.push({ agent: i.agent, message: (err as Error).message });
    }
  }
  return { removed, errors };
}
