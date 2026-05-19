# CLAUDE.md

Agent operating instructions for the `skills-bank` repo. Auto-loaded by Claude Code each session. Cross-referenced from [`AGENTS.md`](./AGENTS.md) for other tools.

## Repo orientation

Monorepo (pnpm workspaces):

- **`packages/core`** — pure TypeScript registry/install logic. Consumed by both desktop and CLI; no Electron, no DOM dependencies.
- **`packages/desktop`** — Electron app (main + renderer). The primary product.
- **`packages/cli`** — Node CLI. Small surface; the `cli-minimal` plan strips it further.
- **`skills/`** — bundled skill content. Two subdirectories: `personal/` for skills authored in this repo (self-referential upstream or `kind: "none"`); `vendored/` for skills harvested from external authors' repos. Names are globally unique across buckets; collisions throw at index-build time. The eventual `Tyler-Reagan/personal-skills` repo split extracts `skills/personal/` via `git subtree split`.
- **`docs/plans/`** — implementation plans. Filenames are descriptive (not numbered) so the IDs don't conflate with execution order; see the **Plans** section below for the canonical sequence.
- **`scripts/`** — maintenance + agent operations (validation, index build, reset, etc.).

The desktop app is the product. The CLI is a scripting surface, not a feature-parity peer.

## Scripts split

`package.json`'s `scripts` block has two conceptual groups, separated only by ordering convention (no in-file markers):

1. **User-facing** (first in the file): commands the user types during a normal dev session — `dev`, `start`, `build`, `format`, `package:mac`. The README scripts table lists these.
2. **Agent-facing** (after): operations the agent runs on the user's behalf around test, verification, and maintenance — everything from `typecheck` onward. The README intentionally omits these so the human-facing surface stays small; this file is the canonical catalog (below).

If you add a new script, place it in the appropriate group by ordering. If you add a user-facing one, also add it to the README scripts table.

### Agent-facing scripts — what to run, when

