# Registry IPC → primitives

Plan for extending the `install.ts` primitive discipline (core holds the
logic as single-responsibility functions; `main.ts` handlers are thin
wrappers) to the registry surface: sync, linked-repo, manifest, and labels.

> As of `main` @ `9943e88` (2026-06-08). Line numbers are snapshots.

The two big registry ops aren't single responsibilities — they're
compositions, and most of their pieces already exist. The work: extract
the sub-steps still buried in `applyCanonicalSync` / `reconcileLocalToManifest`,
and add thin orchestrators that remove the `main.ts` duplication.

## Sync operation → `SyncReport`

| Current (location)                                      | Responsibility                                               | Function                                                                | Status                 |
| ------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ---------------------- |
| `fetchCanonicalTarball` (sync.ts:115)                   | resolve ref→SHA, download+extract tarball                    | `fetchCanonicalTarball`                                                 | EXISTS                 |
| `readSyncDecisions` (sync.ts:428)                       | load persisted conflict resolutions                          | `readSyncDecisions`                                                     | EXISTS                 |
| `discoverSkillsInTree` (discovery.ts)                   | enumerate skill folders in the source tree                   | `discoverSkillsInTree`                                                  | EXISTS                 |
| applyCanonicalSync 217–283                              | per-skill: previously-synced? unchanged? conflict? resolved? | `classifySyncDisposition(existing, incomingHash, storedHash, decision)` | **NEW** (pure)         |
| applyCanonicalSync 289–321                              | copy source→mount, stamp source + content hash               | `mountSkillFromSource(sourceDir, destDir, stamp)`                       | **NEW**                |
| applyCanonicalSync 329–337                              | local skills synced here but absent upstream (never deletes) | `detectSyncOrphans(root, canonicalNames, expectedSource)`               | **NEW** (pure-ish)     |
| applyCanonicalSync 357–379                              | persist last-sync report + pending-conflicts                 | `writeLastSyncReport` / `writePendingConflicts`                         | **NEW** (thin)         |
| `runSync` (3190) + `replaceRegistryWithRepo` (3426), ×2 | fetch → decisions → apply → cleanup                          | `syncTarballToRegistry({owner, repo, token?, mountTo, onStatus?})`      | **NEW** (orchestrator) |

`applyCanonicalSync` stays as the per-tree orchestrator, now composing the
classify / mount / detect-orphans / write units.

## Reconcile operation → `ReconcileResult`

| Current (location)                         | Responsibility                                            | Function                                                             | Status                      |
| ------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| `walkSkills` (registry.ts)                 | enumerate local skill folders                             | `walkSkills`                                                         | EXISTS                      |
| reconcileLocalToManifest 2045              | `localNames − manifestNames` set diff                     | `computeManifestRemovals(localNames, manifest)`                      | **NEW** (pure)              |
| `importRegistryManifest` (import.ts)       | mirror adds/updates + delete `removeNames` + `onProgress` | `importRegistryManifest`                                             | EXISTS                      |
| reconcileLocalToManifest 2058              | rebuild index, invalidate canon cache                     | `buildRegistryIndex` + `invalidateCanonCache`                        | EXISTS                      |
| `reconcileLocalToManifest` (2039, main.ts) | the whole walk→diff→import→rebuild                        | `reconcileRegistryToManifest(root, manifest, {onProgress?, token?})` | **NEW** (move to import.ts) |

## Fetch helpers (currently inline in main.ts)

| Current (location)                                                 | Responsibility                                   | Function                                   | Status                        |
| ------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------ | ----------------------------- |
| `fetchRemoteManifest` (2068) + inline 404 in `previewManifestPush` | read `registry-manifest.json`; 404/parse → empty | `fetchRemoteManifest(repo, branch, token)` | **NEW** (move to manifest.ts) |
| default-branch fetch in `replaceRegistryWithRepo`                  | repo metadata → `default_branch`                 | `fetchRepoDefaultBranch(fullName, token)`  | **NEW** (github-files.ts)     |
| `reposListMine` pagination (3383)                                  | paginate `/user/repos` → `UserRepo[]`            | `fetchUserRepos(token, {maxPages})`        | **NEW** (github-files.ts)     |

## Labels (currently inline in main.ts; user-driven since v1.19)

| Current (location)        | Responsibility                  | Function                                         | Status              |
| ------------------------- | ------------------------------- | ------------------------------------------------ | ------------------- |
| `updateLabel` (3820)      | persist a skill's category/tags | `setSkillLabels(root, name, {category?, tags?})` | **NEW** (labels.ts) |
| `resetLabel` (3835)       | drop a skill's labels           | `clearSkillLabels(root, name)`                   | **NEW** (labels.ts) |
| `bulkUpdateLabels` (3841) | batch persist                   | loop `setSkillLabels` — **not** a primitive      | —                   |

No "override" framing: `deriveLabels` runs only on explicit Auto-Generate
actions in the renderer; these primitives just persist the user's labels.
(`SkillLabelOverride`/`LabelsMap` type names are legacy.)

## Not changing

- **keep-both fork rename** (`resolveManifestConflicts` 2444–2458): live but
  lowest-traffic; leave inline. Revisit only if keep-both stays as a feature.
- Picker-bound handlers, `getConfig`/`getRoot`, status/progress fan-out:
  Electron boundary — stays in main; primitives take an `onStatus`/`onProgress`
  callback.
- Skill-level ops (`install`, `unregister`, `hide`, …) — already primitive-backed.

## Target layout (deferred — extract primitives first, then reorg)

`core/src/` is ~38 flat modules. After the primitives land (in the flat
layout), reorg into 5 concept dirs. Locked names: `manifest`, `registry`,
`skills`, `shared`, `github`.

- `shared/` — errors, types, paths, diff, skill-lock, conflict, skill-state(+server), agents(+data)
- `github/` — http, files, repos\*, push; + origin, probe, url (all GitHub/upstream)
- `registry/` — walk, build, canon, hide, labels, external, source/record/heal (sidecar trio), meta; + sync: tarball, discovery, apply, decisions
- `skills/` — install, register, unregister, delete, conflicts, installed, export, diagnostics
- `manifest/` — manifest, diff, merge, import, reconcile\*, disk-import

Headline split: today's `import.ts` mixes two concerns → `manifest/import.ts`
(manifest import) + `skills/register.ts` + `skills/conflicts.ts`. (`*` = new.)
Barrel stays `export *` (repointed paths); the 3 renderer-safe subpaths
(`labels`, `agents-data`, `skill-state`) keep their specifiers, repoint dist
targets. Pure file moves — no public-API change.

## Verify (for the refactor)

`pnpm typecheck && pnpm test` — pure units (`classifySyncDisposition`,
`computeManifestRemovals`, `detectSyncOrphans`) table-test directly;
orchestrators test against a temp registry root. Then `pnpm start` to
exercise both sync paths + a label edit, and `pnpm knip` to catch the
now-dead main-local helpers.
