# Track skill usage

The **Metrics** tab shows which Claude Code skills you actually invoke, ranked by count, on this machine. It's opt-in and strictly local — there's no server and nothing leaves your machine.

## Enable tracking

Open **Settings → Skill usage** and turn on the toggle. This installs two hooks into your real `~/.claude/settings.json`:

- `PreToolUse(Skill)` — fires when the model invokes a skill
- `UserPromptExpansion` — fires when you invoke a skill yourself by typing `/name`

Each invocation is appended to a local log at `~/.skills-bank/invocations.jsonl`; the app aggregates it into the counts shown in the Metrics tab. Turning tracking off removes the hooks but keeps your recorded history, so re-enabling doesn't lose anything.

"Enabled" is always derived from `~/.claude/settings.json` itself, so hand-editing that file doesn't cause drift — the toggle and the file stay in sync. If the hook script goes missing while the hook entry is still present, the tab shows a **needs-repair** state; re-enabling in Settings restores it.

## What the tab shows

- A ranked list of skills with invocation counts and a usage bar, cross-referenced against the registry for descriptions
- Total invocations, distinct skills used, and session count
- The date you started tracking, and any gaps if tracking was turned off and back on
- If tracking is off but you have prior history, the tab shows that history stamped with the date range it covers, with a one-click way to turn tracking back on

## Scope and limits

- **Claude Code only.** The hooks are Claude-Code-specific; other agents (Cursor, Gemini, etc.) aren't tracked.
- Counts all skills, including plugins.
- No log rotation yet — growth is on the order of a few MB per year, so this isn't a practical concern.
- No per-project or per-session breakdown, and no timeline view, in the current version.

## Privacy

The invocation log lives entirely under `~/.skills-bank/` on your machine. Nothing is transmitted anywhere — Skills Bank has no backend to send it to.