| Script              | When to invoke                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm typecheck`    | After any TypeScript change, before declaring work done. CI runs this.                                                                                  |
| `pnpm test`         | Runs the vitest suites under `packages/core`. Entry criteria live in `docs/adr/ADR-0001`. CI runs this.                                                 |
| `pnpm validate`     | After editing any `skills/<name>/SKILL.md` frontmatter or `docs/meta-schema.json`. CI runs this.                                                        |
| `pnpm build:index`  | After adding, removing, or editing skills — regenerates the root `index.json`. CI runs this.                                                            |
| `pnpm docs:check`   | After editing the README or any `docs/**.md`. Walks markdown and fails on unresolved links / images / anchors.                                          |
| `pnpm format:check` | CI parity. Run when you've made format-sensitive changes and want non-mutating verification.                                                            |
| `pnpm knip`         | After refactoring (renames, deletes, suspected dead code). Configuration in `knip.json`. Use the `fix-knip-unused-exports` skill to resolve violations. |
| `pnpm reset`        | Between manual test runs of LoginScreen / sync / RepoPicker flows. Wipes dev-mode userData state (registry source choice + auth token) only. The packaged install's userData is never a target — see "Dev-mode isolation" below.                     |
| `pnpm reset:hard`   | Full first-install simulation. Wipes dev-mode userData + registry, auto-invokes `reset:seed`.                                                                    |
| `pnpm reset:seed`   | Repopulate `.skills-bank.json` source markers in this repo's `skills/`. Auto-invoked by `reset:hard`; runnable standalone after a fresh checkout.       |
| `pnpm backfill:bundled`  | Stamp upstream pointers into this repo's `skills/<name>/.skills-bank.json` from `scripts/bundled-upstream-mapping.json`. Run after adding new bundled skills with known GitHub upstreams. `--dry` previews without writing. |
| `pnpm backfill:deployed` | Stamp upstream pointers into a deployed registry by reading the local `~/.agents/.skill-lock.json`. Mostly redundant with the desktop's boot-time scanner; useful for scripted bootstraps. Resolves registry root via `--root`, `SKILLS_BANK_ROOT`, or cwd walk-up. |
| `pnpm discover:bundled`  | Discover authoritative upstreams for unstamped bundled skills via `npx skills find` + GitHub Trees probe. Writes a candidate JSON the maintainer reviews, then re-runs with `--apply <json>` to commit markers. Apply-phase markers default to `source: "bundled"`; pass `--source yours` to override. Used by the `origin-paradigm-reframe` plan's Pass B backfill. |
| `pnpm stamp:self-authored` | Stamp self-referential upstream pointers (`repo = BUNDLED_REPO`) onto any bundled skill still missing an `upstream` field after `discover:bundled` runs. Dry by default; `--apply` writes; `--only foo,bar` scopes to a subset. New markers default to `source: "bundled"`; pass `--source yours` to override. Pass C of the `origin-paradigm-reframe` backfill. |
| `pnpm vendor:skill <owner/repo>@<id>` | Forward-vendoring: pull a skill folder from an upstream GitHub repo into `skills/vendored/<id>/` (default) or `skills/personal/<id>/` with `--personal`. Writes the `.skills-bank.json` marker (`source: "bundled"`) and baselines the drift hash. Supports `--path` (explicit SKILL.md path), `--as` (rename), `--force` (overwrite existing). Refuses cross-bucket name collisions. The canonical way to add a harvested skill to the bundled set. |
| `pnpm vendor:refresh` | Bulk refresh of vendored skills: walks `skills/vendored/*/.skills-bank.json`, probes each upstream's current folder hash, reports drift. Default is review-only. `--apply` re-mirrors drifted skills and re-baselines `skillFolderHash`; `--only foo,bar` scopes to a subset; `--json` machine-readable. Per-skill opt-out: add `"refresh": "manual"` to a vendored skill's `.skills-bank.json` to pin against bulk refresh. Missing/relocated upstreams surface as `missing` — never auto-deleted. |
| `pnpm publish:skill <name> --to <owner/repo>` | User-facing CLI: publish a locally-authored skill to a bank fork as a PR. Default source `~/.claude/skills/<name>/` (override with `--from`), default bucket `personal` (override with `--bucket vendored`), default branch `publish/<name>` (override with `--branch`). Schema-validates `meta.json` before pushing; refuses if the target repo already has the skill. `--dry` runs validation only. Requires authenticated `gh` and `git`. Counterpart to `vendor:skill`. |

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

Filenames are stable descriptive IDs; the contents of each plan file record the as-shipped state for completed plans and the open scope for remaining ones.

### Shipped through v1.0.0

| Plan                                                                              | Release  |
| --------------------------------------------------------------------------------- | -------- |
| [`github-mode-coherence.md`](docs/plans/github-mode-coherence.md)                 | v0.10.x  |
| [`github-first-onboarding.md`](docs/plans/github-first-onboarding.md)             | v0.10.x  |
| [`per-skill-upstream-foundation.md`](docs/plans/per-skill-upstream-foundation.md) | v0.11.2  |
| [`origin-paradigm-reframe.md`](docs/plans/origin-paradigm-reframe.md)             | v0.11.2  |
| [`skills-directory-split.md`](docs/plans/skills-directory-split.md)               | v0.11.3  |
| [`drift-update-ux-consistency.md`](docs/plans/drift-update-ux-consistency.md)     | v0.11.4  |
| [`a11y-polish.md`](docs/plans/a11y-polish.md)                                     | v0.11.5  |
| [`renderer-state-architecture.md`](docs/plans/renderer-state-architecture.md)     | v0.11.6 (M1+M2), v0.11.6 follow-up (M3 DrawerHost). M3's remaining host extractions (UpdateHost / ConflictHost / RegistryHost) deferred as low-priority cleanup. |
| [`core-test-foundation.md`](docs/plans/core-test-foundation.md)                   | v0.11.7  |
| [`security-hardening.md`](docs/plans/security-hardening.md)                       | v0.11.8  |
| [`core-architecture-refactor.md`](docs/plans/core-architecture-refactor.md)       | v0.11.9  |
| [`origin-rename-pass.md`](docs/plans/origin-rename-pass.md)                       | v0.11.10 (deferred: `SkillSource.upstream` JSON-field rename and the heal-action renames — see plan file) |

### Remaining

| Plan                                                                              | Hard dependency                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`bank-mode-persistence.md`](docs/plans/bank-mode-persistence.md)                 | none (post-v1.0)                                          |
| [`in-app-install-from-discover.md`](docs/plans/in-app-install-from-discover.md)   | `bank-mode-persistence`                                   |
| [`cli-minimal.md`](docs/plans/cli-minimal.md)                                     | none — housekeeping; anytime                              |

When starting work on a plan, create a `feat/<plan-slug>` branch following the recent commit pattern in `git log`.

## Conventions specific to this repo

- **Post-1.0; backcompat-conscious for public surfaces.** `packages/core` exports are now considered part of the SDK surface — when renaming or removing, ship a `@deprecated` re-export for one minor cycle (see the v0.11.10 aliases for the pattern) before cutting. JSON wire formats (`.skills-bank.json`) tolerate a legacy read for one minor cycle when their shape changes. Renderer-internal types and component props stay flexible. (Pre-v1.0 the convention was "cut hard"; v1.0.0 flips the public-surface treatment.)
- **Persist multi-milestone plans before implementing.** Drop a `docs/plans/<slug>.md` first; one PR per plan; integrate rationale + conflict-audit inline rather than in side documents. Filenames are descriptive (no leading number); execution order is documented in the Plans section above.
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

### Heal local maintainer state

After breaking changes to the `skills/` layout (e.g. the v0.11.3 directory split), the maintainer's host accumulates two kinds of local drift. Both are safe to heal without touching `src/`.

**Broken symlinks in `~/.claude/skills/` and `~/.cursor/skills/`** — links that targeted the pre-split flat path. Sweep + repoint:

```sh
for link in $(find ~/.claude/skills/ ~/.cursor/skills/ -maxdepth 1 -type l ! -exec test -e {} \; -print); do
  name=$(basename "$link")
  for bucket in personal vendored; do
    target="$(pwd)/skills/$bucket/$name"
    [ -d "$target" ] && ln -sfn "$target" "$link" && break
  done
done
```

Run from the repo root. Symlinks whose name no longer exists in either bucket are uninstalled skills — list them and leave them alone.

**Unstaged churn in `skills/**/.skills-bank.json` after running the app.** Diff vs `HEAD`: if `skillFolderHash` (or `installedAt`/`repo`/`skillPath`) changed, that's a legitimate baseline shift — commit. If only `fetchedAt` changed, it's runtime probe noise — `git restore` and capture details in `docs/bug-reports/` for the probe path to fix. For deleted `meta.json` files, run `pnpm validate` in both states: missing meta.json fails validation, so restore.
