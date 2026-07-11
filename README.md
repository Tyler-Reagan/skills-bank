<div align="center">

<img src="packages/desktop/build/icon.svg" alt="Skills Bank logo" width="120" height="120">

# Skills Bank

One registry. Every AI agent on your machine.

[![Release](https://img.shields.io/github/v/release/Tyler-Reagan/skills-bank?color=22c55e&label=release)](https://github.com/Tyler-Reagan/skills-bank/releases)
[![License: MIT](https://img.shields.io/github/license/Tyler-Reagan/skills-bank?color=22c55e)](LICENSE)
![Platform: macOS](https://img.shields.io/badge/platform-macOS-22c55e)

</div>

<!-- SCREENSHOT NEEDED: The Registry tab — browse, search, and install skills. -->

A **skill** is a folder with a `SKILL.md` — instructions plus metadata in YAML frontmatter — that an AI coding agent reads at runtime to gain a specialized capability. Skills Bank keeps your collection in sync across Claude Code, Cursor, Gemini, GitHub Copilot, Continue, Cline, and Codex — using symlinks, so there are no copies and no drift. Skills are organized by a function-oriented category (code review, diagnostics, planning, and more) and freeform tags, both manually assigned and editable per-skill from the detail drawer.

## Skills Bank and `npx skills` (skills.sh)

Skills Bank is the **version-control / lifecycle layer over [`npx skills`](https://skills.sh)** — a complement at a different altitude, not a competing installer. The two compose vertically:

- **`npx skills` acquires.** It owns discovery, install, and the fan-out to 70+ agents — an install-time act. Skills Bank embeds skills.sh directly in its **Discover** tab as that acquire front-end, and the tab's terminal hand-off pre-fills the exact `npx skills add … --skill …` command when you want npx's universal-agent reach.
- **Skills Bank manages over time.** It owns the layer npx structurally lacks: **adopt → manifest → cross-machine sync → drift detection → lifecycle**. A skill you installed through npx surfaces in Discover with a one-click **Adopt** — moving it into the registry, repointing agent symlinks at Skills Bank's copy, and backfilling its origin so it travels to your other machines with no npx required.

Take npx away and Skills Bank still stands; take Skills Bank away and your npx skills lose their version-control layer. Neither wraps the other.

> [!NOTE]
> **Don't double-manage an adopted skill via npx.** Once you adopt a skill, Skills Bank owns updating it. Skills Bank reads npx's lockfile but never rewrites it — interop is one-way — so after adoption npx's entry for that skill goes stale, and running `npx skills update` on it won't reflect what Skills Bank tracks. Manage an adopted skill from Skills Bank, not npx.

## Get started

### Desktop app

Download the latest DMG from the [Releases page](https://github.com/Tyler-Reagan/skills-bank/releases):

- `Skills-Bank-<version>-arm64.dmg` — Apple Silicon
- `Skills-Bank-<version>-x64.dmg` — Intel

Drag to Applications, launch from Spotlight. Signed and notarized — Gatekeeper opens on a normal double-click. Auto-updates on launch.

**Uninstall:** run [`scripts/uninstall.sh`](scripts/uninstall.sh) from a clone (`--dry-run` to preview, `--keep-data` to keep your registry). It removes the app, its data/caches, and only the agent symlinks it created. See [Uninstalling Skills Bank](https://skills-bank-desktop.vercel.app/reference/troubleshooting#uninstalling-skills-bank).

> [!TIP]
> **📖 Read the docs: [skills-bank-desktop.vercel.app](https://skills-bank-desktop.vercel.app/)** — the source of truth for getting started, concepts, guides, and reference. The markdown sources live under [`packages/docs/`](packages/docs/) if you want to edit them.

## What's in this repo

| Path                                   | Purpose                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| [`skills/`](skills/)                   | Bundled registry — one folder per skill, each a `SKILL.md` with YAML frontmatter. |
| [`packages/core`](packages/core)       | Shared TypeScript library: registry IO, install, sync, registration.              |
| [`packages/desktop`](packages/desktop) | Electron + React desktop app.                                                     |
| [`packages/docs`](packages/docs)       | VitePress docs site.                                                              |

## Local development

```bash
pnpm install
pnpm dev      # watch renderer, launch Electron with devtools
pnpm start    # one-shot production build, then launch
```

> [!TIP]
> Set `SKILLS_BANK_ROOT=/path/to/skills-bank` to work against the cloned `skills/` folder directly.

```bash
pnpm docs:dev   # run the docs site locally
```

## Adding a registry skill

Drop a folder at `skills/<name>/` with a `SKILL.md` whose YAML frontmatter matches [`docs/skill-frontmatter-schema.json`](docs/skill-frontmatter-schema.json), then:

```bash
pnpm validate && pnpm build:index
```

## Cutting a release

Releases are tag-driven. Merge the feature PR, bump the version in all `package.json` files (`./`, `packages/core`, `packages/desktop`) and update `CHANGELOG.md`, then commit as `chore: release vX.Y.Z`, tag, and push `vX.Y.Z`. The [release workflow](.github/workflows/release.yml) builds signed + notarized DMGs and creates a draft; publish the draft from the GitHub UI to ship.

See [`CLAUDE.md`](CLAUDE.md) for the full release checklist and agent-facing scripts.
