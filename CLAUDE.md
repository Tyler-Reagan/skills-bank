# CLAUDE.md

Agent operating instructions for the `skills-bank` repo. Auto-loaded by Claude Code each session. Cross-referenced from [`AGENTS.md`](./AGENTS.md) for other tools.

## Repo orientation

Monorepo (pnpm workspaces):

- **`packages/core`** — pure TypeScript registry/install logic. No Electron, no DOM dependencies.
- **`packages/desktop`** — Electron app (main + renderer). The primary product.
- **`skills/`** — bundled skill content. Houses the **Curated set** the app ships under `skills/vendored/<name>/`. The post-Phase-1 (v1.1) Curated set is intentionally minimal — just `find-skills` — see the [CHANGELOG](./CHANGELOG.md) v1.2.0 entry. The bucket layout (`skills/{personal,vendored}/<name>/`) is universal across registries, but the curation layer uses only `vendored/` by composition: the maintainer's authored skills live in their own origin repo, `Tyler-Reagan/skills` (extracted from the former `skills/personal/` via `git subtree split` in v1.1). The maintainer's end-user flow links `Tyler-Reagan/skills` as their registry from Account → Sign in with GitHub.
- **`scripts/`** — maintenance + agent operations (validation, index build, reset, etc.).

The desktop app is the product.

## Scripts split

`package.json`'s `scripts` block has two conceptual groups, separated only by ordering convention (no in-file markers):

1. **User-facing** (first in the file): commands the user types during a normal dev session — `dev`, `start`, `build`, `format`, `docs:dev`. The README documents these. (Packaging is no longer a script: the release workflow invokes `electron-builder` directly — see [`release.yml`](.github/workflows/release.yml).)
2. **Agent-facing** (after): operations the agent runs on the user's behalf around test, verification, and maintenance — everything from `typecheck` onward. The README intentionally omits these so the human-facing surface stays small; this file is the canonical catalog (below).

If you add a new script, place it in the appropriate group by ordering. If you add a user-facing one, also add it to the README scripts table.

### Agent-facing scripts — what to run, when

