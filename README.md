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

On first launch the app boots straight into the Registry tab on top of a bundled curated skill set — no persona-choice screen, no `git clone` prerequisite.

![The Registry tab — the default view on first launch](docs/images/registry.png)

- **Use the bundled registry** _(the default; nothing to do)_ — Browse the curated skills shipped with the app, pull updates with one click via Sync, add your own alongside.
- **Link a GitHub repo** — Back your registry with a GitHub repo you own. Your repo holds the skill content (a `skills/` directory at the root, one folder per skill); the app pulls from it on demand. The first-launch screen offers **Connect your own registry**; authentication uses GitHub's Device Flow. Best for multi-machine continuity, team sharing, and version-controlled history. See [`docs/flows/login.md`](docs/flows/login.md#github-linked) for what to put in the repo and how to set it up.
- **Self-host** _(developer path)_ — Fork the app + registry and ship your own build. See [`docs/self-host.md`](docs/self-host.md).

Defaults for which agent directories an Install action targets live in **Settings…**.

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

| Path                                   | Purpose                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| [`skills/`](skills/)                   | The registry — one folder per skill containing `SKILL.md` and (optionally) `meta.json`. |
| [`packages/core`](packages/core)       | Shared TypeScript library: registry IO, install/uninstall, sync, registration.          |
| [`packages/cli`](packages/cli)         | The `skills-bank` CLI.                                                                  |
| [`packages/desktop`](packages/desktop) | Electron + React + Vite desktop app.                                                    |
| [`docs/`](docs/)                       | User-facing documentation. `meta-schema.json` defines the `meta.json` schema.           |

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
pnpm dev      # build main, watch renderer with Vite, launch Electron
# or
pnpm start    # one-shot production build, then launch Electron
```

`dev` keeps the renderer rebuilding on save; quit Electron (`Cmd+Q` and re-run) to pick up changes to the main or preload process.

> [!TIP]
> Set `SKILLS_BANK_ROOT=/path/to/skills-bank` in your shell to work against the cloned skills folder on disk. The app reads from there directly and silently sets `registrySource = "local"`. On a fresh clone, run `pnpm reset:seed` once before launching so Sync doesn't surface a collision for every skill.

Reset local state between test runs:

```bash
pnpm reset          # clears registry source + auth token
pnpm reset:hard     # also wipes the app-managed registry directory and re-seeds source markers
```

Before committing:

```bash
pnpm typecheck
pnpm docs:check             # link/anchor validator across README and docs/
```

## Building

```bash
pnpm package:mac          # both arm64 + x64
```

The workspace also exposes `:arm64` / `:x64` variants directly: `pnpm --filter @skills-bank/desktop package:mac:arm64`.

Output lands in `packages/desktop/dist-electron/`.

## Cutting a release

Release builds run on tag push:

```bash
# bump packages/desktop/package.json, commit, then:
git tag v0.7.0
git push origin v0.7.0
```

The `release` workflow signs, notarizes, and uploads both DMGs to a **draft** GitHub Release. Review and publish from the GitHub UI when ready.

## Documentation

| Topic                          | File                                                 |
| ------------------------------ | ---------------------------------------------------- |
| Getting started (5 min)        | [`docs/getting-started.md`](docs/getting-started.md) |
| Taxonomy and vocabulary        | [`docs/concepts.md`](docs/concepts.md)               |
| End-to-end user guide          | [`docs/user-guide.md`](docs/user-guide.md)           |
| Personas (bundled vs your-own) | [`docs/personas.md`](docs/personas.md)               |
| Heal flows                     | [`docs/flows/heal.md`](docs/flows/heal.md)           |
| Troubleshooting                | [`docs/troubleshooting.md`](docs/troubleshooting.md) |
| Self-hosting                   | [`docs/self-host.md`](docs/self-host.md)             |

## Scripts reference

`package.json` is bisected into two blocks: commands you'd type during a normal dev session (below), and maintenance / verification ops the agent runs on your behalf. The agent-facing block is documented in [`CLAUDE.md`](./CLAUDE.md) with cadence and triggers.

| Script        | Effect                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dev`         | Build the main process, watch the renderer with Vite, launch Electron with devtools enabled. The everyday dev loop. Quit and re-run to pick up main/preload changes.                              |
| `start`       | Full one-shot build followed by a packaged-mode Electron launch. Smoke test before declaring main-process work done — typecheck/build don't catch ESM/CJS runtime errors.                         |
| `build`       | Recursive build across every workspace package that defines a `build` script.                                                                                                                     |
| `format`      | Prettier write over `.{ts,tsx,js,jsx,md,mdx,json,yml,yaml}`.                                                                                                                                      |
| `package:mac` | Build a notarized DMG for both Apple Silicon and Intel. Output lands in `packages/desktop/dist-electron/`. Workspace exposes `:arm64` / `:x64` variants via `pnpm --filter @skills-bank/desktop`. |
