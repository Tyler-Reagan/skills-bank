# Concepts

The vocabulary the app uses, defined in one place. Skim this once and the rest of the docs (and the UI itself) become a lot more obvious.

## Skill

A folder containing instructions (`SKILL.md`) and optional metadata (`meta.json`) that an AI agent — Claude Code, Cursor, Gemini, etc. — picks up at runtime to gain a specialized capability. A skill is just files on disk; nothing about it requires this app to exist.

## Agent directory

Every supported AI agent reads skills from a fixed directory under your home folder:

| Agent | Directory |
|---|---|
| Claude Code | `~/.claude/skills/` |
| Cursor | `~/.cursor/skills/` |
| Gemini | `~/.gemini/skills/` |
| GitHub Copilot | `~/.copilot/skills/` |
| Continue | `~/.continue/skills/` |
| Cline | `~/.cline/skills/` |
| OpenAI Codex | `~/.codex/skills/` |
| Shared (any) | `~/.agents/skills/` |

Skills Bank scans every one of these. If a directory doesn't exist on your machine, it's just skipped — no error, no prompt.

## Registry

The **persisted, metadata-tagged collection of skills this app manages.** It's a folder of skill subfolders (`<repo>/skills/<name>/`) plus a generated index. Installing a skill from the registry creates a symlink in each of your agent directories pointing back at the registry's copy — no copies, no drift.

The registry is **not** the only source of skills you can use. Skills installed from elsewhere (e.g. via [skills.sh](https://skills.sh/)) appear alongside in the **Installed** tab and can be registered into Skills Bank if you want this app to manage them.

## Persona

A one-time decision made on first launch that controls which features the app exposes:

- **Convenience** — Use the curated registry bundled with the app. One-click sync pulls upstream updates; you can add your own skills on top.
- **Power** — Replace the registry with a GitHub repo of your own. You maintain it; auto-sync is off.
- **Self-host** — Fork the app + registry and ship your own build.

Persona is persisted. You can switch by signing out (account menu → **Sign out of GitHub**) or by changing registry from the same menu.

## Source

Each registry skill carries a `source` marker that records *where it came from*:

- **`canonical`** — Pulled from the upstream registry by Sync.
- **`user`** — Authored locally on this machine.
- **`imported`** — Imported from a power-persona repo replacement.

Markers live in a sibling `.skills-bank.json` per skill so they don't pollute upstream.

## Publish state

Where `source` records origin, **publish state** records whether a skill has been pushed to the registry's remote. It's computed from the git status of `<repo>/skills/<name>/`:

- **`pushed`** — The skill's latest commit is on the upstream branch. The card has no badge — this is the calm default for clean registry skills.
- **`draft`** — Committed locally but not yet on the remote.
- **`untracked`** — New or modified files that aren't committed.

The badge on each card combines source + publish state:

- **`YOURS`** — purely locally-authored: either the skill isn't in the registry yet, or it's a registry skill with `source: user` and no canonical history.
- **`PROTECTED`** — a previously-canonical registry skill saved locally. Sync skips it.
- **`IMPORTED`** — registry skill from a power-persona repo replacement.
- **`DRAFT`** — a `canonical` registry skill with uncommitted or unpushed local changes. **Sync may overwrite these on the next pull.** Click **Save locally** in the drawer to flip its source to `user` and protect your changes.
- *(no badge)* — `canonical` and pushed: the calm default.

### Save locally / Protected (convenience persona)

The convenience-persona Sync flow refreshes anything tagged `canonical` from upstream. Any local change to a curated skill — editing tags via the card, modifying `SKILL.md`, etc. — automatically flips its source to `user` so Sync won't touch it on the next pull. The card shows the `PROTECTED` badge.

The drawer surfaces the protection state in the Metadata section. You can:

- Click **Save locally** if a curated skill picked up edits some other way and the protection didn't auto-apply.
- Click **Unprotect** to revert a protected skill to `canonical`, allowing Sync to overwrite it next time.

Power-persona and self-host users don't see these affordances — they manage persistence through their own repo's git workflow.

## Installation kind

Each installed skill is classified by what's at its agent-dir path:

- **`ours`** — A symlink that resolves into the app's registry. Owned by Skills Bank.
- **`real-directory`** — A regular folder of files (e.g. installed by another tool's CLI).
- **`foreign-symlink`** — A symlink to somewhere outside the registry.

The Installed tab uses these to decide which section a skill goes in (Registered vs Not registered) and which actions to offer (Uninstall, Register, Resolve conflicts).

## Conflict

A skill is in conflict when it's registered in Skills Bank **and** has stragglers — a real directory or foreign symlink with the same name in another agent dir. The drawer offers **Resolve conflicts** to clean them up: replace each duplicate with a symlink to the registry copy, keep it separate, or delete it.

## Sync (convenience persona)

A one-click pull of upstream registry updates. Sync is **upsert**: canonical skills refresh, skills you authored or imported are never touched. Name collisions surface a modal — keep yours, take theirs, or rename yours.

## Migrate

The act of moving an "installed but unmanaged" skill into the registry. The files relocate to `<repo>/skills/<name>/`, the original agent-dir entry becomes a symlink, and the skill picks up registry metadata.

## Finalize

Collapse a symlinked top-level agent dir (e.g. `~/.claude/skills` → `~/.agents/skills`) back into a real directory of its own. Used when you want each agent to own its skills independently after previously sharing.
