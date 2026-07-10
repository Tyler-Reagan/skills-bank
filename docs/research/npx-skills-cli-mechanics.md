# Research: `npx skills` CLI (skills.sh) mechanics

Wayfinder ticket: [Research: npx skills CLI (skills.sh) — command surface, on-disk footprint, and mechanics](https://github.com/Tyler-Reagan/skills-bank/issues/183), child of map [#182](https://github.com/Tyler-Reagan/skills-bank/issues/182).

Source: [vercel-labs/skills](https://github.com/vercel-labs/skills) (npm package `skills`, MIT), read directly from its `src/` — not secondhand blog summaries. Docs at [skills.sh/docs](https://www.skills.sh/docs) are thin; the source is the source of truth below.

## Command surface

Full set, from `src/cli.ts`:

| Command | Purpose |
| --- | --- |
| `add <package>` | Install a skill. Source can be `owner/repo`, a full GitHub/GitLab URL, a git URL, or a local path. |
| `use <package>@<skill>` | Generate/run a skill without persisting it to disk. |
| `remove` (`rm`) | Uninstall installed skill(s). |
| `list` (`ls`) | List installed skills. |
| `find [query]` | Interactive or keyword skill discovery. |
| `update` | Refresh installed skills against their recorded source. |
| `init [name]` | Scaffold a new skill. |
| `experimental_install` | Restore the exact set/versions recorded in `skills-lock.json`. |
| `experimental_sync` | Sync skills declared in `node_modules` (npm-package-distributed skills). |

Common flags: `-g/--global` vs `-p/--project` scope, `-a/--agent <agents...>` (or `--agent '*'` for all detected agents), `-y/--yes` to skip prompts, `--copy` to force copy mode.

## On-disk footprint — there IS a detectable marker

This directly answers the open question behind [Decide: origin backfill for externally npx-installed skills (#185)](https://github.com/Tyler-Reagan/skills-bank/issues/185): **npx skills does leave a lockfile skills-bank could read.**

- **Global scope:** `~/.agents/.skill-lock.json` (or `$XDG_STATE_HOME/skills/.skill-lock.json` if that env var is set) — `src/skill-lock.ts`.
- **Project scope:** `./skills-lock.json` in the project root — `src/update.ts` (`hasProjectSkills`).
- **Schema** (current version 3, `SkillLockEntry`), keyed by skill name:
  - `source` — normalized source id, e.g. `"owner/repo"`.
  - `sourceType` — `"github"`, `"mintlify"`, `"huggingface"`, `"local"`, etc.
  - `sourceUrl` — **the original URL used to install** — this is the field that maps directly onto skills-bank's `origin.url`.
  - `ref` — branch/tag used.
  - `skillPath` — subpath within the source repo, if the repo isn't the skill root.
  - `skillFolderHash` — GitHub tree SHA for the whole skill folder (changes on any file change in the folder).
  - `installedAt` / `updatedAt` — ISO timestamps.
  - `pluginName` — if installed via a Claude Code plugin marketplace manifest.
- No other marker file is written inside the skill folder itself — the `SKILL.md` frontmatter only carries `name` and `description`, nothing provenance-related. **The lockfile is the only signal; the skill folder alone is indistinguishable from a hand-authored one.**

Manifest discovery: if a source repo has `.claude-plugin/marketplace.json` or `.claude-plugin/plugin.json`, npx skills reads skills declared there too (Claude Code plugin marketplace compatibility) — those get `pluginName` set in the lock entry.

## Copy vs. symlink

- Default: **symlink**. Skills install into a canonical store — `getCanonicalSkillsDir()` = `<home-or-cwd>/.agents/skills/<name>` — and each target agent directory (`.claude/skills/`, `.cursor/skills/`, etc.) gets a symlink pointing at the canonical copy. Single source of truth, one place to update.
- `--copy` flag forces independent copies per agent instead.
- If `symlinkSync()` throws (e.g. filesystem doesn't support symlinks), `installer.ts` falls back to a direct copy automatically and marks `symlinkFailed` in the result — so copy-mode skills can appear even when the user asked for symlinks.
- "Universal" agents skip the redundant symlink and read the canonical directory directly (avoids double-listing).

## Multi-harness selection

- `detectInstalledAgents()` auto-detects which of the 70+ supported agents (Claude Code, Cursor, Cline, OpenCode, Codex, etc.) are present on the machine and prompts interactively to pick targets, unless `-a/--agent` or `-y/--yes` is given.
- `--agent '*'` targets every detected agent at once.
- This detection is **install-time only** — there's no persistent multi-harness link management after install; `update`/`remove` re-resolve from the lockfile, not from re-scanning agents.

## Update/versioning behavior

- `update` re-reads the lockfile entry for each skill (or all, or a name-filtered subset via positional args), re-fetches from `sourceUrl` at the recorded `ref`, recomputes `skillFolderHash`, and rewrites the skill content + lock entry if it changed. It does **not** do semver-style versioning — the only "version" concept is the folder-content hash, not a release number.
- `experimental_install` is the closest thing to a reproducible-install / `npm ci` equivalent: it replays exactly what's in `skills-lock.json` rather than touching whatever's currently in the agent directories.
- Scope resolution for bare `update`/other scope-sensitive commands: project if run inside a project dir (detected via `hasProjectSkills` — project lockfile present, or `.agents/skills/*/SKILL.md` present), else global.

## What this means for the other tickets on this map

- **[#185 — origin backfill](https://github.com/Tyler-Reagan/skills-bank/issues/185):** the lockfile's `sourceUrl` is a real, structured signal skills-bank could read to backfill `origin.url` for skills that were npx-installed outside skills-bank — not a "nothing to detect" situation. The open design question narrows to *where* to look (global `~/.agents/.skill-lock.json` vs. project `./skills-lock.json`, and precedence if both reference the same skill folder) and whether reading another tool's private lockfile format is a boundary skills-bank wants to depend on.
- **[#186 — install-path architecture](https://github.com/Tyler-Reagan/skills-bank/issues/186):** confirms the Discover-tab path and the real `npx skills add` are mechanically distinct today (GitHub-API mirror vs. clone + canonical-store + symlink + lockfile write) — any "replicate" approach would need to decide whether to also write a compatible lockfile entry, or accept that skills-bank-installed skills stay invisible to `npx skills list`/`update` and vice versa.
