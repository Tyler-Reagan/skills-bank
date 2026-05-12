# Concepts

The vocabulary the app uses, defined in one place. Skim this once and the rest of the docs (and the UI itself) become a lot more obvious.

## Taxonomy

Every skill the app knows about sits on four orthogonal axes. Operations and UI gating derive from these axes, not from ad-hoc per-component checks.

- **Canon** — derived boolean. A skill is canon iff its name appears in the linked registry repo's upstream — the user's own GitHub repo for power persona, the bundled canonical set for convenience. Mutating canon requires write access to the linked repo; mutating a skill's canon-ness locally is impossible. Resolved dynamically against the active linked repo (not from stale per-skill markers).
- **Registered** — boolean. The skill has an entry in the local registry index. Mutated freely. Holds local-only metadata (tags, install paths, the Adopted flag).
- **Adopted** — boolean on each registry entry. When `true`, the skill's files physically live under `<registryRoot>/skills/<name>/`. When `false`, the registry entry tracks an external location and the files stay where they are. Default at register time is the `registerAdopts` setting (default `true`).
- **Installed** — derived from on-disk scan. A skill is installed if at least one agent dir contains an entry at `<agentDir>/<name>`. Per-agent kinds: `ours`, `foreign-symlink`, `real-directory`, `broken-symlink`.

### Derived rules

- Canon ⇒ registered by default. Unregister and delete of canon skills are prohibited; the user-visible escape is **hide**, scoped per linked-repo.
- Non-canon + registered + uninstalled is valid. Re-install requires the original source (no upstream to pull from).
- Registered + broken/conflicting installations ⇒ heal flow with explicit choices.
- Unregister of an adopted skill expels its files to the `unregisterDestinationAgent` setting (default `~/.agents/skills/`). Unregister of a non-adopted skill removes the index entry; origin files are untouched.

### Destructive-action ladder

Three actions form an escalation, with distinct file/recovery semantics:

| Action | Files | Agent symlinks | Recovery |
|---|---|---|---|
| Remove from agents | untouched | removed | reinstall |
| Unregister | adopted: moved to expulsion dir; non-adopted: untouched | removed | re-register from new location |
| Delete from Skills Bank | deleted | removed | canon: re-pull; non-canon: gone (modulo export) |

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

A one-time decision made on first launch that determines how the app manages your registry:

- **Bundled registry** — Use the curated skill set shipped with this app. Pull updates with one click; add your own skills alongside. Export the registry to back it up or move it to another machine.
- **Your own registry** — Point the app at a GitHub repo you own and maintain. The app clones it locally and never auto-syncs it — you manage content through your normal git workflow.

Self-hosting (forking the entire app) is a developer path, not a runtime persona. See [self-host.md](self-host.md) for details.

Persona is persisted. You can switch via the account menu in the header. See [personas.md](personas.md) for a full feature comparison.

## Source

Each registry skill carries a `source` marker that records *where it came from*:

- **`canonical`** — Pulled from the upstream registry by Sync.
- **`user`** — Authored locally on this machine.
- **`imported`** — Imported from a power-persona repo replacement.

Markers live in a sibling `.skills-bank.json` per skill so they don't pollute upstream.

### Tags are local

Tags are a local-only dimension. You can add or remove tags on any skill — including the curated ones bundled with the app — and Sync will preserve your tag edits on the next pull. No protection step required: Sync reads the existing local tag list before writing the canonical content and splices it back in.

### Card badges

- **`YOURS`** — skill isn't in the registry, or is registered with `source: user`.
- **`IMPORTED`** — registry skill from a power-persona repo replacement.
- *(no badge)* — curated/canonical: the calm default.

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

## Register

The act of moving an "installed but unmanaged" skill into the registry. The files relocate to `<repo>/skills/<name>/`, the original agent-dir entry becomes a symlink, and the skill picks up registry metadata.

## Finalize

Collapse a symlinked top-level agent dir (e.g. `~/.claude/skills` → `~/.agents/skills`) back into a real directory of its own. Used when you want each agent to own its skills independently after previously sharing.
