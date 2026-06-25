import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Skill-invocation metrics, read from the append-only JSONL log written
 * by the PreToolUse hook (see `hook-config.ts` for the hook itself).
 *
 * Deliberately reads from the user's REAL home (`os.homedir()`), not the
 * dev `SKILLS_BANK_HOME_OVERRIDE` sink: there is only one Claude Code on
 * the machine and every real skill invocation fires from it, so a dev
 * build and the packaged build both surface the same canonical log. The
 * one knob is `SKILLS_BANK_METRICS_DIR`, used by tests to point the
 * reader at a scratch directory.
 */

/** Canonical directory holding the invocation log + hook script + ledger. */
export function getMetricsDir(): string {
  return (
    process.env.SKILLS_BANK_METRICS_DIR ??
    path.join(os.homedir(), ".skills-bank")
  );
}

/** Absolute path to the append-only invocation log. */
export function getInvocationLogPath(): string {
  return path.join(getMetricsDir(), "invocations.jsonl");
}

/** One aggregated row: a skill and how often it has been invoked. */
export interface SkillInvocationStat {
  /** Skill name as reported in `tool_input.skill` (e.g. `find-skills`, `vercel:deploy`). */
  skill: string;
  count: number;
  /** ISO-8601 timestamp of the first recorded invocation. */
  firstInvokedAt: string;
  /** ISO-8601 timestamp of the most recent invocation. */
  lastInvokedAt: string;
}

/** Full aggregation over the invocation log. */
export interface InvocationStats {
  /** Total well-formed invocation events parsed. */
  totalEvents: number;
  /** Lines that failed to parse or lacked a skill name (skipped). */
  malformedLines: number;
  /** Distinct `session_id`s seen across the log. */
  sessions: number;
  /** Per-skill rollup, sorted by count descending then skill name ascending. */
  perSkill: SkillInvocationStat[];
  logPath: string;
  logExists: boolean;
}

/**
 * One line of the log, as written by the hook. The hook wraps Claude
 * Code's raw payload under `payload` with its own `ts` so the reader never
 * depends on the payload carrying a timestamp. Two payload shapes occur:
 *  - `PreToolUse` (model-invoked): `tool_input.skill` holds the name.
 *  - `UserPromptExpansion` (user `/slash`): `command_name` holds the name,
 *    with `expansion_type: "slash_command"`.
 */
interface LogRecord {
  ts?: unknown;
  payload?: {
    tool_input?: { skill?: unknown };
    session_id?: unknown;
    expansion_type?: unknown;
    command_name?: unknown;
  };
}

/**
 * Pull the skill name from either payload shape. Model-invoked skills
 * carry it in `tool_input.skill`; user `/slash` skills carry it in
 * `command_name` (only for `slash_command` expansions — other expansion
 * types, if any, are ignored). Returns null when neither is present.
 */
function extractSkill(rec: LogRecord): string | null {
  const p = rec.payload;
  if (!p) return null;
  const toolSkill = p.tool_input?.skill;
  if (typeof toolSkill === "string" && toolSkill.length > 0) return toolSkill;
  if (
    p.expansion_type === "slash_command" &&
    typeof p.command_name === "string" &&
    p.command_name.length > 0
  ) {
    return p.command_name;
  }
  return null;
}

/**
 * Parse + aggregate the invocation log. Tolerant by design: malformed or
 * interleaved lines (concurrent hook appends can theoretically tear) are
 * counted and skipped rather than throwing. A missing log is an empty
 * result, not an error.
 */
export function readInvocationStats(opts?: { dir?: string }): InvocationStats {
  const logPath = opts?.dir
    ? path.join(opts.dir, "invocations.jsonl")
    : getInvocationLogPath();

  let raw: string;
  try {
    raw = fs.readFileSync(logPath, "utf8");
  } catch {
    return {
      totalEvents: 0,
      malformedLines: 0,
      sessions: 0,
      perSkill: [],
      logPath,
      logExists: false,
    };
  }

  const agg = new Map<
    string,
    { count: number; firstInvokedAt: string; lastInvokedAt: string }
  >();
  const sessions = new Set<string>();
  let totalEvents = 0;
  let malformedLines = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") continue;

    let rec: LogRecord;
    try {
      rec = JSON.parse(trimmed) as LogRecord;
    } catch {
      malformedLines++;
      continue;
    }

    const skill = extractSkill(rec);
    if (!skill) {
      malformedLines++;
      continue;
    }

    // Fall back to empty string when the hook's timestamp is absent or
    // malformed — the min/max comparisons below still order well-formed
    // ISO strings, and a missing stamp simply never wins.
    const ts = typeof rec.ts === "string" ? rec.ts : "";
    totalEvents++;

    const sid = rec.payload?.session_id;
    if (typeof sid === "string" && sid.length > 0) sessions.add(sid);

    const existing = agg.get(skill);
    if (!existing) {
      agg.set(skill, { count: 1, firstInvokedAt: ts, lastInvokedAt: ts });
    } else {
      existing.count++;
      if (
        ts !== "" &&
        (existing.firstInvokedAt === "" || ts < existing.firstInvokedAt)
      ) {
        existing.firstInvokedAt = ts;
      }
      if (ts > existing.lastInvokedAt) existing.lastInvokedAt = ts;
    }
  }

  const perSkill: SkillInvocationStat[] = Array.from(agg.entries())
    .map(([skill, v]) => ({ skill, ...v }))
    .sort((a, b) => b.count - a.count || a.skill.localeCompare(b.skill));

  return {
    totalEvents,
    malformedLines,
    sessions: sessions.size,
    perSkill,
    logPath,
    logExists: true,
  };
}
