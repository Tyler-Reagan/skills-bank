<div align="center">

<img src="packages/desktop/build/icon.svg" alt="Skills Bank logo" width="120" height="120">

# Skills Bank

A registry, CLI, and desktop app for managing [Claude Code](https://claude.ai/code) skills across every AI agent on your machine — Claude Code, Cursor, Gemini, GitHub Copilot, Continue, Cline, Codex.

[![Release](https://img.shields.io/github/v/release/Tyler-Reagan/skills-bank?color=22c55e&label=release)](https://github.com/Tyler-Reagan/skills-bank/releases)
[![License: MIT](https://img.shields.io/github/license/Tyler-Reagan/skills-bank?color=22c55e)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-22c55e)

</div>

![The Registry tab — browse, search, and install curated skills](docs/images/registry.png)

A **skill** is a folder of instructions (`SKILL.md` + optional `meta.json`) that an AI agent reads at runtime to pick up a specialized capability. Skills Bank is the layer that keeps your skill collection organized, in sync across every agent directory on disk, and recoverable when things drift.

> [!NOTE]
> End-user docs live in **[`docs/`](docs/)** — start with [`docs/getting-started.md`](docs/getting-started.md).

## Features

- **One registry, every agent.** Install a skill once and Skills Bank symlinks it into `~/.claude/skills`, `~/.cursor/skills`, `~/.gemini/skills`, … in one shot. No copies, no drift.
- **Browse and search.** A curated registry ships with the app; tag filters, full-text search, and an Installed-only toggle.
- **Four-axis taxonomy.** Every skill is classified by **Canon / Registered / Adopted / Installed**, so destructive actions are always reversible by intent. See [`docs/concepts.md`](docs/concepts.md).
- **Canon protection.** Skills from your linked upstream are exempt from Unregister and Delete; **Hide** is the canon-only way to tuck one away.
- **Heal flows.** Explicit recovery for canon drift, missing folders, broken external paths, and conflicting installs.
- **Sync without losing your edits.** Upstream pulls refresh canonical skills; your authored tags and unmanaged skills are never touched.
- **Desktop app and CLI.** The same operations through either surface.

## Get started

### Desktop

Grab the latest DMG from the [Releases page](https://github.com/Tyler-Reagan/skills-bank/releases) — both Apple Silicon (`-arm64.dmg`) and Intel (`-x64.dmg`) builds are published. Open the DMG, drag **Skills Bank** to Applications, then launch from Spotlight.

> [!NOTE]
> Builds are signed with a Developer ID certificate and notarized through Apple — Gatekeeper opens them on a normal double-click. The app auto-updates by polling the Releases feed on launch.

On first launch, pick a persona:

![First-launch setup screen with Quick start and Advanced sections](docs/images/setup.png)

- **Use the bundled registry** *(quick start)* — Browse the curated skills shipped with the app, pull updates with one click, add your own alongside. No GitHub required.
- **Connect a GitHub registry** *(advanced)* — Point at a GitHub repo you own. The app clones it locally and never auto-syncs — you manage content through your normal git workflow.
- **Self-host** *(advanced)* — Fork the app + registry and ship your own build. See [`docs/self-host.md`](docs/self-host.md).

You can switch later from the account menu. Defaults for which agent directories an Install action targets live in **Settings…**.

### CLI

```bash
pnpm install
pnpm run build
node packages/cli/dist/index.js list
node packages/cli/dist/index.js install <name>     # broadcasts to every existing agent dir
node packages/cli/dist/index.js installed
node packages/cli/dist/index.js uninstall <name>
node packages/cli/dist/index.js import             # adopt pre-existing skills outside the registry
node packages/cli/dist/index.js finalize           # collapse a symlinked top-level agent dir
node packages/cli/dist/index.js export <name>      # raw .md (standalone) or .zip (bundled)
```

## What's in this repo

| Path | Purpose |
|---|---|
| [`skills/`](skills/) | The registry — one folder per skill containing `SKILL.md` and (optionally) `meta.json`. |
| [`packages/core`](packages/core) | Shared TypeScript library: registry IO, install/uninstall, sync, registration. |
| [`packages/cli`](packages/cli) | The `skills-bank` CLI. |
| [`packages/desktop`](packages/desktop) | Electron + React + Vite desktop app. |
| [`docs/`](docs/) | User-facing documentation. `meta-schema.json` defines the `meta.json` schema. |

## Authoring a registry skill

Drop a folder at `skills/<name>/` containing:

- `SKILL.md` — the skill prompt content. Optionally has YAML frontmatter (`name`, `description`).
- `meta.json` — metadata matching [`docs/meta-schema.json`](docs/meta-schema.json). Optional fields: `tags`, `version`, `author`.

Then validate and rebuild the index:

```bash
pnpm run validate
pnpm run build:index
```

The desktop app re-reads the registry from disk on every refresh, so changes appear immediately when running against `SKILLS_BANK_ROOT`.

## Local development

```bash
pnpm install
pnpm run desktop:dev      # build main, watch renderer with Vite, launch Electron
# or
pnpm run desktop:start    # one-shot production build, then launch Electron
```

`desktop:dev` keeps the renderer rebuilding on save; quit Electron (`Cmd+Q` and re-run) to pick up changes to the main or preload process.

> [!TIP]
> Set `SKILLS_BANK_ROOT=/path/to/skills-bank` in your shell to work against the canonical skills folder on disk. The app reads from there directly and silently sets persona = convenience.

Reset local state between test runs:

```bash
pnpm run desktop:reset          # clears persona + auth token
pnpm run desktop:reset:hard     # also wipes the app-managed registry directory
```

Before committing:

```bash
pnpm run typecheck
pnpm run docs:check             # link/anchor validator across README and docs/
```

## Building

```bash
pnpm run desktop:package:mac          # both arm64 + x64
pnpm run desktop:package:mac:arm64    # Apple Silicon only
pnpm run desktop:package:mac:x64      # Intel only
```

Output lands in `packages/desktop/dist-electron/`.

> [!WARNING]
> A Windows target (`package:win`) exists but isn't exercised in CI or by maintainers. Bug reports welcome.

## Cutting a release

Release builds run on tag push:

```bash
# bump packages/desktop/package.json, commit, then:
git tag v0.7.0
git push origin v0.7.0
```

The `release` workflow signs, notarizes, and uploads both DMGs to a **draft** GitHub Release. Review and publish from the GitHub UI when ready.

## Documentation

| Topic | File |
|---|---|
| Getting started (5 min) | [`docs/getting-started.md`](docs/getting-started.md) |
| Taxonomy and vocabulary | [`docs/concepts.md`](docs/concepts.md) |
| End-to-end user guide | [`docs/user-guide.md`](docs/user-guide.md) |
| Personas (bundled vs your-own) | [`docs/personas.md`](docs/personas.md) |
| Heal flows | [`docs/flows/heal.md`](docs/flows/heal.md) |
| Troubleshooting | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Self-hosting | [`docs/self-host.md`](docs/self-host.md) |
