# Core inventory

Reference inventory of everything under `packages/core/src/`: what each
module does, who consumes it, and the conventions that govern the package.
Repo-internal — not published to the docs site.

> **Freshness: accurate as of branch `feat/skill-provenance-model`
> (2026-07-06) — the v6 origin-only provenance migration (issue #159,
> ADRs 0017–0021).**
> LOC and consumer columns are snapshots; re-verify (`wc -l`, grep the
> import graph) and re-stamp when the package changes materially — or
> distrust the numbers and trust only the purposes, which drift slower.

`core/src/` is organized into **six concept directories**, each scoped to one
domain's operations (`metrics/` joined the original five in the skill-usage
metrics work). The only top-level files are `index.ts` (the barrel) and
this doc — see [Why only two files sit at the root](#why-only-two-files-sit-at-the-root).
Tables below are grouped by directory, then sorted by file name. Tests are
colocated (`*.test.ts` / `test/*.test.ts`); entry criteria live in ADR-0001.

## Conventions

- **SDK surface.** Everything `index.ts` re-exports is public (post-1.0):
  renaming or removing an export ships a `@deprecated` alias for one minor
  cycle before cutting. JSON wire formats (`registry-manifest.json`) tolerate
  a legacy read for one minor cycle on shape changes — except this migration,
  which was a deliberate destructive cut with no coercion window (single
  user, stealth; see ADR-0018).
- **Domain boundaries.** A file lives in the domain dir of the operation it
  implements. A domain-specialized op lives in its own domain and imports the
  generic primitive — e.g. `manifest/manifest.ts#fetchRemoteManifest` imports
  `github/files.ts#readRepoFile` rather than living in `github/`. Cross-domain
  imports are expected; a genuine primitive is defined once and imported, never
  re-implemented. Dependency direction: `shared` ← `github`/`registry` ←
  `skills`/`manifest` (no cycles). The merge-fork rename-target picker
  (`resolveRenameTarget`) lives in `manifest/merge.ts` alongside its only
  caller; "conflict" as a term means agent-dir stragglers (`skills/conflicts.ts`).
- **Renderer-safe subpaths.** The Vite renderer cannot import the main barrel
  (it transitively pulls `node:child_process` via `registry/build.ts`).
  Renderer-safe modules are exposed as subpath exports — `@skills-bank/core/agents-data`
  (→ `shared/agents-data`), `/skill-state` (→ `shared/skill-state`), `/labels`
  (→ `registry/labels`) — and must stay free of `fs`/`os`/`path`-at-module-scope
  side effects. The import specifiers are stable; only the `dist/` targets moved
  with the reorg.
- **Origin is a single nullable URL (ADR-0019/0020).** There is no `source`
  axis (`curated`/`user`/`vendored`) and no `canon`/`hidden` concept — both
  deleted whole. Provenance lives solely in the manifest row's
  `origin: { url: string | null, skillPath?, hash? }`: `url` pointing at the
  registry's own linked repo is a self-origin (authored here), any other
  `url` is an external upstream, `url: null` is an explicit "local skill, no
  remote" stamp. GitHub-ness is a call-site capability check (`isGithubUrl`)
  rather than a stored kind. `registry/source.ts#isSelfOrigin`/`bucketForOrigin`
  are the two derivations everything downstream shares.
- **No per-skill sidecars.** `.skills-bank.json`, `.skills-bank-hash`, and
  `.skills-bank-runtime.json` are gone. Volatile per-skill state (content-hash
  baseline, probe failure counters, fetch timestamps) lives in exactly one
  gitignored file per registry, `<root>/.skills-bank/runtime.json`, keyed by
  skill name (`registry/runtime-map.ts`). A skill folder mid-move or
  mid-detach gets a transient one-line op journal (`.skills-bank-op.json`,
  `registry/op-journal.ts`) resolved on the next boot scan — not a standing
  sidecar, just crash-recovery breadcrumbs cleared as soon as the op
  completes.
- **Manifest schema is v6**; `manifest/manifest.ts#coerceManifestToCurrent`
  is a v6-only parse+validate+default-fill (rejects anything without
  `schemaVersion: 6` — no legacy coercion chain, per the destructive-cut
  decision above). `registry/reconcile-folders.ts#reconcileFoldersToManifest`
  is the sole manifest-write seam: it stamps `url: null` rows for orphan
  folders and refreshes label overrides, called at boot and from the
  `snapshotAfterMutation` seam — never from `buildRegistryIndex`, which
  stays a pure read.
- **Frontmatter parsing** has exactly one parser:
  `registry/frontmatter.ts#parseSkillFrontmatter`.

## `shared/` — foundation (imported by every other domain)

| File             | LOC | Purpose                                                                                       | Consumed by                                                                                | Tests |
| ---------------- | --- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----- |
| `agents-data.ts` | 50  | Renderer-safe agent metadata: `AGENTS` list, `AgentDef`/`AgentId`, `getAgent`                 | `shared/agents.ts` / renderer via `/agents-data`                                           | —     |
| `agents.ts`      | 40  | Node-side agent helpers: skills-dir resolution, existing-agents scan, default install targets | `skills/*`, `registry/bucket-move.ts` / desktop main                                       | —     |
| `diff.ts`        | 170 | Per-file folder diff (size-capped, binary-skipping, sidecar-aware) for the DiffViewer         | `manifest/merge.ts` / desktop main                                                         | —     |
| `errors.ts`      | 77  | Structured `AppError` (code, copyable details, suggested actions) + `fromCaught`              | `skills/unregister.ts` / desktop main + renderer                                           | —     |
| `home.ts`        | 21  | Isolation seam: `getIsolatedHome()` (dev-redirect aware) vs `getRealHome()` (always real)     | `registry/heal.ts` / desktop main, scripts                                                 | —     |
| `paths.ts`       | 46  | Registry-root resolution (cwd walk-up) + `getStateDir`                                        | `registry/*`, `manifest/merge.ts`, `github/probe.ts`, `skills/register.ts` / desktop main  | ✓     |
| `skill-state.ts` | 488 | Pure drawer-state classifier: installation partition → state + capability fan-out             | `registry/build.ts`, `github/probe.ts`, `skills/classify.ts` / renderer via `/skill-state` | ✓     |
| `types.ts`       | 214 | Shared shapes: `RegistryEntry`, `RegistryIndex`, `SkillMeta`, warnings                        | ~8 modules / desktop, renderer                                                             | —     |

## `github/` — GitHub transport + upstream attribution

| File                         | LOC | Purpose                                                                                                             | Consumed by                                                                                                                    | Tests |
| ---------------------------- | --- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ----- |
| `http.ts`                    | 105 | Shared GitHub REST client + rate-limit normalization (`ghFetch`, `GH_API`, `RateLimitInfo`)                         | `rehome-into-linked-repo`, `files`, `origin`, `probe`, `repos` / manifest.ts                                                   | —     |
| `files.ts`                   | 236 | GitHub Contents API primitives: read / write / write-as-branch                                                      | `rehome-into-linked-repo.ts`, manifest.ts / desktop (manifest repo transport)                                                  | ✓     |
| `repos.ts`                   | 67  | Repo-metadata ops: `fetchUserRepos` (link picker), `fetchRepoDefaultBranch` (split out of `http`)                   | — / desktop `ipc-repos.ts`                                                                                                     | —     |
| `origin.ts`                  | 565 | Origin primitives: tree probe, `installSkillFiles` mirror (idempotent), `applySkillUpdate`                          | `manifest/import.ts`, `probe.ts` / desktop `ipc-github.ts`                                                                     | —     |
| `probe.ts`                   | 407 | Stateful origin-probe runner: scheduled upstream fetches, per-repo cache + TTL, update flagging                     | — / desktop main (`main.ts`/`main-state.ts`)                                                                                   | ✓     |
| `url.ts`                     | 175 | GitHub URL parsing: `isGithubUrl`, `parseOwnerRepo`, `parseGithubSkillUrl`, `npx skills add` command parser         | `probe.ts`, `manifest/import.ts`, `registry/build.ts`, `registry/source.ts`, `shared/skill-state.ts` / desktop main + renderer | ✓     |
| `rehome-into-linked-repo.ts` | 180 | `rehomeIntoLinkedRepo` — commit a local (`url: null`) skill's files into the linked repo as a PR (writes-as-branch) | — / desktop `ipc-registry.ts` (`rehomeIntoLinkedRepo` IPC)                                                                     | ✓     |

## `registry/` — the local bank: layout, index, curation, runtime state

| File                   | LOC | Purpose                                                                                                                                                                       | Consumed by                                                                                                                           | Tests                           |
| ---------------------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `walk.ts`              | 203 | RegistryIndex find helpers, `walkSkills`, entry-path resolution, `readSkillMeta`                                                                                              | `build`, `heal`, `bucket-move`, `source`, `manifest/*`, `github/rehome-into-linked-repo.ts`, `skills/*`                               | —                               |
| `build.ts`             | 420 | Walk `skills/<bucket>/<name>/SKILL.md` → RegistryIndex (lenient/`strict`); joins folders × live manifest row × runtime map                                                    | ~9 modules / desktop main, scripts                                                                                                    | ✓ (via manifest/register tests) |
| `heal.ts`              | 320 | Content hashing, op-journal boot-scan resolution, and the heal/restore actions: `forgetMissingEntry`, `detachOrigin`                                                          | `build.ts`, `manifest/import.ts` / desktop `ipc-github.ts`, `ipc-registry.ts`                                                         | ✓                               |
| `labels.ts`            | 117 | Category/tag taxonomy, `effectiveLabels`, pure `applySkillLabel`/`clearSkillLabel`                                                                                            | `manifest/*` / renderer via `/labels`, desktop `ipc-labels.ts`, `ipc-manifest.ts`                                                     | —                               |
| `frontmatter.ts`       | 264 | The frontmatter parser (`parseSkillFrontmatter`) + `validateSkillMeta` vs the inlined `SKILL_FRONTMATTER_SCHEMA`                                                              | `build.ts`, `walk.ts` / scripts (`update-skill.ts`, `validate-all.ts`)                                                                | ✓                               |
| `source.ts`            | 40  | Origin-URL derivations: `isSelfOrigin` (URL vs linked repo), `bucketForOrigin` — the two shared self/bucket checks (ADR-0019/0020)                                            | `manifest/manifest.ts`, `github/probe.ts`                                                                                             | —                               |
| `runtime-map.ts`       | 120 | The one gitignored `<root>/.skills-bank/runtime.json` reader/writer, keyed by skill name (ADR-0021)                                                                           | `build.ts`, `heal.ts`, `skills/install.ts`, `skills/unregister.ts`, `manifest/import.ts` / desktop `ipc-registry.ts`, `ipc-github.ts` | ✓                               |
| `reconcile-folders.ts` | 55  | **New.** The sole manifest-write seam: stamps `url: null` rows for orphan folders, refreshes label overrides. Called at boot + `snapshotAfterMutation`, never from `build.ts` | — / desktop `main.ts`, `main-state.ts`                                                                                                | —                               |
| `bucket-move.ts`       | 105 | `moveSkillBucket` — moves a skill folder between `personal`/`vendored` and repoints every agent-dir symlink that pointed at the old location                                  | `heal.ts` (detachOrigin)                                                                                                              | ✓ (bucket-move.test.ts)         |
| `op-journal.ts`        | 38  | Transient one-line crash-recovery breadcrumb (`.skills-bank-op.json`) for in-flight move/detach/import ops, cleared on completion                                             | `heal.ts`, `bucket-move.ts`                                                                                                           | —                               |

## `skills/` — operations on individual skills (lifecycle)

| File             | LOC | Purpose                                                                                                                         | Consumed by                                          | Tests |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----- |
| `install.ts`     | 317 | Symlink primitives: `linkSkillToAgents`, `unlinkSkillFromAgents`, `deleteFromBankSkill` (non-UI path)                           | `manifest/import.ts`, `unregister.ts` / desktop main | —     |
| `register.ts`    | 560 | Registration: install scanning, `registerSkill` (moves files into the bank + records), agent-link reconcile, finalize           | — / desktop main, renderer (via IPC types)           | ✓     |
| `classify.ts`    | 42  | Node-only `classifySkillByName`: joins the pure `shared/skill-state` classifier with build/installed for main-process callers   | — / desktop `ipc-registry.ts`                        | —     |
| `conflicts.ts`   | 203 | Broken-link repair/remove + registry-vs-installed conflict resolution; owns the `isSymlink` util                                | — / desktop main, renderer (via IPC types)           | —     |
| `installed.ts`   | 130 | Scan agent dirs; classify installs (ours / foreign-symlink / real-directory / broken-symlink)                                   | `classify`, `delete`, `diagnostics`, `register`      | ✓     |
| `delete.ts`      | 118 | Delete unregistered skills from agent dirs (real dirs recursively; symlinks unlinked)                                           | — / desktop main                                     | —     |
| `diagnostics.ts` | 136 | Aggregate local-disk anomalies into a `DiagnosticReport`                                                                        | — / desktop main                                     | ✓     |
| `export.ts`      | 137 | Single-skill export to disk: standalone SKILL.md vs bundled zip decision + write                                                | — / desktop main                                     | —     |
| `unregister.ts`  | 300 | Destructive-ladder step: move a registered skill's files out to a destination agent dir (collision + EXDEV) + drop manifest row | — / desktop main, renderer (via IPC types)           | ✓     |

## `manifest/` — the registry-manifest artifact

| File          | LOC | Purpose                                                                                                                                                                                                                                                                      | Consumed by                                                                                                                                                     | Tests |
| ------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| `manifest.ts` | 378 | Schema v6 + types, `exportRegistryManifest`, `toPushedProjection`, canonical `serializeManifest`/`serializeLiveManifest`, `coerceManifestToCurrent`, snapshot rotation, `fetchRemoteManifest`                                                                                | `diff`, `import`, `merge`, `registry/build.ts`, `registry/heal.ts`, `registry/reconcile-folders.ts`, `skills/install.ts`, `skills/unregister.ts` / desktop main | ✓     |
| `import.ts`   | 368 | `importRegistryManifest` — re-fetch per skill from origin, collision + confirmed-removal arms, origin stamping; + `computeManifestRemovals`/reconcile entry points, diffing the pushed projection (not a disk walk) so `url: null` skills are immune to pull-driven deletion | — / desktop `ipc-manifest.ts`                                                                                                                                   | ✓     |
| `diff.ts`     | 67  | Two-manifest diff at skill granularity; owns `COMPARED_FIELDS = ["origin", "category", "tags"]`                                                                                                                                                                              | `merge.ts` / desktop `ipc-manifest.ts`                                                                                                                          | ✓     |
| `merge.ts`    | 323 | Three-way manifest merge (ADR-0009): merge core, conflict classification, resolution, pending-conflict + merge-base persistence                                                                                                                                              | — / desktop `ipc-manifest.ts`                                                                                                                                   | ✓     |

## `metrics/` — skill-usage tracking (post-consolidation addition)

| File             | LOC | Purpose                                                                                                                                                             | Consumed by                                       | Tests |
| ---------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ----- |
| `invocations.ts` | 181 | Invocation log path + reader: `getMetricsDir`, `getInvocationLogPath`, `readInvocationStats`. Uses `getRealHome` (metrics is the deliberate dev-isolation carveout) | — / desktop `ipc-metrics.ts`, `skill-tracking.ts` | —     |
| `hook-config.ts` | 180 | Builds and installs the Claude Code `PreToolUse` hook script + settings.json entry that feeds the invocation log                                                    | — / desktop `skill-tracking.ts`                   | —     |
| `coverage.ts`    | 105 | Derives tracking-coverage windows/gaps from the hook history for the metrics UI                                                                                     | — / desktop `skill-tracking.ts`                   | —     |

## Why only two files sit at the root

`index.ts` and this `INVENTORY.md` are **not domain modules**, so neither moves
into a domain dir:

- **`index.ts`** is the package's public entry point — `package.json`'s `main`
  and the `.` export resolve `@skills-bank/core` → `dist/index.js`. It's the
  barrel (`export *` over all six domains): cross-cutting by definition, owned
  by no single domain, and pinned at the package root by the export map.
- **`INVENTORY.md`** is documentation, not code — it describes all domains, so
  it belongs above them, not inside one.

Everything that _is_ a domain module was moved; `ls core/src` → `index.ts`,
`INVENTORY.md`, and the six dirs (`shared`, `github`, `registry`, `skills`,
`manifest`, `metrics`).

## Layering notes

- **GitHub stack** (`github/`): `http` (client) ← `files` (Contents API) /
  `origin` (tree + mirror) ← `probe` (scheduler). `repos`, `url`, and
  `rehome-into-linked-repo` are thin leaves beside them
  (`rehome-into-linked-repo` composes `http`, `files`, `walk`).
- **Destructive ladder** (`skills/`): `unregister` (drop entry, move files) is
  distinct from `delete` (wipe agent-dir presence of already-unregistered
  skills) — sequential stages, not overlap.
- **One manifest-write seam, one runtime-state file.** `registry/build.ts`
  stays a pure read (folders × manifest × runtime map, no writes).
  `registry/reconcile-folders.ts#reconcileFoldersToManifest` is the only
  function that writes `registry-manifest.json` outside of an explicit
  acquisition/import/detach path; `registry/runtime-map.ts` is the only
  reader/writer of `.skills-bank/runtime.json`. The old three-subsystem split
  (canonical-tarball sync vs additive disk-import vs three-way manifest
  merge) is gone — `registry/sync.ts`, `registry/canon.ts`,
  `registry/discovery.ts`, `registry/reconcile.ts` (resident-origins),
  `registry/skill-record.ts`, `shared/skill-lock.ts`, and
  `manifest/disk-import.ts` were all deleted in this migration. What remains
  is one manifest engine: `manifest/import.ts` handles both first-link and
  ongoing pull; `manifest/merge.ts` is only reached from the pull's three-way
  conflict path.

## Standing observations

Scale-to-current-size: collapse glue into its only consumer; build abstractions
when the need exists.

- **`manifest/manifest.ts`** (378L): shrank sharply in this migration (v2–v5
  coercion branches, sidecar-marker writers, and install-hint recomputation
  all deleted). No split candidate at this size.
- **`registry/heal.ts`** (376L): hashing, op-journal boot-scan, and three heal
  actions (`repointExternalEntry`, `forgetMissingEntry`, `detachOrigin`) share
  a file; split when a fourth concern arrives, not before.
- **`skills/register.ts`** (646L): still the package's largest file — a future
  _split_ candidate if it grows further (`conflicts.ts` was already
  extracted), never a merge target.
