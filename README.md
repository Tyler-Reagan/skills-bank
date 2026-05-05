# skills-bank

Central registry of [Claude Code](https://claude.ai/code) skills, plus a TypeScript CLI and Electron desktop manager for installing them locally as symlinks under `~/.claude/skills/`.

## What's here

- `skills/` — the registry. Each skill is a folder with `SKILL.md` and `meta.json`.
- `packages/core` — shared TS library (types, registry IO, install/uninstall, migration scan).
- `packages/cli` — `skills-bank` CLI.
- `packages/desktop` — Electron + React + Vite desktop app.
- `scripts/` — schema validation and `index.json` generation.
- `docs/meta-schema.json` — JSON Schema for `meta.json`.

## Install model

Installing a skill creates a symlink at `~/.claude/skills/<name>` pointing into this repo's `skills/<category>/<name>` folder. No copies. Uninstalling removes the symlink only — never the source.

## CLI

```bash
pnpm install
pnpm run build
node packages/cli/dist/index.js list
node packages/cli/dist/index.js install <name>
node packages/cli/dist/index.js installed
node packages/cli/dist/index.js uninstall <name>
node packages/cli/dist/index.js import        # migrate pre-existing ~/.claude/skills entries
node packages/cli/dist/index.js finalize      # if ~/.claude/skills is itself a symlink, replace with a real dir
node packages/cli/dist/index.js export <name> # export a registry skill: raw SKILL.md if standalone, .zip if bundled
```

> `finalize` is for the case where `~/.claude/skills` was previously redirected to another folder (e.g. `~/.agents/skills`) by another tool. After all entries are adopted, finalize swaps the top-level symlink for a real directory containing the same per-skill symlinks — eliminating the double-hop indirection. The original symlink is preserved as `~/.claude/skills.bak.<timestamp>`.

## Desktop

First-time setup (installs deps and downloads the Electron binary):

```bash
pnpm install
```

Run the app locally:

```bash
pnpm run desktop:dev      # build main process, watch renderer with Vite, launch Electron
# or
pnpm run desktop:start    # one-shot production build, then launch Electron
```

`desktop:dev` keeps the renderer rebuilding on save; restart Electron (`Cmd+Q` and re-run) to pick up changes to the main or preload process.

Package distributable installers (output under `packages/desktop/dist-electron/`):

```bash
pnpm run desktop:package:mac    # .dmg
pnpm run desktop:package:win    # NSIS installer
```

## Authoring skills

Drop a folder under `skills/<category>/<name>/` containing `meta.json` (matching `docs/meta-schema.json`) and `SKILL.md`. Then:

```bash
pnpm run validate
pnpm run build:index
```
