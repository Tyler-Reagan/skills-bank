import fs from "node:fs";
import path from "node:path";

export type SkillOrigin = "canonical" | "user" | "imported";

export interface SkillSource {
  source: SkillOrigin;
  /** Commit SHA of the canonical repo this skill was last synced from. */
  syncedFromCommit?: string;
  /** ISO-8601 timestamp of the last sync. */
  syncedAt?: string;
}

export const SKILL_SOURCE_FILENAME = ".skills-bank.json";

/**
 * Read a skill's origin marker. Missing file is the common case for
 * user-authored skills and for skills inside an upstream registry repo
 * (where this app-specific file is intentionally never committed).
 */
export function readSkillSource(skillDir: string): SkillSource {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  if (!fs.existsSync(p)) return { source: "user" };
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<SkillSource>;
    const source: SkillOrigin =
      raw.source === "canonical" || raw.source === "imported"
        ? raw.source
        : "user";
    const out: SkillSource = { source };
    if (typeof raw.syncedFromCommit === "string") {
      out.syncedFromCommit = raw.syncedFromCommit;
    }
    if (typeof raw.syncedAt === "string") out.syncedAt = raw.syncedAt;
    return out;
  } catch {
    return { source: "user" };
  }
}

export function writeSkillSource(skillDir: string, src: SkillSource): void {
  const p = path.join(skillDir, SKILL_SOURCE_FILENAME);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(p, JSON.stringify(src, null, 2) + "\n");
}

