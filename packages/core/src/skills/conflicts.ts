import fs from "node:fs";
import path from "node:path";
import { getAgent, getAgentSkillsDir, type AgentId } from "../shared/agents.js";
import { findSkillFolder } from "../registry/walk.js";
import { listInstalled } from "./installed.js";

function isSymlink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
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
    const found = findSkillFolder(registryRoot, name);
    if (found) source = found.dir;
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
  // Look up the registry copy across both buckets. Only
  // replace-with-symlink needs it — delete/keep operate purely on
  // agent-dir entries and are valid for unregistered skills too.
  // Pre-fail individual replace-with-symlink decisions if the
  // registry is missing, but let delete/keep proceed.
  const registryFolder = findSkillFolder(registryRoot, name);
  const registryDir = registryFolder?.dir ?? null;
  const registryExists = registryDir !== null;

  const applied: ConflictResolveReport["applied"] = [];
  const errors: ConflictResolveReport["errors"] = [];
  for (const d of decisions) {
    const agent = getAgent(d.agent);
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    if (d.action === "keep") {
      applied.push({ agent: d.agent, action: "keep" });
      continue;
    }
    if (d.action === "replace-with-symlink" && !registryExists) {
      errors.push({
        agent: d.agent,
        action: d.action,
        message: `${name} is not in the registry; cannot replace with a symlink to it`,
      });
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
        // registryDir is non-null here: the !registryExists guard
        // above pre-fails any replace-with-symlink decision when the
        // registry copy is missing.
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(registryDir!, linkPath, "dir");
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
