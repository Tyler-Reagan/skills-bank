# Core inventory

Reference inventory of everything under `packages/core/src/`: what each
module does, who consumes it, and the conventions that govern the package.
Repo-internal — not published to the docs site.

> **Freshness: accurate as of 2026-06-06 (v1.20.2 + the core-cleanup PR).**
> LOC and consumer columns are snapshots; re-verify (`wc -l`, grep the
> import graph) and re-stamp when the package changes materially — or
> distrust the numbers and trust only the purposes, which drift slower.

Tables are sorted alphabetically by file name. Every module has a
colocated `*.test.ts` where noted; entry criteria live in ADR-0001.

## Conventions

- **SDK surface.** Everything `index.ts` re-exports is public (post-1.0):
  renaming or removing an export ships a `@deprecated` alias for one minor
  cycle before cutting. JSON wire formats (`.skills-bank.json`) tolerate a
  legacy read for one minor cycle on shape changes.
- **Renderer-safe subpaths.** The Vite renderer cannot import the main
  barrel (it transitively pulls `node:child_process` via `build.ts`).
  Renderer-safe modules are exposed as subpath exports —
  `@skills-bank/core/agents-data`, `/labels`, `/skill-state` — and must
  stay free of `fs`/`os`/`path`-at-module-scope side effects.
- **Sidecar trio (ADR-0002).** Per-skill on-disk state lives in three
  sidecars, each owned by the module adjacent to its logic:
  `.skills-bank.json` (source axis + origin pointer — `source.ts`),
  `.skills-bank-hash` (synced content baseline — `heal.ts`),
  `.skills-bank-runtime.json` (probe state — `heal.ts`).
  `skill-record.ts` is the unified read/write facade over all three.
- **Source axis** is `curated` / `user` / `vendored`; legacy
  `bundled`/`yours` and `upstream`→`origin` are tolerated on read only.
- **Manifest schema is v5**; v2–v4 coerce up through the single
  `coerceManifestToCurrent` chokepoint in `manifest.ts`; v1 is unreadable.
- **Frontmatter parsing** has exactly one parser:
  `skill-meta.ts#parseSkillFrontmatter` (block scalars, quoted-scalar
  escape resolution, inline/block arrays, comments). `registry.ts`'s
  `readSkillMdFrontmatter` is a deprecated wrapper, removal next minor.

## Modules (40 files, ~9.7k lines excl. tests)

