import fs from "node:fs";
import path from "node:path";

/**
 * Binary provenance for a registry skill. Any skill the user didn't
 * get from the bundled curated set originated from them — whether
 * authored locally, merged from another bank, or added by hand.
 *
 * Internal `entry.canon` (a derived boolean — "currently in the
 * upstream bundled snapshot") is the separate axis used purely for
 * destructive-action protection; it never surfaces to the user and
 * is intentionally not part of this enum.
 */
export type SkillOrigin = "bundled" | "yours";

export interface SkillSource {
  source: SkillOrigin;
  /** Commit SHA of the bundled repo this skill was last synced from. */
  syncedFromCommit?: string;
  /** ISO-8601 timestamp of the last sync. */
  syncedAt?: string;
}

export const SKILL_SOURCE_FILENAME = ".skills-bank.json";

/**
 * Read a skill's origin marker. Missing or invalid files default to
 * `yours` — the safe assumption for unknown provenance. The maintainer
 * runs the rename script in the plan's "Resetting your local install"
 * section before launching the post-rename build.
 */
export function readSkillSource(skillDir: string): SkillSource {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  if (!fs.existsSync(p)) return { source: "yours" };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<SkillSource>;
    const source: SkillOrigin = raw.source === "bundled" ? "bundled" : "yours";
    const out: SkillSource = { source };
    if (typeof raw.syncedFromCommit === "string") {
      out.syncedFromCommit = raw.syncedFromCommit;
    }
    if (typeof raw.syncedAt === "string") out.syncedAt = raw.syncedAt;
    return out;
  } catch {
    return { source: "yours" };
  }
}

export function writeSkillSource(skillDir: string, src: SkillSource): void {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(src, null, 2) + "\n");
}
