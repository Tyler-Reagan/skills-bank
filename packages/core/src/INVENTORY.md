# Core inventory

Reference inventory of everything under `packages/core/src/`: what each
module does, who consumes it, and the conventions that govern the package.
Repo-internal — not published to the docs site.

> **Freshness: accurate as of branch `refactor/core-consolidation`
> (2026-06-09) — the post-reorg consolidation pass (map below).**
> LOC and consumer columns are snapshots; re-verify (`wc -l`, grep the
> import graph) and re-stamp when the package changes materially — or
> distrust the numbers and trust only the purposes, which drift slower.

## v1.21 consolidation map

The post-reorg consolidation pass (branch `refactor/core-consolidation`).
Each move is barrel-neutral except the deprecation cuts, whose one-minor
window (stamped v1.20.3) elapses at the next minor:

| Action     | From                                                                                                                                                                                                                    | To                   | Why                                                                                                |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------- |
| **cut**    | 8 deprecated exports: `previewDeleteUnregistered` (+`DeletePreview`), `groupDiagnosticsByCategory`, `getClaudeHome`, `getClaudeSkillsDir`, `loadIndex`, `readSkillRecord`, `writeSkillRecord`, `readSkillMdFrontmatter` | —                    | Zero callers repo-wide (core, desktop, scripts, tests); deprecation window elapsed                 |
| **delete** | `registry/record.ts`                                                                                                                                                                                                    | —                    | Facade nobody adopted; its live re-exports already flow through `source.ts`/`heal.ts` barrel lines |
| **merge**  | `registry/hide.ts`                                                                                                                                                                                                      | `registry/canon.ts`  | Hidden set is canon-coupled (canon skills' Dismiss); same state-dir JSON-set persistence shape     |
| **fold**   | `manifest/reconcile.ts`                                                                                                                                                                                                 | `manifest/import.ts` | 67-line orchestration shell over its only dependency; one story, one file                          |
| **move**   | `shared/skill-state-server.ts`                                                                                                                                                                                          | `skills/classify.ts` | Removes the only upward import in `shared/` (it pulls `registry/build` + `skills/installed`)       |

Deliberately **not** consolidated: `agents.ts`/`agents-data.ts` (renderer-safe
subpath split is load-bearing), `delete.ts`→`unregister.ts` (documented
destructive-ladder stages), `registry/external.ts` (cycle-breaker with five
importers), `manifest/diff.ts` (merge depends on diff, not vice versa),
`github/repos.ts`→`http.ts` (keeps the shared client dependency-free).

`core/src/` is organized into **five concept directories**, each scoped to one
domain's operations. The only top-level files are `index.ts` (the barrel) and
this doc — see [Why only two files sit at the root](#why-only-two-files-sit-at-the-root).
Tables below are grouped by directory, then sorted by file name. Tests are
colocated (`*.test.ts`); entry criteria live in ADR-0001.

## Conventions

- **SDK surface.** Everything `index.ts` re-exports is public (post-1.0):
  renaming or removing an export ships a `@deprecated` alias for one minor
  cycle before cutting. JSON wire formats (`.skills-bank.json`) tolerate a
  legacy read for one minor cycle on shape changes.
- **Domain boundaries.** A file lives in the domain dir of the operation it
  implements. A domain-specialized op lives in its own domain and imports the
  generic primitive — e.g. `manifest/manifest.ts#fetchRemoteManifest` imports
  `github/files.ts#readRepoFile` rather than living in `github/`. Cross-domain
  imports are expected; a genuine primitive is defined once and imported, never
  re-implemented. Dependency direction: `shared` ← `github`/`registry` ←
  `skills`/`manifest` (no cycles; `shared/conflict.ts` is shared by
  `registry/sync` + `manifest/` so it lives in `shared`).
- **Renderer-safe subpaths.** The Vite renderer cannot import the main barrel
  (it transitively pulls `node:child_process` via `registry/build.ts`).
  Renderer-safe modules are exposed as subpath exports — `@skills-bank/core/agents-data`
  (→ `shared/agents-data`), `/skill-state` (→ `shared/skill-state`), `/labels`
  (→ `registry/labels`) — and must stay free of `fs`/`os`/`path`-at-module-scope
  side effects. The import specifiers are stable; only the `dist/` targets moved
  with the reorg.
- **Sidecar trio (ADR-0002).** Per-skill on-disk state lives in three sidecars,
  each owned by the module adjacent to its logic, all under `registry/`:
  `.skills-bank.json` (source axis + origin pointer — `source.ts`),
  `.skills-bank-hash` (synced content baseline — `heal.ts`),
  `.skills-bank-runtime.json` (probe state — `heal.ts`). (The `record.ts`
  unified facade was deleted in the v1.21 consolidation — nobody adopted it;
  callers import the per-axis helpers directly.)
- **Source axis** is `curated` / `user` / `vendored`; legacy `bundled`/`yours`
  and `upstream`→`origin` are tolerated on read only.
- **Manifest schema is v5**; v2–v4 coerce up through the single
  `coerceManifestToCurrent` chokepoint in `manifest/manifest.ts`; v1 unreadable.
- **Frontmatter parsing** has exactly one parser:
  `registry/frontmatter.ts#parseSkillFrontmatter`.

## `shared/` — foundation (imported by every other domain)

| File             | LOC | Purpose                                                                                       | Consumed by                                                | Tests |
| ---------------- | --- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ----- |
| `agents-data.ts` | 50  | Renderer-safe agent metadata: `AGENTS` list, `AgentDef`/`AgentId`, `getAgent`                 | `agents` / renderer via `/agents-data`                     | —     |
| `agents.ts`      | 40  | Node-side agent helpers: skills-dir resolution, existing-agents scan, default install targets | skills/\_, manifest, registry / desktop main               | —     |
| `conflict.ts`    | 82  | Shared conflict-decision disk primitive (rename/delete/no-op) + `-local` rename-target picker | registry/sync, manifest/disk-import / —                    | —     |
| `diff.ts`        | 170 | Per-file folder diff (size-capped, binary-skipping, sidecar-aware) for the DiffViewer         | — / desktop main                                           | —     |
| `errors.ts`      | 77  | Structured `AppError` (code, copyable details, suggested actions) + `fromCaught`              | skills/unregister / desktop main + renderer                | —     |
| `paths.ts`       | 46  | Registry-root resolution (cwd walk-up) + `getStateDir`                                        | registry/\_, manifest/merge, github/probe / desktop main   | ✓     |
| `skill-lock.ts`  | 199 | Read the `npx skills` CLI lock + stamp GitHub origins onto CLI-installed skills               | — / desktop main                                           | —     |
| `skill-state.ts` | 523 | Pure drawer-state classifier: installation partition → state + capability fan-out             | registry/build, github/probe / renderer via `/skill-state` | ✓     |
| `types.ts`       | 227 | Shared shapes: `RegistryEntry`, `RegistryIndex`, `SkillMeta`, warnings                        | ~10 modules / desktop, renderer                            | —     |

## `github/` — GitHub transport + upstream attribution

| File        | LOC | Purpose                                                                                                         | Consumed by                                    | Tests |
| ----------- | --- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ----- |
| `http.ts`   | 105 | Shared GitHub REST client + rate-limit normalization (`ghFetch`, `GH_API`, `RateLimitInfo`)                     | files, repos, origin, probe, push, manifest    | —     |
| `files.ts`  | 214 | GitHub Contents API primitives: read / write / write-as-branch                                                  | manifest / desktop (manifest repo transport)   | —     |
| `repos.ts`  | 67  | Repo-metadata ops: `fetchUserRepos` (link picker), `fetchRepoDefaultBranch` (split out of `http`)               | — / desktop main                               | —     |
| `origin.ts` | 525 | Origin primitives: tree probe, `installSkillFiles` mirror (idempotent), `applyOriginUpdate`                     | manifest/import, probe / desktop main, scripts | ✓     |
| `probe.ts`  | 408 | Stateful origin-probe runner: scheduled upstream fetches, per-repo cache + TTL, update flagging                 | — / desktop main                               | ✓     |
| `push.ts`   | 451 | Push a skill folder to the linked repo as a PR — six-step atomic commit (ADR-0007); distinct from manifest push | — / desktop main                               | ✓     |
| `url.ts`    | 135 | GitHub URL / `npx skills add` command parser for the install callout                                            | — / desktop main                               | ✓     |

## `registry/` — the local bank: layout, index, curation, sidecars, sync

| File           | LOC | Purpose                                                                                                                            | Consumed by                                     | Tests |
| -------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| `walk.ts`      | 203 | RegistryIndex find helpers, `walkSkills`, entry-path resolution, `readSkillMeta`                                                   | build, discovery, manifest, skills/\_, sync     | —     |
| `build.ts`     | 464 | Walk `skills/<bucket>/<name>/SKILL.md` → RegistryIndex (lenient/`strict`); folds sidecars + external + canon + hidden              | ~10 modules / desktop main, scripts             | ✓     |
| `canon.ts`     | 161 | Canon (upstream-owned) name set: machine-written cache with TTL read; + the user-mutable hidden-canon set (Dismiss)                | build, sync, disk-import, manifest/import       | ✓     |
| `discovery.ts` | 174 | File-convention skill discovery in an arbitrary tree; collision + nested-skill reporting                                           | sync / —                                        | ✓     |
| `external.ts`  | 77  | Persistence for non-adopted (symlink-mode) entries in `.skills-bank/external.json`                                                 | build, heal, skills/register, skills/unregister | —     |
| `heal.ts`      | 303 | Content hashing + the hash & runtime sidecars + missing-entry heal actions                                                         | build, manifest, sync, skill-lock, probe        | ✓     |
| `labels.ts`    | 584 | Category/tag taxonomy + rules, `deriveLabels` (on-demand since v1.19), pure `applySkillLabel`/`clearSkillLabel`, `effectiveLabels` | manifest / renderer via `/labels`, desktop main | ✓     |
| `frontmatter.ts` | 271 | The frontmatter parser (`parseSkillFrontmatter`) + `validateSkillMeta` vs the inlined `SKILL_FRONTMATTER_SCHEMA`                | build, walk / scripts (`bank update`)           | ✓     |
| `source.ts`    | 182 | `.skills-bank.json` sidecar: source axis + origin pointer read/write, legacy tolerant-read window                                  | build, manifest, sync, skill-lock               | ✓     |
| `sync.ts`      | 575 | Canonical tarball pull, decomposed: `classifySyncDisposition`/`mountSkillFromSource`/`detectSyncOrphans` + `syncTarballToRegistry` | disk-import / desktop main                      | ✓     |

## `skills/` — operations on individual skills (lifecycle)

| File             | LOC | Purpose                                                                                                                       | Consumed by                             | Tests |
| ---------------- | --- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | ----- |
| `install.ts`     | 308 | Symlink primitives: `linkSkillToAgents`, `unlinkSkillFromAgents`, `deleteFromBankSkill` (non-UI path)                         | manifest, unregister / desktop main     | —     |
| `register.ts`    | 663 | Registration: install scanning, register routing, adopt-into-registry, symlink-mode register, agent-link reconcile, finalize  | — / desktop main (split from import.ts) | —     |
| `classify.ts`    | 44  | Node-only `classifySkillByName`: joins the pure `shared/skill-state` classifier with build/installed for main-process callers | — / desktop main (moved from `shared/`) | —     |
| `conflicts.ts`   | 203 | Broken-link repair/remove + registry-vs-installed conflict resolution (split from import.ts; owns the `isSymlink` util)       | — / desktop main                        | —     |
| `installed.ts`   | 150 | Scan agent + custom dirs; classify installs (ours / foreign-symlink / real-directory / broken-symlink)                        | classify, delete, diagnostics, register | ✓     |
| `delete.ts`      | 118 | Delete unregistered skills from agent dirs (real dirs recursively; symlinks unlinked)                                         | — / desktop main                        | —     |
| `diagnostics.ts` | 136 | Aggregate local-disk anomalies into a `DiagnosticReport`                                                                      | — / desktop main                        | ✓     |
| `export.ts`      | 137 | Single-skill export to disk: standalone SKILL.md vs bundled zip decision + write                                              | — / desktop main                        | —     |
| `unregister.ts`  | 371 | Destructive-ladder step: drop registry entry; adopted skills move files to a destination agent dir (collision + EXDEV)        | — / desktop main                        | ✓     |

## `manifest/` — the registry-manifest artifact

| File             | LOC | Purpose                                                                                                                                                                                              | Consumed by                   | Tests |
| ---------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ----- |
| `manifest.ts`    | 620 | Schema v5 + types, `exportRegistryManifest`, canonical `serializeManifest`, `coerceManifestToCurrent`, snapshot rotation, `fetchRemoteManifest`; exports the origin/label helpers `import.ts` reuses | import, diff, merge / desktop | ✓     |
| `import.ts`      | 373 | `importRegistryManifest` — re-fetch per skill from origin, collision + confirmed-removal arms, origin stamping; + the reconcile entry points `computeManifestRemovals`/`reconcileRegistryToManifest` | — / desktop main              | —     |
| `diff.ts`        | 69  | Two-manifest diff at skill granularity; owns `COMPARED_FIELDS`, the shared change-signature field set                                                                                                | merge / desktop main          | ✓     |
| `merge.ts`       | 329 | Three-way manifest merge (ADR-0009): merge core, conflict classification, resolution, pending-conflict + merge-base persistence                                                                      | — / desktop main              | ✓     |
| `disk-import.ts` | 121 | Merge-from-disk: additive import of another tree's `skills/`, queueing collisions for the sync resolver                                                                                              | — / desktop main              | ✓     |

## Why only two files sit at the root

`index.ts` and this `INVENTORY.md` are **not domain modules**, so neither moves
into a domain dir:

- **`index.ts`** is the package's public entry point — `package.json`'s `main`
  and the `.` export resolve `@skills-bank/core` → `dist/index.js`. It's the
  barrel (`export *` over all five domains): cross-cutting by definition, owned
  by no single domain, and pinned at the package root by the export map. Moving
  it would just force a longer export path for zero benefit.
- **`INVENTORY.md`** is documentation, not code — it describes all domains, so
  it belongs above them, not inside one.

Everything that _is_ a domain module was moved; the reorg left no stray
implementation files at the root (verified: `ls core/src` → `index.ts`,
`INVENTORY.md`, and the five dirs).

## Layering notes

- **GitHub stack** (`github/`): `http` (client) ← `files` (Contents API) /
  `origin` (tree + mirror) ← `probe` (scheduler) / `push` (PR flow). `repos` and
  `url` are thin leaves beside them.
- **Destructive ladder** (`skills/`): `unregister` (drop entry, move files) is
  distinct from `delete` (wipe agent-dir presence of already-unregistered
  skills) — sequential stages, not overlap.
- **sync vs disk-import vs manifest/merge**: `registry/sync` = canonical tarball
  pull; `manifest/disk-import` = additive merge-from-disk; `manifest/merge` =
  three-way metadata merge. All three share `shared/conflict.ts` vocabulary.

## Standing observations

Scale-to-current-size: collapse glue into its only consumer; build abstractions
when the need exists.

- **`manifest/manifest.ts`** (620L): the v2–v5 coercion block stays quarantined;
  split to `manifest/coerce.ts` when the next schema bump touches it.
- **`registry/heal.ts`**: hashing + two sidecars + heal actions share a file;
  split when a fourth concern arrives, not before.
- **`skills/register.ts`** (663L): now the package's largest file — a future
  _split_ candidate if it grows further (`conflicts.ts` was already extracted),
  never a merge target.
