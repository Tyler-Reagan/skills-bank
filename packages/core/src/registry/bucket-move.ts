import fs from "node:fs";
import path from "node:path";
import { AGENTS, getAgentSkillsDir } from "../shared/agents.js";
import { findSkillFolder, type SkillBucket } from "./walk.js";
import { writeOpJournal, clearOpJournal } from "./op-journal.js";

export interface MoveSkillBucketResult {
  ok: boolean;
  message: string;
  /** The bucket the skill lived in before the move. */
  fromBucket?: SkillBucket;
  /** Absolute path to the skill folder after the move. */
  newDir?: string;
  /** Ids of agent dirs whose symlink to the skill was repointed. */
  relinked: string[];
}

/**
 * Move a skill folder from its current bucket to `targetBucket` and
 * repoint every agent-dir symlink that pointed at the old location.
 *
 * This is the structural primitive behind any bucket migration —
 * `detachOrigin` (vendored → personal rehome) and bulk re-bucketing
 * both compose it. The folder move alone would leave every
 * `~/.<agent>/skills/<name>` symlink dangling (they store absolute
 * targets into `skills/<bucket>/<name>`), so the repoint is not
 * optional: it's what keeps installed skills working across the move.
 *
 * Symlinks in OTHER agent dirs (pointing elsewhere) and real
 * directories are left untouched — only links resolving to this skill's
 * old folder are rewritten. No-op (ok) when the skill already lives in
 * `targetBucket`. Refuses if the destination path already exists.
 */
export function moveSkillBucket(
  registryRoot: string,
  name: string,
  targetBucket: SkillBucket,
): MoveSkillBucketResult {
  const ref = findSkillFolder(registryRoot, name);
  if (!ref) {
    return {
      ok: false,
      message: `${name} not found in any bucket`,
      relinked: [],
    };
  }
  if (ref.bucket === targetBucket) {
    return {
      ok: true,
      message: `${name} already in ${targetBucket}`,
      fromBucket: ref.bucket,
      newDir: ref.dir,
      relinked: [],
    };
  }

  const oldDir = ref.dir;
  const newDir = path.join(registryRoot, "skills", targetBucket, name);
  if (fs.existsSync(newDir)) {
    return {
      ok: false,
      message: `destination already exists: ${newDir}`,
      relinked: [],
    };
  }

  fs.mkdirSync(path.dirname(newDir), { recursive: true });
  writeOpJournal(oldDir, {
    op: "move",
    skill: name,
    from: ref.bucket,
    to: targetBucket,
    startedAt: new Date().toISOString(),
  });
  fs.renameSync(oldDir, newDir);
  clearOpJournal(newDir);

  const relinked: string[] = [];
  for (const agent of AGENTS) {
    const linkPath = path.join(getAgentSkillsDir(agent), name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(linkPath);
    } catch {
      continue;
    }
    if (!st.isSymbolicLink()) continue;
    const resolved = path.resolve(
      path.dirname(linkPath),
      fs.readlinkSync(linkPath),
    );
    if (resolved !== oldDir) continue;
    fs.unlinkSync(linkPath);
    fs.symlinkSync(newDir, linkPath, "dir");
    relinked.push(agent.id);
  }

  return {
    ok: true,
    message: `moved ${name}: ${ref.bucket} → ${targetBucket}`,
    fromBucket: ref.bucket,
    newDir,
    relinked,
  };
}
