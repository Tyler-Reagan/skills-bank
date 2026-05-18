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
| `pnpm validate`     | After editing any `skills/<name>/SKILL.md` frontmatter or `docs/meta-schema.json`. CI runs this.                                                        |
| `pnpm build:index`  | After adding, removing, or editing skills — regenerates the root `index.json`. CI runs this.                                                            |
| `pnpm docs:check`   | After editing the README or any `docs/**.md`. Walks markdown and fails on unresolved links / images / anchors.                                          |
| `pnpm format:check` | CI parity. Run when you've made format-sensitive changes and want non-mutating verification.                                                            |
| `pnpm knip`         | After refactoring (renames, deletes, suspected dead code). Configuration in `knip.json`. Use the `fix-knip-unused-exports` skill to resolve violations. |
| `pnpm reset`        | Between manual test runs of LoginScreen / sync / RepoPicker flows. Wipes userData state (registry source choice + auth token) only.                     |
| `pnpm reset:hard`   | Full first-install simulation. Wipes userData + registry, auto-invokes `reset:seed`.                                                                    |
| `pnpm reset:seed`   | Repopulate `.skills-bank.json` source markers in this repo's `skills/`. Auto-invoked by `reset:hard`; runnable standalone after a fresh checkout.       |
| `pnpm backfill:bundled`  | Stamp upstream pointers into this repo's `skills/<name>/.skills-bank.json` from `scripts/bundled-upstream-mapping.json`. Run after adding new bundled skills with known GitHub upstreams. `--dry` previews without writing. |
| `pnpm backfill:deployed` | Stamp upstream pointers into a deployed registry by reading the local `~/.agents/.skill-lock.json`. Mostly redundant with the desktop's boot-time scanner; useful for scripted bootstraps. Resolves registry root via `--root`, `SKILLS_BANK_ROOT`, or cwd walk-up. |
| `pnpm discover:bundled`  | Discover authoritative upstreams for unstamped bundled skills via `npx skills find` + GitHub Trees probe. Writes a candidate JSON the maintainer reviews, then re-runs with `--apply <json>` to commit markers. Used by the `origin-paradigm-reframe` plan's Pass B backfill. |
| `pnpm stamp:self-authored` | Stamp self-referential upstream pointers (`repo = BUNDLED_REPO`) onto any bundled skill still missing an `upstream` field after `discover:bundled` runs. Dry by default; `--apply` writes; `--only foo,bar` scopes to a subset. Pass C of the `origin-paradigm-reframe` backfill. |
| `pnpm vendor:skill <owner/repo>@<id>` | Forward-vendoring: pull a skill folder from an upstream GitHub repo into `skills/vendored/<id>/` (default) or `skills/personal/<id>/` with `--personal`. Writes the `.skills-bank.json` marker (`source: "bundled"`) and baselines the drift hash. Supports `--path` (explicit SKILL.md path), `--as` (rename), `--force` (overwrite existing). Refuses cross-bucket name collisions. The canonical way to add a harvested skill to the bundled set. |

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
pnpm typecheck && pnpm validate && pnpm build:index && pnpm build
```

**After refactor that may leave dead code:**

```
pnpm knip
```

## Plans

Active body of work. Filenames are stable descriptive IDs; execution order is documented separately below so plans can be re-sequenced without renaming files.

| Plan                                                                              | Hard dependency                                           |
| --------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [`cli-minimal.md`](docs/plans/cli-minimal.md)                                     | none                                                      |
| [`github-mode-coherence.md`](docs/plans/github-mode-coherence.md)                 | none                                                      |
| [`github-first-onboarding.md`](docs/plans/github-first-onboarding.md)             | `github-mode-coherence` (groundwork)                      |
| [`per-skill-upstream-foundation.md`](docs/plans/per-skill-upstream-foundation.md) | none (cleaner if `github-first-onboarding` lands first)   |
| [`origin-paradigm-reframe.md`](docs/plans/origin-paradigm-reframe.md)             | `per-skill-upstream-foundation`                           |
| [`skills-directory-split.md`](docs/plans/skills-directory-split.md)               | `origin-paradigm-reframe`                                 |
| [`drift-update-ux-consistency.md`](docs/plans/drift-update-ux-consistency.md)     | `origin-paradigm-reframe` (cleaner if `skills-directory-split` lands first) |
| [`bank-mode-persistence.md`](docs/plans/bank-mode-persistence.md)                 | `origin-paradigm-reframe`                                 |
| [`in-app-install-from-discover.md`](docs/plans/in-app-install-from-discover.md)   | `origin-paradigm-reframe` + `bank-mode-persistence`       |

### Recommended execution order

To minimize thrashing (later plans rendering earlier plans' code obsolete), this is the canonical sequence:

1. **`github-mode-coherence`** — ground-truth polish for github-linked mode.
2. **`github-first-onboarding`** — collapses the local-vs-github mode discriminator. Doing this before the per-skill plans means they won't have to branch on a flag that's about to disappear.
3. **`per-skill-upstream-foundation`** — adds the per-skill upstream metadata + probe/update.
4. **`origin-paradigm-reframe`** — reframes Origin as authoritative upstream (not the bundled repo), reverts Tier 3, lands maintainer-time backfill + direct-fetch update flow.
5. **`skills-directory-split`** — spatial separation of `skills/` into `personal/` + `vendored/` subdirectories.
6. **`drift-update-ux-consistency`** — drawer button language/styling consistency under the canonical glossary, plus Registry-tab filter for pending updates.
7. **`bank-mode-persistence`** — adds the local snapshot cache.
8. **`in-app-install-from-discover`** — completes the discover-to-bank install loop.

`cli-minimal` is independent of the others and can slot anywhere — typically last since it's pure housekeeping.

When starting work on a plan, create a `feat/<plan-slug>` branch following the recent commit pattern in `git log`.

## Conventions specific to this repo

- **Pre-1.0; cut hard.** Don't add backwards-compatibility shims for schema changes, deprecation aliases, or "removed in vX" comments unless the user asks for them.
- **Persist multi-milestone plans before implementing.** Drop a `docs/plans/<slug>.md` first; one PR per plan; integrate rationale + conflict-audit inline rather than in side documents. Filenames are descriptive (no leading number); execution order is documented in the Plans section above.
- **CI logs: read past the headline error.** Scan `##[warning]` lines too; the visible error may already be fixed by a prior step.
- **Don't fabricate skill names or paths from training data.** Verify with `find` / `grep` before referring to a specific file.
