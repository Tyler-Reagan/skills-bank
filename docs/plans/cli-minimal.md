# CLI minimal (planned)

Strip the CLI to its essential scriptable surface. The CLI's job is shell composition (dotfiles, CI, piping into grep/jq), not mirroring the desktop app's interactive flows. Today's command set conflates "things users do" with "things scripts do"; most of the surface is either interactive-by-nature or already handled by the app.

## Depends on

None. Standalone.

## Goals

1. Five commands cover the entire scriptable surface: `list`, `installed`, `install`, `uninstall`, `path`.
2. `--json` flag on read commands makes shell composition first-class.
3. README's CLI section reflects reality, not the aspirational "same operations through either surface" framing.

## Non-goals

- Parity with the desktop app. Heal flows, register/unregister with interactive picker, sync, discover, device flow, finalize — all stay UI-only. The CLI doesn't try to compete for those.
- Service extraction into `@skills-bank/core`. An earlier framing called for pure-TS service modules to share register/unregister/sync between renderer IPC and CLI. With those operations removed from the CLI, the extraction isn't needed.

## Scope

### Commands kept

- **`skills-bank list [--json]`** — list registered skills. JSON output is the contract scripts depend on.
- **`skills-bank installed [--json]`** — list what's wired into which agent dir.
- **`skills-bank install <name> [--agent <dir>]`** — non-interactive install for dotfiles / CI / fresh-machine bootstrap.
- **`skills-bank uninstall <name> [--agent <dir>]`** — inverse of install.

### Commands added

- **`skills-bank path <name>`** — prints the absolute path to a skill. Enables `cd $(skills-bank path foo)` and `$EDITOR $(skills-bank path foo)`.

### Commands removed

- `import` / `export` — bulk operations done once, manually. The desktop app surfaces them.
- `finalize` — agent-dir layout cleanup; surfaced in Settings (see plan 02).
- `sync-installed` — relink-after-pull is a fix for a specific failure mode the app handles automatically.

No deprecation alias. Pre-1.0 lets us cut hard. If a user runs a removed command, the CLI prints a one-line message pointing at the equivalent in-app surface and exits non-zero.

### README

Replace today's "Same operations through either surface" framing with: _"The CLI is the scripting surface for Skills Bank. Interactive flows — discover, heal, register, sync — live in the desktop app."_

List the 5 commands with one-line usage examples each.

## Files this PR will touch

- `packages/cli/src/commands/list.ts` — add `--json` flag.
- `packages/cli/src/commands/installed.ts` — add `--json` flag.
- `packages/cli/src/commands/install.ts` — no functional changes; pruning surrounding text.
- `packages/cli/src/commands/uninstall.ts` — no functional changes.
- **New**: `packages/cli/src/commands/path.ts`.
- **Delete**: `packages/cli/src/commands/import.ts`.
- **Delete**: `packages/cli/src/commands/export.ts`.
- **Delete**: `packages/cli/src/commands/finalize.ts`.
- **Delete**: `packages/cli/src/commands/sync-installed.ts`.
- `packages/cli/src/index.ts` — wire `path`; remove deleted commands; emit redirect-message for removed names.
- `README.md` — accurate CLI section.

## Verification

- `skills-bank list --json | jq '.[].name'` returns registered skill names.
- `skills-bank installed --json | jq` yields one entry per (skill, agent) installation.
- `skills-bank path foo` prints an absolute path; `cd $(skills-bank path foo)` lands in the skill directory.
- `skills-bank install foo --agent claude-code` followed by `skills-bank installed --json` includes the new installation.
- `skills-bank import` exits non-zero with the redirect message (pointing at Account → Import a registry).
- Running every kept CLI command against a fresh registry checkout produces no errors.

## Out of scope

- Skill update from CLI. Per-skill upstream tracking is plan 03; whether `skills-bank update` should exist is decided there.
- GitHub-mode operations from CLI. The app's github-linked flows stay UI-only.
