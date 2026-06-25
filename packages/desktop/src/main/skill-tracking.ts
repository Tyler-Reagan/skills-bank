import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addTrackingHooks,
  buildHookCommand,
  buildHookScript,
  deriveCoverage,
  getInvocationLogPath,
  getMetricsDir,
  hasTrackingHooks,
  HOOK_SCRIPT_FILENAME,
  removeTrackingHooks,
  type ClaudeSettings,
  type TrackingPeriod,
} from "@skills-bank/core";
import type { SetTrackingResult, TrackingStatus } from "../shared/ipc.js";

/**
 * The impure half of skill-invocation tracking: reads/writes the real
 * `~/.claude/settings.json` and `~/.skills-bank/` files, over the pure
 * transforms in core's `hook-config`/`coverage`. See the design plan for
 * why these paths are REAL (`os.homedir()`) even in dev builds — there is
 * one Claude Code on the machine and the hook fires from it.
 */

function nowIso(): string {
  return new Date().toISOString();
}

function claudeSettingsPath(): string {
  return path.join(os.homedir(), ".claude", "settings.json");
}

function hookScriptPath(): string {
  return path.join(getMetricsDir(), HOOK_SCRIPT_FILENAME);
}

function ledgerPath(): string {
  return path.join(getMetricsDir(), "tracking-history.json");
}

/** Atomic JSON write: temp file in the same dir, then rename over. */
function writeJsonAtomic(
  filePath: string,
  value: unknown,
  mode?: number,
): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(
    tmp,
    JSON.stringify(value, null, 2) + "\n",
    mode ? { mode } : {},
  );
  fs.renameSync(tmp, filePath);
}

type SettingsRead =
  | { ok: true; settings: ClaudeSettings }
  | { ok: false; reason: "malformed" };

/** Read settings.json. Missing file = empty object; unparseable = malformed. */
function readSettings(): SettingsRead {
  const p = claudeSettingsPath();
  let raw: string;
  try {
    raw = fs.readFileSync(p, "utf8");
  } catch {
    return { ok: true, settings: {} };
  }
  if (raw.trim() === "") return { ok: true, settings: {} };
  try {
    return { ok: true, settings: JSON.parse(raw) as ClaudeSettings };
  } catch {
    return { ok: false, reason: "malformed" };
  }
}

function readLedger(): TrackingPeriod[] {
  try {
    const raw = fs.readFileSync(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as { periods?: unknown };
    return Array.isArray(parsed.periods)
      ? (parsed.periods as TrackingPeriod[])
      : [];
  } catch {
    return [];
  }
}

function writeLedger(periods: TrackingPeriod[]): void {
  writeJsonAtomic(ledgerPath(), { periods });
}

function isOpen(periods: TrackingPeriod[]): boolean {
  const last = periods[periods.length - 1];
  return !!last && last.disabledAt === null;
}

/** Write the hook script (0755) and ensure the log exists (0600). */
function materializeHookFiles(): void {
  const dir = getMetricsDir();
  fs.mkdirSync(dir, { recursive: true });
  const script = hookScriptPath();
  fs.writeFileSync(script, buildHookScript(getInvocationLogPath()), {
    mode: 0o755,
  });
  fs.chmodSync(script, 0o755);
  const log = getInvocationLogPath();
  if (!fs.existsSync(log)) fs.writeFileSync(log, "", { mode: 0o600 });
}

function buildStatus(
  settings: ClaudeSettings,
  malformed: boolean,
): TrackingStatus {
  const fileEnabled = !malformed && hasTrackingHooks(settings);
  const scriptPresent = fs.existsSync(hookScriptPath());

  // Reconcile invariant: the settings.json file is the source of truth
  // for enabled-state, so if the ledger disagrees (e.g. the user hand-
  // edited settings.json, bypassing the toggle) record an APPROXIMATE
  // transition at "now" — we know it changed since we last looked, just
  // not exactly when. This heals the ledger on observation; it converges
  // because after writing, the ledger matches the file.
  const periods = readLedger();
  let changed = false;
  if (fileEnabled && !isOpen(periods)) {
    periods.push({ enabledAt: nowIso(), disabledAt: null, approximate: true });
    changed = true;
  } else if (!fileEnabled && isOpen(periods)) {
    const last = periods[periods.length - 1]!;
    last.disabledAt = nowIso();
    last.approximate = true;
    changed = true;
  }
  if (changed) writeLedger(periods);

  const state: TrackingStatus["state"] = fileEnabled
    ? scriptPresent
      ? "on"
      : "needs-repair"
    : "off";

  return {
    state,
    coverage: deriveCoverage(periods),
    settingsPath: claudeSettingsPath(),
    scriptPath: hookScriptPath(),
    logPath: getInvocationLogPath(),
    settingsMalformed: malformed,
  };
}

/** Current tracking state derived from the real settings.json + ledger. */
export function getTrackingStatus(): TrackingStatus {
  const read = readSettings();
  return read.ok ? buildStatus(read.settings, false) : buildStatus({}, true);
}

/**
 * Install (or repair) the hook: write the script + log, merge our entry
 * into settings.json non-destructively, and open a ledger period. Refuses
 * to touch a malformed settings.json rather than clobbering it.
 */
export function enableTracking(): SetTrackingResult {
  const read = readSettings();
  if (!read.ok) {
    return {
      ok: false,
      reason: "malformed-settings",
      message: `Refusing to edit ${claudeSettingsPath()} — it isn't valid JSON. Fix or remove it, then try again.`,
    };
  }
  try {
    materializeHookFiles();
    const merged = addTrackingHooks(
      read.settings,
      buildHookCommand(hookScriptPath()),
    );
    writeJsonAtomic(claudeSettingsPath(), merged);

    const periods = readLedger();
    if (!isOpen(periods)) {
      periods.push({ enabledAt: nowIso(), disabledAt: null });
      writeLedger(periods);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "write-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, status: getTrackingStatus() };
}

/**
 * Remove our hook from settings.json (leaving the log + script in place,
 * so history persists and re-enabling is instant) and close the open
 * ledger period.
 */
export function disableTracking(): SetTrackingResult {
  const read = readSettings();
  if (!read.ok) {
    return {
      ok: false,
      reason: "malformed-settings",
      message: `Refusing to edit ${claudeSettingsPath()} — it isn't valid JSON. Fix or remove it, then try again.`,
    };
  }
  try {
    const stripped = removeTrackingHooks(read.settings);
    writeJsonAtomic(claudeSettingsPath(), stripped);

    const periods = readLedger();
    if (isOpen(periods)) {
      periods[periods.length - 1]!.disabledAt = nowIso();
      writeLedger(periods);
    }
  } catch (err) {
    return {
      ok: false,
      reason: "write-failed",
      message: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true, status: getTrackingStatus() };
}
