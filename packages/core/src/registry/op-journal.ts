import fs from "node:fs";
import path from "node:path";

export const OP_JOURNAL_FILE = ".skills-bank-op.json";

export interface OpJournal {
  op: "move" | "detachOrigin" | "manifestImport";
  skill: string;
  from?: string;
  to?: string;
  startedAt: string;
}

export function writeOpJournal(skillDir: string, journal: OpJournal): void {
  const p = path.join(skillDir, OP_JOURNAL_FILE);
  const tmp = p + ".tmp~";
  fs.writeFileSync(tmp, JSON.stringify(journal, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

export function clearOpJournal(skillDir: string): void {
  const p = path.join(skillDir, OP_JOURNAL_FILE);
  try {
    fs.unlinkSync(p);
  } catch {
    // Already gone — nothing to do.
  }
}

export function readOpJournal(skillDir: string): OpJournal | null {
  const p = path.join(skillDir, OP_JOURNAL_FILE);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as OpJournal;
  } catch {
    return null;
  }
}