| File                   | LOC | Purpose                                                                                                                                                                                                                         | Consumed by (core → / external)                                                               | Tests                |
| ---------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------- |
| agents-data.ts         | 50  | Renderer-safe agent metadata: `AGENTS` list, `AgentDef`/`AgentId`, `getAgent`                                                                                                                                                   | agents.ts / renderer via `/agents-data` subpath                                               | —                    |
| agents.ts              | 40  | Node-side agent helpers: skills-dir resolution, existing-agents scan, default install targets                                                                                                                                   | install, installed, import, manifest, unregister, delete-unregistered / desktop main          | —                    |
| build.ts               | 460 | Walk `skills/<bucket>/<name>/SKILL.md` frontmatter → RegistryIndex (lenient by default, `strict` for CI); folds sidecars, external entries, canon + hidden state                                                                | 10 core modules / desktop main, scripts                                                       | ✓                    |
| canon.ts               | 99  | Canon (upstream-owned) name set: machine-written cache with TTL read                                                                                                                                                            | build, merge, sync, unregister / desktop main                                                 | ✓                    |
| conflict.ts            | 82  | Shared conflict-decision disk primitive (rename/delete/no-op) + `-local` rename target picker — extracted once sync and merge duplicated it                                                                                     | merge, sync / —                                                                               | —                    |
| delete-unregistered.ts | 147 | Delete unregistered skills from agent dirs (real dirs recursively; symlinks unlinked, never followed). `previewDeleteUnregistered` deprecated (unused)                                                                          | — / desktop main                                                                              | —                    |
| diff.ts                | 170 | Per-file folder diff (size-capped, binary-skipping, sidecar-aware) for the DiffViewer                                                                                                                                           | — / desktop main                                                                              | —                    |
| discovery.ts           | 174 | File-convention skill discovery in an arbitrary tree (any folder with SKILL.md); collision + nested-skill reporting                                                                                                             | sync / —                                                                                      | ✓                    |
| errors.ts              | 77  | Structured `AppError` (code, copyable details, suggested actions) + `fromCaught`                                                                                                                                                | unregister / desktop main + renderer                                                          | —                    |
| export.ts              | 137 | Single-skill export to disk: standalone SKILL.md vs bundled zip decision + write                                                                                                                                                | — / desktop main                                                                              | —                    |
| external.ts            | 77  | Persistence for non-adopted (symlink-mode) entries in `.skills-bank/external.json`                                                                                                                                              | build, heal, import, unregister / —                                                           | —                    |
| github-files.ts        | 214 | GitHub Contents API primitives: read / write / write-as-branch                                                                                                                                                                  | — / desktop main (manifest repo transport)                                                    | —                    |
| github-http.ts         | 105 | Shared GitHub REST client + rate-limit normalization (`ghFetch`, `RateLimitInfo`)                                                                                                                                               | github-files, origin, origin-probe, publish-push / desktop                                    | —                    |
| heal.ts                | 268 | Three adjacent concerns: content hashing (`hashSkillFolder`, gitignore-aware), the hash + runtime sidecars, and the missing-entry heal actions (`repointExternalEntry`, `forgetMissingEntry`)                                   | build, manifest, merge, origin-probe, skill-lock, skill-record, sync / desktop main           | ✓                    |
| hide.ts                | 66  | User-mutable hidden-skill set (canon skills' Dismiss)                                                                                                                                                                           | build / desktop main                                                                          | —                    |
| import.ts              | 861 | Registration domain (largest module): install scanning, registration routing, adopt-into-registry, symlink-mode register, agent-link reconciliation, finalize top-level symlink, broken-link repair/remove, conflict resolution | — / desktop main (IPC dispatch targets)                                                       | —                    |
| index.ts               | 38  | Barrel: `export *` over every module — the SDK surface                                                                                                                                                                          | — / desktop, scripts                                                                          | —                    |
| install.ts             | 308 | Symlink primitives: `linkSkillToAgents`, `unlinkSkillFromAgents`; `deleteFromBankSkill` (non-UI path)                                                                                                                           | manifest, unregister / desktop main                                                           | —                    |
| installed.ts           | 150 | Scan agent + custom dirs; classify installs (ours / foreign-symlink / real-directory / broken-symlink)                                                                                                                          | delete-unregistered, import, local-diagnostics, skill-state-server / desktop main             | ✓                    |
| labels.ts              | 561 | Category/tag taxonomy + rules, `deriveLabels` suggestion engine (on-demand since v1.19), `SkillLabelOverride` persistence, `effectiveLabels` merge                                                                              | manifest / renderer via `/labels` subpath, desktop main                                       | ✓                    |
| local-diagnostics.ts   | 157 | Aggregate local-disk anomalies into a `DiagnosticReport` (4 categories). `groupDiagnosticsByCategory` deprecated (unused)                                                                                                       | — / desktop main                                                                              | ✓                    |
| manifest-diff.ts       | 69  | Two-manifest diff at skill granularity; owns `COMPARED_FIELDS`, the shared change-signature field set                                                                                                                           | manifest-merge / desktop main                                                                 | ✓                    |
| manifest-merge.ts      | 329 | Three-way manifest merge (ADR-0009): merge core, conflict classification, resolution application, pending-conflict + merge-base persistence                                                                                     | — / desktop main                                                                              | ✓                    |
| manifest.ts            | 829 | Registry manifest v5: export (fold sidecars + labels), canonical serialization, import (re-fetch per skill from origin, collision + removal arms), origin stamping, v2–v5 coercion chokepoint, snapshot rotation                | manifest-diff, manifest-merge / desktop main                                                  | ✓                    |
| merge.ts               | 121 | Merge-from-disk: additive import of another tree's `skills/`, queueing collisions for the sync resolver                                                                                                                         | — / desktop main                                                                              | ✓                    |
| origin-probe.ts        | 408 | Stateful origin-probe runner: scheduled upstream tree fetches, per-repo cache + TTL, update flagging, failure-count tracking                                                                                                    | — / desktop main                                                                              | ✓                    |
| origin-url.ts          | 135 | GitHub URL / `npx skills add` command parser for the install callout                                                                                                                                                            | — / desktop main                                                                              | ✓                    |
| origin.ts              | 524 | Origin primitives: tree probe, `installSkillFiles` mirror (idempotent, no-partial-mutation), `applyOriginUpdate`                                                                                                                | manifest, origin-probe / desktop main, scripts                                                | ✓                    |
| paths.ts               | 57  | Registry-root resolution (cwd walk-up). `getClaudeHome` / `getClaudeSkillsDir` deprecated (CLI-era leftovers)                                                                                                                   | canon, external, hide, import, manifest-merge, origin-probe, sync / desktop main              | ✓                    |
| publish-push.ts        | 451 | Push a skill folder to the linked repo as a PR — six-step atomic commit sequence (ADR-0007). Distinct from manifest push (github-files)                                                                                         | — / desktop main                                                                              | ✓                    |
| registry.ts            | 231 | RegistryIndex read/find helpers, `readSkillMeta` (delegates to the consolidated parser), entry path resolution, `walkSkills`. `loadIndex` + `readSkillMdFrontmatter` deprecated                                                 | build, discovery, export, import, install, manifest, skill-lock, sync / desktop main, scripts | (moved → skill-meta) |
| skill-lock.ts          | 195 | Read `~/.agents/.skill-lock.json` (the `npx skills` CLI's lock) and stamp GitHub origins onto CLI-installed skills                                                                                                              | — / desktop main                                                                              | —                    |
| skill-meta.ts          | 263 | The frontmatter parser (`parseSkillFrontmatter`) + `validateSkillMeta` against the inlined `SKILL_META_SCHEMA` (parity-tested against docs/meta-schema.json)                                                                    | build, registry / scripts (`update:skill`)                                                    | ✓                    |
| skill-record.ts        | 82  | Unified three-sidecar read/write facade + per-axis re-exports. `readSkillRecord`/`writeSkillRecord` deprecated (unused — call sites stayed per-axis)                                                                            | — / — (vocabulary module)                                                                     | —                    |
| skill-state-server.ts  | 44  | Node-only wrapper joining the pure classifier with build/installed for main-process callers                                                                                                                                     | — / desktop main                                                                              | —                    |
| skill-state.ts         | 523 | Pure drawer-state classifier: installation partition → state + capability fan-out (single source of truth for drawer actions)                                                                                                   | build, origin-probe, skill-state-server / renderer via `/skill-state` subpath                 | ✓                    |
| source.ts              | 182 | `.skills-bank.json` sidecar: source axis + origin pointer read/write with the legacy tolerant-read window                                                                                                                       | build, manifest, merge, skill-lock, skill-record, sync / desktop main                         | ✓                    |
| sync.ts                | 468 | Canonical tarball fetch + conflict-aware registry upsert (`applyCanonicalSync`, mountTo policy, unchanged-hash skip + reporting), sync report/decision persistence                                                              | conflict, merge / desktop main                                                                | ✓                    |
| types.ts               | 227 | Shared shapes: `RegistryEntry`, `RegistryIndex`, `SkillMeta`, warnings                                                                                                                                                          | 10 core modules / desktop, renderer                                                           | (via consumers)      |
| unregister.ts          | 371 | M4 destructive ladder step: drop registry entry; adopted skills move files to a destination agent dir with collision + EXDEV handling                                                                                           | — / desktop main                                                                              | ✓                    |

## Layering notes

- **GitHub stack**: `github-http` (client) ← `github-files` (Contents API)
  / `origin` (tree + mirror primitives) ← `origin-probe` (scheduler) /
  `publish-push` (PR flow). `origin-url` is a pure parser beside them.
- **Destructive ladder**: `unregister` (drop entry, move files) is distinct
  from `delete-unregistered` (wipe agent-dir presence of already-
  unregistered skills) — sequential stages, not overlap.
- **sync vs merge vs manifest-merge**: sync = canonical tarball pull;
  merge = additive merge-from-disk; manifest-merge = three-way metadata
  merge. All three share `conflict.ts` / `SyncDecisions` vocabulary.

## Standing observations

Scale-to-current-size: collapse glue into its only consumer now; build
abstractions when the need exists. Each observation names a present-tense
trigger:

- **Deprecated exports** (`previewDeleteUnregistered`,
  `groupDiagnosticsByCategory`, `getClaudeHome`, `getClaudeSkillsDir`,
  `loadIndex`, `readSkillRecord`, `writeSkillRecord`,
  `readSkillMdFrontmatter`): delete when cutting the next minor — the
  one-cycle deprecation window will have elapsed.
- **manifest.ts** (829L): the v2–v5 coercion block is already quarantined
  with a comment; split it to `manifest-coerce.ts` when the next schema
  bump touches it anyway.
- **import.ts** (861L): seven sections, one registration domain — split
  only if a feature adds an eighth concern that isn't registration.
- **heal.ts**: hashing + two sidecars + heal actions share a file; rename
  or split when a fourth concern arrives, not before.
- **skill-record.ts**: the unified facade nobody adopted — once the
  deprecated pair is cut it's pure re-exports; fold those into `index.ts`
  at that point and delete the file.
