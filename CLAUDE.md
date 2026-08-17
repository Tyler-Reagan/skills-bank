# CLAUDE.md

Agent operating instructions for the `skills-bank` repo. Auto-loaded by Claude Code each session.

## Repo orientation

Monorepo (pnpm workspaces):

- **`packages/core`** — pure TypeScript registry/install logic. No Electron, no DOM dependencies.
- **`packages/desktop`** — Electron app (main + renderer). The primary product.
- **`skills/`** — the bucket layout (`skills/{personal,vendored}/<name>/`) is universal across registries, but as of the origin-only provenance model (ADR-0020/0021, issue #159) this repo's own `skills/` tree carries none — the curated/bundled concept was retired entirely (the former sole entry, `find-skills`, was deleted). The maintainer's authored skills live in their own separate repo, `Tyler-Reagan/skills`, which the maintainer links as their registry from Account → Sign in with GitHub. `skills/personal/` is gitignored dev-install scratch space, not committed content.
- **`scripts/`** — maintenance + agent operations (validation, index build, reset, etc.).

The desktop app is the product.

## Scripts split

`package.json`'s `scripts` block has two conceptual groups, separated only by ordering convention (no in-file markers):

1. **User-facing** (first in the file): commands the user types during a normal dev session — `dev`, `start`, `build`, `format`, `docs:dev`. The README documents these. (Packaging is no longer a script: the release workflow invokes `electron-builder` directly — see [`release.yml`](.github/workflows/release.yml).)
2. **Agent-facing** (after): operations the agent runs on the user's behalf around test, verification, and maintenance — everything from `typecheck` onward. The README intentionally omits these so the human-facing surface stays small; this file is the canonical catalog (below).

If you add a new script, place it in the appropriate group by ordering. If you add a user-facing one, also add it to the README scripts table.

### Agent-facing scripts — what to run, when

| Script                | When to invoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`      | After any TypeScript change, before declaring work done. Covers all three packages **and** `scripts/` (via `typecheck:scripts` → `tsconfig.scripts.json`) — `scripts/` runs under `tsx` (no type-checking) so this is the only thing that catches it drifting from the core API. CI runs this.                                                                                                                                                                                                                            |
| `pnpm test`           | Runs the vitest suites under `packages/core`. Entry criteria live in `docs/adr/ADR-0001`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm validate`       | After editing any `skills/<name>/SKILL.md` frontmatter or `docs/skill-frontmatter-schema.json`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `pnpm build:index`    | After adding, removing, or editing skills — regenerates the root `index.json`. CI runs this.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm docs:check`     | After editing the README or any `docs/**.md`. Walks markdown and fails on unresolved links / images / anchors.                                                                                                                                                                                                                                                                                                                                                                                                            |
| `pnpm format:check`   | CI parity. Run when you've made format-sensitive changes and want non-mutating verification.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `pnpm knip`           | After refactoring (renames, deletes, suspected dead code). Configuration in `knip.json`. Use the `fix-knip-unused-exports` skill to resolve violations.                                                                                                                                                                                                                                                                                                                                                                   |
| `pnpm reset`          | Packaged-first-install simulation for `pnpm dev`/`pnpm start`. Cleans untracked app-installed skills, reverts locally-modified files under `skills/`, wipes `~/.skills-bank-dev/`, creates a blank isolated managed registry (empty `skills/` + index), and pre-writes `config.json`. On next boot the app shows an empty registry — no curated seed anymore (ADR-0020/0021 retired the whole curated/tarball-sync channel). (Formerly `reset:fresh`; the older `reset`/`reset:hard`/`reset:seed` variants were removed.) |
| `pnpm bank <command>` | Provenance multitool (run `pnpm bank` for usage). Subcommands: `update <name>` (pull a locally-edited `~/.claude/skills/<name>/` back into the repo; `--bucket personal\|vendored`, `--dry`; does NOT commit). The former `vendor`/`refresh`/`backfill`/`discover` subcommands maintained the curated `skills/vendored/` bucket via per-skill sidecars — retired with the origin-only provenance model (ADR-0020/0021, issue #159); that bucket is deliberately empty going forward.                                      |

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
pnpm format:check && pnpm typecheck && pnpm test && pnpm validate && pnpm build:index && pnpm build
```

**After refactor that may leave dead code:**

```
pnpm knip
```

## Plans

The historical record of shipped work lives in [`CHANGELOG.md`](./CHANGELOG.md). The `docs/plans/` directory (one markdown file per planned milestone) was retired in v1.6 once every plan through Phase 5 + the CLI-minimal cleanup had shipped — the implementation drafts had become parallel-but-stale to the CHANGELOG entries they fed into.

For new multi-milestone work: drop a focused plan doc directly into a feature branch's commit message or PR description, or — if it warrants a permanent record — capture the design as an [ADR](./docs/adr/). Branch naming convention is `feat/<plan-slug>` for new feature work, `fix/<bug-slug>` for fixes, following recent commits in `git log`.

## Conventions specific to this repo

### Public surface

- **Post-1.0; backcompat-conscious for public surfaces.** `packages/core` exports are now considered part of the SDK surface — when renaming or removing, ship a `@deprecated` re-export for one minor cycle (see the v0.11.10 aliases for the pattern) before cutting. JSON wire formats (`.skills-bank.json`) tolerate a legacy read for one minor cycle when their shape changes. Renderer-internal types and component props stay flexible. (Pre-v1.0 the convention was "cut hard"; v1.0.0 flips the public-surface treatment.)

### Core / renderer import boundary

The renderer runs in Chromium — no Node.js APIs. `@skills-bank/core`'s root barrel re-exports all five domains, many of which import `node:fs`, `node:path`, or `node:child_process`. Renderer imports from the root barrel are safe **only when they are type-only** (`import type {…}`) — TypeScript erases these before Vite bundles the renderer. Runtime values must come from named subpath exports that Vite can safely include in the browser bundle.

Current renderer-safe subpaths (`packages/core/package.json`):

| Subpath                         | Source file             | What it provides                                   |
| ------------------------------- | ----------------------- | -------------------------------------------------- |
| `@skills-bank/core/skill-state` | `shared/skill-state.ts` | `classifyDrawerState`, `DrawerStateClassification` |
| `@skills-bank/core/agents-data` | `shared/agents-data.ts` | Agent ID constants used by `agentDisplay.ts`       |
| `@skills-bank/core/labels`      | `registry/labels.ts`    | Label types and pure helpers                       |

**Rule:** `import type {…} from "@skills-bank/core"` is always safe in the renderer. A runtime value import (constant, function) must go through a subpath — add or extend a `packages/core/package.json` entry rather than using the root barrel. If a module's source file has no Node.js imports it can be added as a subpath directly; otherwise extract the renderer-safe portion into a `shared/` sibling first.

### Data model

- **Provenance is a single nullable-URL origin** (ADR-0018/0020, issue #159) — there is no more `source` axis (`curated`/`user`/`vendored`), no more `canon`/`hidden` (bundled-skill) concept, and no per-skill sidecar files. Every skill's provenance lives in one place: its `registry-manifest.json` row, `origin: {url: string | null, skillPath?, hash?}`. `url` pointing at the registry's own linked repo is a self-origin (authored here); any other `url` is an external upstream; `url: null` is an explicit "local skill, no remote" stamp — a valid resting state, not an error. GitHub-capability is a call-site check (`isGithubUrl(url)` / `parseOwnerRepo(url)` in `packages/core/src/github/url.ts`), never a stored axis. The manual origin picker (Settings → set-manual-upstream) is the `null` → `url` escape.
- **The registry manifest is the maintained live record, not a disk-walk** (ADR-0020/0021). Manifest schema is v6 (see `packages/core/src/manifest/manifest.ts`): `ManifestSkill = {name, origin, category, tags}`, top-level `{schemaVersion: 6, skills}`. No legacy coercion — `coerceManifestToCurrent` rejects anything without `schemaVersion: 6` (single-user, no backcompat window for this file). `reconcileFoldersToManifest` (`packages/core/src/registry/reconcile-folders.ts`) is the **sole manifest-write seam**, called at boot and from the `snapshotAfterMutation` seam — it adds `origin: {url: null}` rows for orphan folders (hand-copied content, from-scratch authoring) and refreshes labels; it never invents a true origin. `buildRegistryIndex` stays a pure read that joins folders + the live manifest + the runtime map, synthesizing in-memory `url: null` rows for orphans without persisting. Two projections of one document: the **live** record at the registry root carries everything including `url: null` rows; the **pushed** form (`toPushedProjection`, applied by `serializeManifest`) filters those out before push/diff/merge/merge-base/the removal basis — so a `url: null` skill is structurally immune to being read as "deleted upstream" by a pull. Volatile per-skill state (`syncedHash`, `fetchedAt`, `probeFailureCount`, `lastProbeFailureAt`) lives in one gitignored file, `<root>/.skills-bank/runtime.json`, keyed by name (`packages/core/src/registry/runtime-map.ts`) — no more per-skill runtime sidecars. Pull from a linked repo is an **in-app 3-way merge** (`mergeManifests(base, ours, theirs)` in `manifest/merge.ts`, base = `readMergeBase`), not an additive import; conflicts surface in `ManifestConflictModal`. Direct push is guarded against non-fast-forward (refuses to clobber a diverged remote — see ADR-0009).

### Desktop main-process architecture

`packages/desktop/src/main/` is split into 10 focused files after the v1.23.0 refactor:

| File                   | Role                                                                                                                       |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `main.ts` (284L)       | Boot + app lifecycle only. Calls `register*Handlers()` for each domain; calls `initProbeRunner()`.                         |
| `main-state.ts` (329L) | Shared mutable singleton — getter/setter exports for all runtime state, AppConfig I/O, labels helpers, `mutatingHandle()`. |
| `ipc-auth.ts`          | GitHub Device Flow handlers.                                                                                               |
| `ipc-github.ts`        | Origin-probe + repo-metadata handlers; module-level per-root caches.                                                       |
| `ipc-labels.ts`        | Labels CRUD (4 handlers).                                                                                                  |
| `ipc-manifest.ts`      | Manifest sync, import, export, reconcile. Exports `runSync` (called on boot).                                              |
| `ipc-metrics.ts`       | Metrics/tracking handlers (no shared state).                                                                               |
| `ipc-registry.ts`      | 35+ skill/registry management handlers (largest domain file).                                                              |
| `ipc-repos.ts`         | Repo listing + registry-replace; exports `replaceRegistryWithRepo`.                                                        |
| `ipc-shell.ts`         | Discover WebContentsView, auto-updater, app menu, window lifecycle.                                                        |

Circular-import prevention: `ipc-repos.ts` exports `replaceRegistryWithRepo`; `ipc-manifest.ts` receives it via a `setReplaceRegistryWithRepo` setter injected from `main.ts`. See [`packages/desktop/src/main/INVENTORY.md`](packages/desktop/src/main/INVENTORY.md) for the full per-handler breakdown.

### Development workflow

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

**Deliberate exception — skill-usage metrics.** The metrics feature (`skill-tracking.ts`, core `metrics/`) operates on **real** paths regardless of `app.isPackaged` — the invocation log + hook script at `~/.skills-bank/` and the hook entry in real `~/.claude/settings.json` — because the `PreToolUse` hook fires from the user's one real Claude Code. `getMetricsDir()` intentionally ignores `SKILLS_BANK_HOME_OVERRIDE`. Safe because enabled-state is file-derived, the entry is clearly marked, and it's reversible from any build.

**Isolation seam — `shared/home.ts`.** Two functions capture the isolation intent explicitly: `getIsolatedHome()` (returns `SKILLS_BANK_HOME_OVERRIDE ?? os.homedir()`, used everywhere that should redirect in dev) and `getRealHome()` (always `os.homedir()`, used only for intentional real-path carveouts: metrics, Claude settings, and the CLI lock file). Prefer these over `os.homedir()` directly so carveout intent is visible at the call site.

`rm -rf ~/.skills-bank-dev/` is the one-line full dev-state reset.

## Agent skills

### Issue tracker

GitHub Issues on `Tyler-Reagan/skills-bank`. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles, matching label names. See `docs/agents/triage-labels.md`.

### Domain docs

Multi-context. See `docs/agents/domain.md` and `CONTEXT-MAP.md`.