| Script                | When to invoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm typecheck`      | After any TypeScript change, before declaring work done. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `pnpm test`           | Runs the vitest suites under `packages/core`. Entry criteria live in `docs/adr/ADR-0001`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm validate`       | After editing any `skills/<name>/SKILL.md` frontmatter or `docs/skill-frontmatter-schema.json`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `pnpm build:index`    | After adding, removing, or editing skills — regenerates the root `index.json`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm docs:check`     | After editing the README or any `docs/**.md`. Walks markdown and fails on unresolved links / images / anchors.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `pnpm format:check`   | CI parity. Run when you've made format-sensitive changes and want non-mutating verification.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `pnpm knip`           | After refactoring (renames, deletes, suspected dead code). Configuration in `knip.json`. Use the `fix-knip-unused-exports` skill to resolve violations.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `pnpm reset`          | Packaged-first-install simulation for `pnpm dev`/`pnpm start`. Cleans untracked app-installed skills, reverts runtime-modified sidecars, wipes `~/.skills-bank-dev/`, seeds an isolated managed registry with the committed curated skills, and pre-writes `config.json`. On next boot the app shows find-skills with no conflicts; the boot-time sync stamps `syncedFromCommit` silently. (Formerly `reset:fresh`; the older `reset`/`reset:hard`/`reset:seed` variants were removed.)                                                                                                                                                                                                                      |
| `pnpm bank <command>` | Provenance & vendoring multitool (run `pnpm bank` for usage). Subcommands: `vendor <owner/repo>@<id>` (forward-vendor a skill into `skills/vendored/<id>/`; `--path`, `--as`, `--force`, `--personal`); `refresh` (bulk-refresh vendored skills vs upstream; `--apply`, `--only foo,bar`, `--json`; per-skill opt-out `"refresh": "manual"` in `.skills-bank.json`); `backfill [--dry]` (stamp upstreams from `scripts/bundled-upstream-mapping.json`); `discover` (auto-discover upstreams via `npx skills find` + GitHub probe; `--out`/`--apply <json>`); `update <name>` (pull a locally-edited `~/.claude/skills/<name>/` back into the repo; `--bucket personal\|vendored`, `--dry`; does NOT commit). |

### Common sequences

**After editing any skill metadata or content:**

```
pnpm validate && pnpm build:index
```

**Before declaring main-process work done.** `typecheck` and `build` don't catch ESM/CJS runtime errors; `start` does:

```
pnpm typecheck && pnpm start
```

The user is often running the app for manual verification. **Never blanket-pkill Electron processes** — only kill ones you spawned yourself.

**CI-equivalent pre-PR check:**

```
pnpm typecheck && pnpm test && pnpm validate && pnpm build:index && pnpm build
```

**After refactor that may leave dead code:**

```
pnpm knip
```

## Plans

The historical record of shipped work lives in [`CHANGELOG.md`](./CHANGELOG.md). The `docs/plans/` directory (one markdown file per planned milestone) was retired in v1.6 once every plan through Phase 5 + the CLI-minimal cleanup had shipped — the implementation drafts had become parallel-but-stale to the CHANGELOG entries they fed into.

For new multi-milestone work: drop a focused plan doc directly into a feature branch's commit message or PR description, or — if it warrants a permanent record — capture the design as an [ADR](./docs/adr/). Branch naming convention is `feat/<plan-slug>` for new feature work, `fix/<bug-slug>` for fixes, following recent commits in `git log`.

## Conventions specific to this repo

- **Post-1.0; backcompat-conscious for public surfaces.** `packages/core` exports are now considered part of the SDK surface — when renaming or removing, ship a `@deprecated` re-export for one minor cycle (see the v0.11.10 aliases for the pattern) before cutting. JSON wire formats (`.skills-bank.json`) tolerate a legacy read for one minor cycle when their shape changes. Renderer-internal types and component props stay flexible. (Pre-v1.0 the convention was "cut hard"; v1.0.0 flips the public-surface treatment.)
- **Source axis values are `curated` / `user` / `vendored`** (legacy `bundled` / `yours` still tolerated on read in `packages/core/src/source.ts`; writes always emit the new form). The `.skills-bank.json` field `origin` replaces `upstream` under the same tolerant-read window. Semantics: `"curated"` = committed to the repo by the maintainer (only `find-skills` by default, never set by any runtime install or sync path); `"user"` = from the user's own linked GitHub registry repo; `"vendored"` = user-chosen third-party install via Discover tab or Settings → Install from GitHub. GitHub linking moves to Settings → Account.
- **Registry manifest is v4** (see `packages/core/src/manifest.ts`). Each `ManifestSkill` carries an explicit `bucket: "personal" | "vendored"` decoupled from the source axis. Legacy v2/v3 manifests coerce up through `coerceManifestToCurrent` — single quarantined chokepoint, no version branches downstream. v1 manifests are no longer readable. The **committed** form is written by `serializeManifest` (sorted, stable keys, trailing newline) and deliberately omits the volatile/local fields `exportedAt` and `lastInstalledOn` — those survive only in the full-fidelity disk export and rolling snapshots. Pull from a linked repo is an **in-app 3-way merge** (`mergeManifests(base, ours, theirs)` in `manifest-merge.ts`, base = `readMergeBase`), not an additive import; conflicts surface in `ManifestConflictModal`. Direct push is guarded against non-fast-forward (refuses to clobber a diverged remote — see ADR-0009).
- **Capture multi-milestone designs in the PR description or as an ADR.** `docs/plans/` was retired in v1.6 (every plan had shipped and was already in the CHANGELOG). For new work, design rationale lives in the feature branch's PR description; if it warrants permanent reference, promote it to an [ADR](./docs/adr/). One PR per cohesive scope; integrate rationale + conflict-audit inline rather than in side documents.
- **CI logs: read past the headline error.** Scan `##[warning]` lines too; the visible error may already be fixed by a prior step.
- **Don't fabricate skill names or paths from training data.** Verify with `find` / `grep` before referring to a specific file.

### Dev-mode isolation

Unpackaged runs (`pnpm dev` / `pnpm start`) auto-redirect every persistent side effect into `~/.skills-bank-dev/`:

- **userData** → `~/.skills-bank-dev/userData/` (registry source choice, auth token)
- **Skill sinks** → `~/.skills-bank-dev/.claude/skills/`, `~/.skills-bank-dev/.cursor/skills/`, etc. (via `SKILLS_BANK_HOME_OVERRIDE`, read by `getAgentSkillsDir` in `packages/core/src/agents.ts`)
- **App label** → "Skills Bank (Dev)" in dock/menu

The packaged install reads `~/.claude/skills/`, `~/.cursor/skills/`, and `~/Library/Application Support/Skills Bank/` as usual — dev runs cannot reach those paths. The redirect is gated on `!app.isPackaged` at the top of `packages/desktop/src/main/main.ts`.

Consequence: skills "installed" via dev are not visible to your real Claude Code / Cursor clients. End-to-end installation testing requires the packaged app pointed at a deployed registry.

`rm -rf ~/.skills-bank-dev/` is the one-line full dev-state reset.
