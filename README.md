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

On first launch the app shows a two-card onboarding screen — pick a starting point and you're in the Registry tab from then on.

![The Registry tab — the default view on first launch](docs/images/registry.png)

- **Use the public skills bank** _(the default, low-friction)_ — Browse and install from the curated `Tyler-Reagan/skills-bank` repo. No GitHub account needed. Refresh pulls the latest at the unauthenticated GitHub rate limit (60/hr). Sign in later for 5000/hr.
- **Connect with GitHub** — Authenticate via Device Flow, then pick a repo to mirror. The curated bank is pre-listed as **Recommended** (same content, 5000/hr); or pick any GitHub repo you own (with a `skills/` directory at its root) to host your own registry. Best for multi-machine continuity, team sharing, and version-controlled history. See [`docs/flows/login.md`](docs/flows/login.md) for what to put in the repo and how to set it up.
- **Self-host** _(developer path)_ — Fork the app + registry and ship your own build. See [`docs/self-host.md`](docs/self-host.md).

Either way, every user gets the same surfaces: **Refresh from `<repo>`** in the header pulls the latest with diff-before-apply, and **Account → Change linked repo** lets you swap your linked repo any time. Defaults for which agent directories an Install action targets live in **Settings…**.

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
> Set `SKILLS_BANK_ROOT=/path/to/skills-bank` in your shell to work against the cloned skills folder on disk. The app reads from there directly with no linked repo (treated as bundled-default). On a fresh clone, run `pnpm reset:seed` once before launching so Refresh doesn't surface a collision for every skill.

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

Releases are tag-driven. Pushing `vX.Y.Z` to GitHub fires [`.github/workflows/release.yml`](.github/workflows/release.yml), which builds + signs + notarizes both arch DMGs on `macos-15` and uploads them to a **draft** GitHub Release. The release is invisible to auto-update clients and the public Releases page until you click **Publish** in the GitHub UI — that click is the gate that ships to existing installs.

The convention: **feature PRs merge first**, then a standalone `chore(release): bump desktop to X.Y.Z` commit lands directly on `main`, and the tag points at that bump commit. Don't bump version inside a feature PR — it keeps the release commit decoupled from the work it encompasses and makes the history readable. Merge style is a real merge commit (not squash) so the individual bundles in a multi-commit PR stay legible.

Version source of truth is [`packages/desktop/package.json`](packages/desktop/package.json) only. The root `package.json` doesn't carry a public version.

### Steps

1. **Merge the feature PR** via the GitHub UI (or `gh pr merge --merge`).
2. **Update local main:**
   ```bash
   git checkout main && git pull --ff-only
   ```
3. **Bump `packages/desktop/package.json`**, then verify nothing else moved and that the full CI-equivalent gauntlet passes:
   ```bash
   git diff   # should touch packages/desktop/package.json only
   pnpm typecheck && pnpm validate && pnpm build:index && pnpm build
   ```
4. **Commit and push the bump:**
   ```bash
   git commit -am "chore(release): bump desktop to X.Y.Z"
   git push origin main
   ```
   The bump commit body conventionally lists the PRs the release encompasses (see `git log --grep "chore(release)"` for prior examples).
5. **Tag and push.** The tag must point at a commit already on `origin/main` — the workflow does a fresh checkout of the tag SHA.
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```
6. **Watch the build** (~15–25 min):
   ```bash
   gh run watch
   ```
7. **Verify the draft Release.** Once the workflow succeeds, the draft on the Releases page should carry:
   - `Skills-Bank-X.Y.Z-x64.dmg` + `Skills-Bank-X.Y.Z-arm64.dmg` (and matching `.dmg.blockmap` for delta updates)
   - `Skills-Bank-X.Y.Z-x64.zip` + `Skills-Bank-X.Y.Z-arm64.zip` (consumed by `electron-updater` at runtime; arch is selected automatically)
   - `latest-mac.yml` (the auto-update manifest — without this, existing installs won't see the release)

   Download at least one DMG and smoke-test launch locally before publishing.
8. **Publish from the GitHub UI.** Open the draft, write release notes, click **Publish**. Existing installs poll the Releases feed on launch and will auto-update on next start.

### If the release build fails or ships wrong artifacts

The workflow doesn't auto-clean. Diagnose, push a fix to `main` as a normal commit, then **move the tag forward to the new SHA** and let the workflow re-run:

```bash
git tag -d vX.Y.Z && git push origin :refs/tags/vX.Y.Z
git tag vX.Y.Z   && git push origin vX.Y.Z
```

Delete the partial draft Release from the GitHub UI first if any artifacts uploaded; `gh release upload --clobber` will otherwise reuse the existing draft. The v0.9.0 release hit this exact path — the initial build clobbered x64 outputs with arm64, fixed in [`202b0ba`](https://github.com/Tyler-Reagan/skills-bank/commit/202b0ba), and the tag was moved forward to that SHA.

## Documentation

| Topic                          | File                                                 |
| ------------------------------ | ---------------------------------------------------- |
| Getting started (5 min)        | [`docs/getting-started.md`](docs/getting-started.md) |
| Taxonomy and vocabulary        | [`docs/concepts.md`](docs/concepts.md)               |
| End-to-end user guide          | [`docs/user-guide.md`](docs/user-guide.md)           |
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
