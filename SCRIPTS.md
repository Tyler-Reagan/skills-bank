# Scripts inventory

A working map of every script the repo exposes. Originally written to drive a
consolidation pass; the [Consolidation log](#consolidation-log) at the bottom
records what was cut and what's still open.

Audience legend: **U** = user types it in a normal dev session · **A** = agent
runs it on the user's behalf (verify/maintenance) · **M** = maintainer-internal
(provenance, vendoring).

> CLAUDE.md carries the canonical agent-facing catalog ("Agent-facing scripts —
> what to run, when"). This file is broader: it also covers user-facing scripts,
> the underlying per-package targets, and the `scripts/` files that exist but are
> **not** wired into `package.json`.

---

## Root `package.json` scripts (15)

### Dev loop & build (U)

| Script  | Delegates to                          | Purpose                                                       |
| ------- | ------------------------------------- | ------------------------------------------------------------- |
| `dev`   | `--filter @skills-bank/desktop dev`   | Electron app in watch mode (devtools on, dev-state isolated). |
| `start` | `--filter @skills-bank/desktop start` | Full build then launch Electron once (no watch).              |
| `build` | `-r --if-present run build`           | Recursive build across all packages.                          |

> Packaging is no longer a script. The release workflow runs `electron-builder`
> directly (see [`release.yml`](.github/workflows/release.yml)); for a local
> build, run `pnpm run build` then `pnpm exec electron-builder --mac …` from
> `packages/desktop`.

### Docs (U)

| Script     | Delegates to                     | Purpose               |
| ---------- | -------------------------------- | --------------------- |
| `docs:dev` | `--filter @skills-bank/docs dev` | VitePress dev server. |

> Vercel builds the docs site via `pnpm --filter @skills-bank/docs build`
> (see [`packages/docs/vercel.json`](packages/docs/vercel.json)) — it calls the
> package script directly, so no root `docs:build`/`docs:preview` alias is
> needed. `docs:check` below is unrelated (a markdown link-checker).

### Quality gates (A)

| Script              | Delegates to                                         | Purpose                                                                                                    |
| ------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `typecheck`         | `-r --if-present run typecheck && typecheck:scripts` | Recursive `tsc --noEmit` across all packages, then `typecheck:scripts`. CI runs this.                      |
| `typecheck:scripts` | `tsc -p tsconfig.scripts.json`                       | Type-check `scripts/` in isolation (they run under `tsx` with no build step, so this is the only CI gate). |
| `test`              | `-r --if-present run test`                           | Recursive vitest (only `core` defines a suite today). CI runs this.                                        |
| `validate`          | `tsx scripts/validate-all.ts`                        | Validate `skills/*/SKILL.md` frontmatter against the frontmatter schema. CI.                               |
| `build:index`       | `tsx scripts/build-index.ts`                         | Regenerate root `index.json` from the skills tree. CI.                                                     |
| `docs:check`        | `node scripts/check-doc-links.mjs`                   | Walk markdown, fail on broken links/images/anchors.                                                        |
| `format`            | `prettier --write … --cache`                         | Format all source. (Always the final step in a change.)                                                    |
| `format:check`      | `prettier --check … --cache`                         | Non-mutating CI-parity format check.                                                                       |
| `knip`              | `knip`                                               | Unused-export / dead-code scan. Config in `knip.json`.                                                     |

### Dev-state reset (A)

| Script  | Delegates to                     | Purpose                                                                                                                                                                                                         |
| ------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `reset` | `tsx scripts/reset-dev-fresh.ts` | Restore the dev app (`pnpm dev`/`start`) to a first-install state: drop app-installed skills, revert runtime sidecars, wipe `~/.skills-bank-dev/`, seed an isolated managed registry. (Formerly `reset:fresh`.) |

### Skill provenance & vendoring (M)

One dispatcher (`pnpm bank <command>`, run bare for usage) over five
implementation modules. Each module is still individually runnable for
debugging via `tsx scripts/<module>.ts`.

| Command (`pnpm bank …`)    | Module                         | Purpose                                                                      |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------- |
| `vendor <owner/repo>@<id>` | `vendor-skill.ts`              | Pull an upstream skill folder into `skills/vendored/<id>/`.                  |
| `refresh`                  | `vendor-refresh.ts`            | Probe vendored skills for upstream drift; `--apply` re-mirrors.              |
| `backfill [--dry]`         | `backfill-bundled-upstream.ts` | Stamp upstream pointers from `scripts/bundled-upstream-mapping.json`.        |
| `discover`                 | `discover-bundled-upstream.ts` | Auto-discover upstreams for unstamped skills (`skills find` + GitHub probe). |
| `update <name>`            | `update-skill.ts`              | Pull a locally-edited skill from `~/.claude/skills/<name>/` back into repo.  |

---

## Underlying per-package targets

Root scripts mostly fan out to these.

**`packages/core`**

- `build` — `tsc -p tsconfig.json`
- `typecheck` — `tsc -p tsconfig.json --noEmit`
- `test` — `vitest run`
- `test:watch` — `vitest` (no root alias)

**`packages/desktop`**

- `build:renderer` — `vite build`
- `build:preload` — `esbuild … preload.mts → preload.cjs`
- `build:main` — `tsc -b tsconfig.main.json && build:preload`
- `build` — `build:main && build:renderer`
- `dev` — build:main + `vite build --watch` + electron (devtools)
- `start` — `build && electron .`
- `typecheck` — `tsc -b tsconfig.main.json && tsc -p tsconfig.json --noEmit`
- `icons` — `bash scripts/build-icons.sh` (no root alias)

> The `package:*` scripts were removed — release packaging is done by the
> workflow's direct `electron-builder` call, not a script.

**`packages/docs`**

- `dev` — VitePress dev (root alias `docs:dev`).
- `build` — VitePress build (invoked directly by Vercel).
- `preview` — VitePress preview (no root alias).

> `packages/cli` was removed — it held only stale build artifacts after the
> CLI-minimal cleanup deleted its source.

---

## `scripts/` files NOT wired into `package.json`

| File           | Invoked as               | Purpose                                                                                                     |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `uninstall.sh` | `./scripts/uninstall.sh` | Full macOS uninstaller: app bundle, managed registry/userData, caches, and only Skills-Bank-owned symlinks. |

Other non-script assets in `scripts/`: `bundled-upstream-mapping.json` (data for
`bank backfill`), `check-doc-links.mjs` / `validate-all.ts` / `build-index.ts`
(wired), `build-icons.sh` (called by desktop `icons`).

---

## Consolidation log

### Applied

- **Reset sprawl collapsed.** Removed `reset` (old), `reset:hard`, `reset:seed`,
  and the bash `skills-bank-full-reset` / `skills-bank-partial-reset`. Renamed
  `reset:fresh` → `reset` as the single dev-state reset. Deleted the orphaned
  `reset-desktop-config.ts` and `seed-source-markers.ts`. `uninstall.sh` left
  untouched.
- **`backfill-deployed-upstream.ts` deleted** — orphaned and self-described as
  redundant with the runtime scanner.
- **`docs:*` trimmed to `docs:dev`** — dropped `docs:build` / `docs:preview`
  root aliases (Vercel calls the package script directly; preview was unused).
  `docs:check` kept (separate link-checker, actively used).
- **`package:*` removed** — root `package:mac` plus desktop `package:mac`,
  `package:mac:arm64`, `package:mac:x64`, `package:win`. CI packages via a
  direct `electron-builder` invocation, so the scripts were dead surface.
- **Provenance cluster collapsed to `pnpm bank <command>`.** The five
  `backfill:bundled` / `discover:bundled` / `vendor:skill` / `vendor:refresh` /
  `update:skill` root scripts became one `bank` dispatcher
  ([`scripts/bank.ts`](scripts/bank.ts)) over the same five implementation
  modules. The `vendor-refresh.yml` workflow now calls `pnpm bank refresh`.
- **`packages/cli` removed** — held only stale build artifacts (no tracked
  source) after the CLI-minimal cleanup.

### Remaining (open)

- None tracked. Re-derive from the current `scripts` blocks if scope reopens.

---

_Last reviewed against `package.json` v1.24.0. Re-derive from the `scripts`
blocks (root + `packages/*`) and `scripts/` dir listing when this drifts._
