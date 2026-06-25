/**
 * Pure helpers for installing/removing the skill-invocation PreToolUse
 * hook in Claude Code's `settings.json`, plus the hook script body. File
 * I/O and path resolution live in the desktop main process
 * (`skill-tracking.ts`); everything here is a pure transform on a parsed
 * settings object so it can be unit-tested without Electron or a real
 * `~/.claude`.
 */

/**
 * Filename of the hook script the app writes into the metrics dir. Also
 * the stable substring used to recognize our own hook entry on read
 * (`commandIsOurs`), regardless of how the command path is rendered.
 */
export const HOOK_SCRIPT_FILENAME = "skill-invocation-hook.sh";

/** Tool name the Skill tool reports to hooks; matched exactly. */
export const SKILL_MATCHER = "Skill";

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
 * (`invocations.ts`). Always exits 0, so it can never block a Skill call.
 */
export function buildHookScript(logPath: string): string {
  const quotedLog = shSingleQuote(logPath);
  return `#!/bin/sh
# Skills Bank — skill-invocation tracker (managed; safe to delete).
# Appends each PreToolUse(Skill) payload as one JSONL line. Never blocks.
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
  hooks?: {
    PreToolUse?: HookMatcher[];
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function commandIsOurs(cmd: HookCommand): boolean {
  return (
    typeof cmd.command === "string" &&
    cmd.command.includes(HOOK_SCRIPT_FILENAME)
  );
}

/** True iff our skill-invocation hook is already installed. */
export function hasSkillHook(settings: ClaudeSettings): boolean {
  const entries = settings.hooks?.PreToolUse;
  if (!Array.isArray(entries)) return false;
  return entries.some(
    (e) => Array.isArray(e.hooks) && e.hooks.some(commandIsOurs),
  );
}

/**
 * Return a new settings object with our hook installed. Non-destructive:
 * preserves every other key, every other PreToolUse matcher, and any
 * other hooks already under a `Skill` matcher. Idempotent.
 */
export function addSkillHook(
  settings: ClaudeSettings,
  command: string,
): ClaudeSettings {
  const next: ClaudeSettings = { ...settings, hooks: { ...settings.hooks } };
  const preToolUse: HookMatcher[] = Array.isArray(next.hooks!.PreToolUse)
    ? next.hooks!.PreToolUse.map((e) => ({ ...e }))
    : [];

  if (hasSkillHook(settings)) {
    next.hooks!.PreToolUse = preToolUse;
    return next;
  }

  const ours: HookCommand = { type: "command", command };
  const skillEntry = preToolUse.find((e) => e.matcher === SKILL_MATCHER);
  if (skillEntry) {
    skillEntry.hooks = [...(skillEntry.hooks ?? []), ours];
  } else {
    preToolUse.push({ matcher: SKILL_MATCHER, hooks: [ours] });
  }

  next.hooks!.PreToolUse = preToolUse;
  return next;
}

/**
 * Return a new settings object with our hook removed. Strips only the
 * command(s) we own, drops any matcher entry left with no hooks, and
 * cleans up an emptied `PreToolUse`/`hooks` so we don't leave cruft.
 * Other hooks and keys are untouched.
 */
export function removeSkillHook(settings: ClaudeSettings): ClaudeSettings {
  const entries = settings.hooks?.PreToolUse;
  if (!Array.isArray(entries)) return settings;

  const next: ClaudeSettings = { ...settings, hooks: { ...settings.hooks } };
  const pruned = entries
    .map((e) => ({
      ...e,
      hooks: Array.isArray(e.hooks)
        ? e.hooks.filter((c) => !commandIsOurs(c))
        : e.hooks,
    }))
    .filter((e) => !Array.isArray(e.hooks) || e.hooks.length > 0);

  if (pruned.length > 0) {
    next.hooks!.PreToolUse = pruned;
  } else {
    delete next.hooks!.PreToolUse;
  }
  if (Object.keys(next.hooks!).length === 0) delete next.hooks;

  return next;
}
