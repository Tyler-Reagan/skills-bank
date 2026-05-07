# skills-bank

A registry of [Claude Code](https://claude.ai/code) skills plus a TypeScript CLI and Electron desktop app for managing them across every AI agent you use (Claude Code, Cursor, Gemini, GitHub Copilot, Continue, Cline, Codex).

![The Registry tab — browse, search, and install curated skills](docs/images/registry.png)

End-user docs live in **[`docs/`](docs/)** — start with [`docs/getting-started.md`](docs/getting-started.md). For the project roadmap, see **[ROADMAP.md](ROADMAP.md)**.

## What's in this repo

| Path | What |
|---|---|
| `skills/` | The registry — one folder per skill containing `SKILL.md` and (optionally) `meta.json`. |
| `packages/core` | Shared TypeScript library: registry IO, install/uninstall, sync, migration. |
| `packages/cli` | The `skills-bank` CLI. |
| `packages/desktop` | Electron + React + Vite desktop app. |
| `docs/` | User-facing documentation. `meta-schema.json` defines the `meta.json` schema. |

## How install works

Each skill is a folder under `skills/<name>/`. Installing a skill creates a symlink at `<agent-dir>/<name>` pointing back into `<repo>/skills/<name>/` — no copies. The desktop app and CLI broadcast the symlink across **every agent directory you have set up** (e.g. both `~/.claude/skills` and `~/.cursor/skills`), so the same skill is available wherever you run an AI agent. Uninstalling removes the symlinks; the source folder is never deleted.

The "registry" is the metadata-tagged collection of skills this app manages. It is **not** the only source of skills you can use — anything you install from elsewhere (e.g. via the [skills.sh CLI](https://skills.sh/)) shows up alongside in the **Installed** tab.

## Desktop app

### Install

Grab the latest DMG from the [Releases page](https://github.com/Tyler-Reagan/skills-bank/releases) — both Apple Silicon (`-arm64.dmg`) and Intel (`-x64.dmg`) builds are published. Open the dmg, drag **Skills Bank** to Applications, then launch from Spotlight. The build is unsigned, so the first launch needs **right-click → Open** to bypass Gatekeeper; subsequent launches are normal double-clicks.

The app auto-updates by polling the Releases feed on launch. Updates to the app and updates to the registry contents are independent — see the user guide for details.

### First launch

The app shows a one-time setup decision split across **Quick start** and **Advanced** sections:

![First-launch setup screen with Quick start and Advanced sections](docs/images/setup.png)

- **Use the bundled registry** *(quick start)* — Browse the curated skills shipped with this app, pull updates with one click, add your own skills alongside. No GitHub required.
- **Connect a GitHub registry** *(advanced)* — Replace the registry with one of your own GitHub repos. You maintain it; auto-sync is off.
- **Self-host** *(advanced)* — Fork the app + registry and ship your own build. Opens [docs/self-host.md](docs/self-host.md).

You can switch later (sign out / change registry) from the account menu in the header. Defaults like which agent directories an "Install" action targets live in **Settings…** in the same menu.

### Local development

```bash
pnpm install
pnpm run desktop:dev      # build main, watch renderer with Vite, launch Electron
# or
pnpm run desktop:start    # one-shot production build, then launch Electron
```

`desktop:dev` keeps the renderer rebuilding on save; restart Electron (`Cmd+Q` and re-run) to pick up changes to the main or preload process.

To work against the canonical skills folder on disk (so your edits to `skills/<name>/` are immediately visible), set `SKILLS_BANK_ROOT=/path/to/skills-bank` in your shell. The app reads from there directly and silently sets persona = convenience.

To wipe local config + token between test runs:

```bash
pnpm run desktop:reset          # clears persona + auth token
pnpm run desktop:reset:hard     # also wipes the app-managed registry directory
```

### Local builds

```bash
pnpm run desktop:package:mac          # both arm64 + x64
pnpm run desktop:package:mac:arm64    # Apple Silicon only
pnpm run desktop:package:mac:x64      # Intel only
```

Output lands in `packages/desktop/dist-electron/`. Windows (`package:win`) exists but isn't tested.

### Cutting a release

Release builds run on tag push:

```bash
# bump packages/desktop/package.json version, commit, then:
git tag v0.3.0
git push origin v0.3.0
```

The `release` workflow builds both DMGs and uploads them to a **draft** GitHub Release. Review and publish the draft from the GitHub UI when you're ready for users to see it.

## CLI

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

## Authoring a registry skill

Drop a folder at `skills/<name>/` containing:

- `SKILL.md` — the skill prompt content. Optionally has YAML frontmatter (`name`, `description`).
- `meta.json` — metadata matching `docs/meta-schema.json`. Optional fields: `tags`, `version`, `author`.

Then validate and rebuild the index:

```bash
pnpm run validate
pnpm run build:index
```

The desktop app re-reads the registry from disk on every refresh, so changes appear immediately when running against `SKILLS_BANK_ROOT`.
