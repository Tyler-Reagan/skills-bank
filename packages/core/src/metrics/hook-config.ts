/**
 * Pure helpers for installing/removing the skill-invocation hooks in
 * Claude Code's `settings.json`, plus the hook script body. File I/O and
 * path resolution live in the desktop main process (`skill-tracking.ts`);
 * everything here is a pure transform on a parsed settings object so it
 * can be unit-tested without Electron or a real `~/.claude`.
 *
 * Two invocation paths, two events (verified empirically against Claude
 * Code 2.1.x):
 *  - **Model-invoked** skills fire `PreToolUse` with `tool_name: "Skill"`
 *    and `tool_input.skill: "<name>"`. Matched by tool name `"Skill"`.
 *  - **User `/slash`** skills fire `UserPromptExpansion` with
 *    `expansion_type: "slash_command"` and `command_name: "<name>"` — and
 *    built-in client commands (`/clear`, `/status`) don't fire it at all,
 *    so a catch-all matcher here is skills/commands only, no noise.
 * The same script handles both; the reader (`invocations.ts`) pulls the
 * skill name from whichever shape each line carries.
 */

/**
 * Filename of the hook script the app writes into the metrics dir. Also
 * the stable substring used to recognize our own hook entries on read
 * (`commandIsOurs`), regardless of how the command path is rendered.
 */
export const HOOK_SCRIPT_FILENAME = "skill-invocation-hook.sh";

/** Defensive per-hook timeout (seconds); the hook is instant. */
export const HOOK_TIMEOUT_SECONDS = 5;

/**
 * The events we install under, and the matcher for each. `PreToolUse`
 * matches the `Skill` tool name; `UserPromptExpansion` uses `"*"` (all
 * slash/command expansions — built-ins don't fire this event).
 */
export const TRACKED_EVENTS: ReadonlyArray<{ event: string; matcher: string }> =
  [
    { event: "PreToolUse", matcher: "Skill" },
    { event: "UserPromptExpansion", matcher: "*" },
  ];

/**
 * Wrap a string in POSIX-sh single quotes, escaping embedded quotes, so a
 * path with spaces or shell metacharacters (or an apostrophe in the
 * username, e.g. `/Users/O'Brien`) survives both the script body and the
 * settings.json command.
 */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/**
 * POSIX-sh hook body. Deliberately dependency-free (no `jq`, no
 * `node`-on-PATH assumption): it collapses the stdin payload to a single
 * line and appends it raw under a `payload` key with its own UTC
 * timestamp. All parsing/aggregation happens later in the reader
 * (`invocations.ts`). Always exits 0, so it can never block a call.
 */
export function buildHookScript(logPath: string): string {
  const quotedLog = shSingleQuote(logPath);
  return `#!/bin/sh
# Skills Bank — skill-invocation tracker (managed; safe to delete).
# Appends each PreToolUse(Skill) / UserPromptExpansion payload as one
# JSONL line. Never blocks.
log=${quotedLog}
mkdir -p "$(dirname "$log")"
payload=$(cat | tr '\\n\\r' '  ')
printf '{"ts":"%s","payload":%s}\\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$payload" >> "$log"
exit 0
`;
}

/** The settings.json command string that runs the hook script. */
export function buildHookCommand(scriptPath: string): string {
  return `sh ${shSingleQuote(scriptPath)}`;
}

interface HookCommand {
  type?: string;
  command?: string;
  [k: string]: unknown;
}
interface HookMatcher {
  matcher?: string;
  hooks?: HookCommand[];
  [k: string]: unknown;
}
export interface ClaudeSettings {
  hooks?: { [event: string]: HookMatcher[] | undefined };
  [k: string]: unknown;
}

function commandIsOurs(cmd: HookCommand): boolean {
  return (
    typeof cmd.command === "string" &&
    cmd.command.includes(HOOK_SCRIPT_FILENAME)
  );
}

function eventHasOurs(entries: HookMatcher[] | undefined): boolean {
  return (
    Array.isArray(entries) &&
    entries.some((e) => Array.isArray(e.hooks) && e.hooks.some(commandIsOurs))
  );
}

/** Shallow-clone settings with a fresh `hooks` map so edits don't mutate input. */
function cloneWithHooks(settings: ClaudeSettings): ClaudeSettings {
  return { ...settings, hooks: { ...(settings.hooks ?? {}) } };
}

/**
 * True iff our tracking hooks are installed under ANY tracked event. We
 * treat "any present" as enabled (not "all present") so a config written
 * by an older single-event build still reads as on; `addTrackingHooks` is
 * idempotent and fills in whichever event is missing on the next enable.
 */
export function hasTrackingHooks(settings: ClaudeSettings): boolean {
  const h = settings.hooks;
  if (!h) return false;
  return TRACKED_EVENTS.some(({ event }) => eventHasOurs(h[event]));
}

/**
 * Return a new settings object with our hook installed under every tracked
 * event. Non-destructive: preserves every other key, event, matcher, and
 * co-located hook. Idempotent per event.
 */
export function addTrackingHooks(
  settings: ClaudeSettings,
  command: string,
): ClaudeSettings {
  const next = cloneWithHooks(settings);
  for (const { event, matcher } of TRACKED_EVENTS) {
    const entries: HookMatcher[] = Array.isArray(next.hooks![event])
      ? next.hooks![event]!.map((e) => ({ ...e }))
      : [];
    if (!eventHasOurs(entries)) {
      const ours: HookCommand = {
        type: "command",
        command,
        timeout: HOOK_TIMEOUT_SECONDS,
      };
      const existing = entries.find((e) => e.matcher === matcher);
      if (existing) {
        existing.hooks = [...(existing.hooks ?? []), ours];
      } else {
        entries.push({ matcher, hooks: [ours] });
      }
    }
    next.hooks![event] = entries;
  }
  return next;
}

/**
 * Return a new settings object with our hook removed from EVERY event.
 * Strips only the command(s) we own, drops matcher entries left with no
 * hooks, removes emptied events, and drops an emptied `hooks`. Other hooks
 * and keys are untouched.
 */
export function removeTrackingHooks(settings: ClaudeSettings): ClaudeSettings {
  if (!settings.hooks) return settings;
  const next = cloneWithHooks(settings);
  for (const event of Object.keys(next.hooks!)) {
    const entries = next.hooks![event];
    if (!Array.isArray(entries)) continue;
    const pruned = entries
      .map((e) => ({
        ...e,
        hooks: Array.isArray(e.hooks)
          ? e.hooks.filter((c) => !commandIsOurs(c))
          : e.hooks,
      }))
      .filter((e) => !Array.isArray(e.hooks) || e.hooks.length > 0);
    if (pruned.length > 0) next.hooks![event] = pruned;
    else delete next.hooks![event];
  }
  if (Object.keys(next.hooks!).length === 0) delete next.hooks;
  return next;
}
