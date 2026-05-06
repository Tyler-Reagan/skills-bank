# Skills Bank user guide

This guide walks through what Skills Bank does, the concepts the UI uses, and the everyday flows you'll hit as a user. If you just want to install the app, see the [README](../README.md).

## Concepts

### Skill

A folder containing instructions ("`SKILL.md`") and optional metadata ("`meta.json`") that an AI agent — Claude Code, Cursor, etc. — can pick up at runtime to gain a specialized capability. A skill is just files on disk; nothing about it requires this app.

### Agent directory

Every AI agent reads its skills from a fixed directory under your home folder:

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

A "skill" is just a subfolder under one of these. Skills Bank scans every one of them.

### Registry

A **persisted collection of skills and their metadata** maintained by this app. The registry lives as a folder of skill subfolders (`<repo>/skills/<name>/`) plus generated metadata. Installing a skill from the registry creates a symlink in each of your agent directories pointing back at the registry's copy.

**The registry is not the exclusive source of skills you can use.** Skills you install from elsewhere — for instance via [skills.sh](https://skills.sh/) — appear in the **Installed** tab alongside registry-managed ones, and you can [migrate](#migrating) them into the registry if you want this app to manage them.

### Persona

A one-time decision made on the app's first launch that controls which features are available:

- **Convenience persona** (skip auth) — Use the curated registry shipped with this app. One-click "Sync" pulls upstream updates while preserving any skills you've added on top. Naming conflicts are resolved through a small modal.
- **Power persona** (authenticate with GitHub) — Replace the registry with a private repo of your own. You maintain it through your normal GitHub workflow; this app's auto-sync is off.
- **Self-host** — Fork the repo and ship your own build. See [docs/self-host.md](self-host.md).

Persona is persisted; you can switch by signing out (account menu → "Sign out of GitHub") and re-launching.

### Source

Each skill in the registry carries a `source` marker that drives the badge on its card:

- **`canonical`** — Pulled from the upstream registry by Sync. No badge (the default).
- **`user`** — Authored locally. Badge: **Yours**.
- **`imported`** — Imported from a power-persona repo replacement. Badge: **Imported**.

Markers live in a sibling `.skills-bank.json` per skill so they don't pollute upstream.

## Day-to-day flows

### Browse and install a registry skill

The **Registry** tab lists every skill in the curated registry. Cards show the skill's name, description, tags, and (if installed) chips for which agent directories have it linked.

1. Click a card to open its detail drawer.
2. Click **Install**. The app symlinks the skill into every agent directory that exists on your machine (e.g. both `~/.claude/skills/` and `~/.cursor/skills/` if you have both).
3. The card's chips update to show the agents now linked.

### See everything that's installed

The **Installed** tab shows every skill linked into any agent directory on this machine, regardless of whether this app added it. Two sections:

- **Integrated** — managed by this app's registry.
- **Not yet integrated** — installed from elsewhere (CLI, manual, another tool). Each card shows the directory the skill came from (e.g. `~/.cursor`, `~/.agents`) so you can see at a glance which agent has the unmanaged copy.

### Migrating

Migrating moves a skill from "linked into an agent dir but unmanaged" into the registry. Three things happen:

1. The skill's files move under `<repo>/skills/<name>/`.
2. The agent-dir symlink is rewritten to point at the new registry location.
3. The skill picks up registry metadata (warnings, validation, etc.).

Click any "Not yet integrated" card to migrate that one, or use **Migrate All** in the section header to do them in a batch.

### Sync (convenience persona only)

The **Sync skills** button in the header pulls the latest skills from the canonical upstream registry. Updates are **upsert** — canonical skills get refreshed; skills you authored or imported are never touched. If a name collision appears, a modal asks how to resolve it (keep yours, accept canonical, or rename yours to `<name>-local`). Decisions are remembered.

### Replace the registry (power persona)

Open the account menu (top-right of the header) → **Choose registry repo…**. The app lists your GitHub repos; pick one that has a `skills/` directory at its root. The app clones it into the local registry location, replacing whatever was there. Skills from the chosen repo are tagged `imported`. Auto-sync is off in this mode — maintaining the repo is your responsibility.

### Sign out

Account menu → **Sign out of GitHub**. The token is cleared, persona resets, and the LoginScreen reappears on next launch.

## App vs. registry updates

These are independent:

- **App updates** arrive via auto-update. The app polls the GitHub Releases feed on launch; when a new version downloads in the background, a "Restart" toast lets you apply it.
- **Registry updates** (convenience persona) arrive via the Sync button. They never trigger an app restart.

You can update one without the other. A new release of the app doesn't change which skills you have; a new sync doesn't change the app binary.

## Reset for testing

For developers iterating on the app, two scripts wipe local state:

```bash
pnpm run desktop:reset          # clear persona + token; keep registry contents
pnpm run desktop:reset:hard     # also wipe the app-managed registry directory
```

Both handle the dev-mode and packaged userData paths automatically. Set `unset SKILLS_BANK_ROOT` before relaunching if you want to see the LoginScreen — that env var auto-routes devs into convenience mode.

## Glossary

| Term | Quick definition |
|---|---|
| **Agent** | An AI tool that reads skills (Claude Code, Cursor, …). |
| **Agent directory** | Where an agent reads its skills from (e.g. `~/.cursor/skills/`). |
| **Registry** | The persisted, metadata-tagged collection of skills this app manages. |
| **Persona** | The user's mode: `convenience` (curated) or `power` (your own repo). |
| **Source** | Origin tag on each skill: `canonical`, `user`, or `imported`. |
| **Sync** | One-click pull of the canonical registry. Convenience persona only. |
| **Migrate** | Move an unmanaged installed skill into the registry. |
| **Finalize** | Collapse a symlinked agent dir (e.g. `~/.claude/skills` → `~/.agents/skills`) into a real directory. |
