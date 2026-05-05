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
```

## Desktop

```bash
pnpm run desktop:dev
```

## Authoring skills

Drop a folder under `skills/<category>/<name>/` containing `meta.json` (matching `docs/meta-schema.json`) and `SKILL.md`. Then:

```bash
pnpm run validate
pnpm run build:index
```
