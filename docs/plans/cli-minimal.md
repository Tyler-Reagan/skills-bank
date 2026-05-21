# CLI minimal (shipped v1.6.0)

Stripped the CLI to its essential scriptable surface. The CLI's job is shell composition (dotfiles, CI, piping into `grep` / `jq`), not mirroring the desktop app's interactive flows. The prior command set conflated "things users do" with "things scripts do"; most of the surface was either interactive-by-nature or already handled by the app.

## What shipped

### Five commands cover the entire scriptable surface

- **`skills-bank list [--json]`** — list registered skills. JSON output is the contract scripts depend on.
- **`skills-bank installed [--json]`** — list what's wired into which agent dir.
- **`skills-bank install <name> [--agent <id>]`** — non-interactive install for dotfiles / CI / fresh-machine bootstrap. Broadcasts to every existing agent dir; `--agent` scopes to one.
- **`skills-bank uninstall <name> [--agent <id>]`** — inverse of install.
- **`skills-bank path <name>`** — prints the absolute path to a skill. New affordance. Enables `cd $(skills-bank path foo)` and `$EDITOR $(skills-bank path foo)/SKILL.md`. Exits non-zero on miss so subshell substitution fails fast.

### Removed

- `import` — interactive scan/register flow. Lives in the desktop app's **Register existing skills**.
- `export <name>` — bulk operation done once, manually. Lives in **Account → Export current registry** in the app.
- `finalize` — agent-dir layout cleanup. Surfaced in **Settings → Collapse symlinked agent dirs**.
- `sync-installed` — relink-after-pull was a fix for a specific failure mode the app handles automatically.

No deprecation aliases. The four removed commands are still registered (hidden) as redirect-and-exit stubs: each prints a one-line pointer to the in-app equivalent and exits with code 2. Scripts calling them surface the change loudly rather than silently no-op'ing.

### README

Replaced the "Same operations through either surface" framing with **"Desktop app for humans, CLI for scripts."** The CLI section in the README is now a five-line command listing plus three composition examples (`$EDITOR $(... path foo)/SKILL.md`, `--agent` install for CI, `--json | jq` pipeline).

## Files touched

- **Deleted:** `packages/cli/src/commands/import.ts`, `export.ts`, `finalize.ts`, `sync-installed.ts`.
- **New:** `packages/cli/src/commands/path.ts`.
- `packages/cli/src/commands/install.ts` — accepts `--agent <id>`; passes through to `installSkill`'s existing `opts.agents` slot.
- `packages/cli/src/commands/uninstall.ts` — same treatment; also surfaces per-agent removals instead of just the first.
- `packages/cli/src/index.ts` — removed wiring for deleted commands; wired `path`; added redirect-stub registrations for the four removed names so commander's unknown-command path doesn't swallow them silently.
- `packages/core/src/install.ts` — error string updated to point at "Register existing skills" instead of `skills-bank import`.
- `packages/core/src/import.ts` — synthesized-meta placeholder updated to match.
- `README.md` — CLI section rewritten; tagline ("Desktop app and CLI. The same operations through either surface.") updated.

## Service extraction — deferred indefinitely

An earlier framing called for pure-TS service modules in `@skills-bank/core` to share register/unregister/sync between renderer IPC and CLI. With those operations removed from the CLI, the extraction isn't needed. The CLI now consumes only the existing `installSkill`, `uninstallSkill`, `listInstalled`, `buildRegistryIndex`, `resolveRegistryRoot`, and `getAgent` exports — all already pure-TS.

## Verification (one-shot, not committed)

- `skills-bank list --json | jq '.[].name'` returns registered skill names.
- `skills-bank installed --json | jq` yields one entry per `(skill, agent)` installation.
- `skills-bank path <name>` prints an absolute path; `cd $(skills-bank path <name>)` lands in the skill directory.
- `skills-bank install <name> --agent claude` followed by `skills-bank installed --json` includes the new installation scoped to that agent.
- `skills-bank import` (or `export` / `finalize` / `sync-installed`) prints a redirect message and exits with code 2.

## Out of scope

- Skill update from CLI. Per-skill upstream tracking already shipped (v0.11.x); whether `skills-bank update` should exist is a future decision.
- GitHub-mode operations from CLI. The app's github-linked flows stay UI-only.
