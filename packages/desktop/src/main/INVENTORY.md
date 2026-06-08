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

### Domain boundaries (the governing rule)

- A file lives in the domain dir of the operation it implements. `github/`
  holds GitHub operations that are NOT specialized to another domain.
- A domain-specialized operation lives in its own domain and imports the
  generic primitive — e.g. `fetchRemoteManifest` is in `manifest/` and
  imports `readRepoFile` from `github/`; it does not live in `github/`.
- Cross-domain imports are allowed and expected (manifest/registry/skills
  freely import `github/`). Locality across domains may duplicate similar-
  looking logic — that's acceptable — but a genuine primitive is defined
  ONCE in its home domain and imported, never re-implemented.
- Mechanics: `dist/` is generated (`tsc`, `rootDir: src` → `outDir: dist`),
  so it mirrors `src/` automatically — we only reorganize `src/`. Desktop
  imports core through the `@skills-bank/core` barrel, so internal moves are
  invisible to it; only `index.ts` (the barrel) and intra-core relative
  imports change. Subpath dist targets update only for the 3 renderer-safe
  modules when they move.

## Reorg step 1 — `github/`

Best first domain: nearly self-contained (only `manifest.ts` imports it from
outside the set), touches none of the renderer-safe subpaths, and is the
foundation the later domains import from. Settling it first means
manifest/registry/skills moves later point at final `github/` paths.

**Moves** (source → target; tests move alongside):

| Current `src/`            | New `src/github/` | Import rewrites inside the file                                                                                                                                                        |
| ------------------------- | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github-http.ts`          | `http.ts`         | — (0 internal imports); **split out** `fetchUserRepos`, `fetchRepoDefaultBranch`, `GithubRepoSummary` → `repos.ts`                                                                     |
| _(new)_                   | `repos.ts`        | the 3 split symbols; `import "./http.js"`                                                                                                                                              |
| `github-files.ts`         | `files.ts`        | `./github-http.js` → `./http.js`                                                                                                                                                       |
| `origin.ts` (+test)       | `origin.ts`       | `./github-http.js` → `./http.js`                                                                                                                                                       |
| `origin-url.ts` (+test)   | `url.ts`          | — (0 internal imports)                                                                                                                                                                 |
| `origin-probe.ts` (+test) | `probe.ts`        | `./github-http.js`→`./http.js`, `./origin.js` stays same-dir; `./build.js`→`../build.js`, `./heal.js`→`../heal.js`, `./paths.js`→`../paths.js`, `./skill-state.js`→`../skill-state.js` |
| `publish-push.ts` (+test) | `push.ts`         | `./github-http.js` → `./http.js`                                                                                                                                                       |

**The one decomposition:** `repos.ts` is split out of `http.ts` so `http.ts`
stays generic transport (`ghFetch`, `GH_API`, `RateLimitInfo`,
`GhFetchResult`) and repo-metadata ops live separately. Everything else is a
move + relative-path rewrite, no logic change.

**External importer to repoint** (the only non-moving core file that imports
the set): `manifest.ts` — `./github-files.js`→`./github/files.js`,
`./github-http.js`→`./github/http.js`, `./origin.js`→`./github/origin.js`.

**Barrel** (`index.ts`): repoint the 6 moved lines to `./github/{http,files,origin,url,probe,push}.js` and add `./github/repos.js`.

**No change:** `package.json` (no github file is subpath-exported); desktop
`main.ts` / renderer (barrel absorbs the move).

**Carried cross-domain deps (allowed):** `github/probe.ts` imports
`../build.js` (registry), `../heal.js`, `../paths.js`, `../skill-state.js`
(shared). These get retouched to `../registry/…` / `../shared/…` when those
domains move in later steps — `tsc` flags any stale path.

**Verify the step:** `pnpm typecheck && pnpm test && pnpm knip` (knip catches
stale relative paths + unused exports), then `pnpm build` to confirm
`dist/github/*.js` materializes.

## Reorg step 2 — `shared/` (done, `850388a`)

The foundation domain — widest blast radius (errors/types/paths are imported
almost everywhere) and it owns two of the three renderer-safe subpaths
(`skill-state`, `agents-data`). Moved into `packages/core/src/shared/`
(git-tracked renames):

`errors.ts  types.ts  paths.ts  diff.ts  skill-lock.ts  conflict.ts
skill-state.ts (+test)  skill-state-server.ts  agents.ts  agents-data.ts`

No decomposition — pure moves. Import rewrites:

- **Inbound** (every non-`shared` core file importing a moved module): insert
  `shared/` into the relative path — `./errors.js`→`./shared/errors.js` at top
  level, `../paths.js`→`../shared/paths.js` from `github/`. ~19 files; the
  barrel `index.ts` is rewritten the same way.
- **Intra-`shared`** (e.g. `agents`→`agents-data`, `skill-state`→`types`,
  `skill-state-server`→`skill-state`/`types`): stay `./` (same dir).
- **`shared`→out** (the only hand-fixed edges): `types`→`../source`/`../registry`,
  `skill-lock`→`../heal`/`../registry`/`../source`, `conflict`→`../sync`,
  `skill-state-server`→`../build`/`../installed`. These point at modules that
  later move to `registry/` — retouched then; `tsc` flags any stale path.

**Subpath exports** (`package.json`): retarget `./skill-state` and
`./agents-data` to `./dist/shared/…` (specifiers unchanged, so the renderer's
`@skills-bank/core/skill-state` import is untouched; the vite build resolving
confirms it). `./labels` stays flat — `labels.ts` is in the not-yet-moved
`registry` domain.

**Carried cross-domain deps:** `shared/` files reaching into `registry/`
modules (`source`, `registry`, `heal`, `build`, `installed`, `sync`) keep `../`
until those move.

Verified: typecheck, 257 tests, knip, build all clean; `dist/shared/{skill-state,agents-data}.js` materialized.

> Process note: this map was added AFTER execution by mistake. Future domain
> steps record the map here and get approval BEFORE the move.

## Reorg step 3 — `registry/` (done, `<commit>`)

The biggest domain and the one `shared/` + `github/` currently reach up for
(`source`, `heal`, `build`, `registry`, `sync`, `skill-meta`). Moving it
resolves those `../` deps to `../registry/…`. Into `packages/core/src/registry/`:

**Moves + renames** (3 files are renamed, not just relocated):

| Current `src/`          | New                     | Note                                                               |
| ----------------------- | ----------------------- | ------------------------------------------------------------------ |
| `registry.ts`           | `registry/walk.ts`      | **rename** — walkSkills/findSkillFolder/findEntry/resolveEntryPath |
| `skill-meta.ts` (+test) | `registry/meta.ts`      | **rename** — the one frontmatter parser                            |
| `skill-record.ts`       | `registry/record.ts`    | **rename** — sidecar facade                                        |
| `source.ts` (+test)     | `registry/source.ts`    | sidecar trio                                                       |
| `heal.ts` (+test)       | `registry/heal.ts`      | sidecar trio                                                       |
| `build.ts` (+test)      | `registry/build.ts`     | index build                                                        |
| `canon.ts`              | `registry/canon.ts`     |                                                                    |
| `hide.ts`               | `registry/hide.ts`      |                                                                    |
| `external.ts`           | `registry/external.ts`  |                                                                    |
| `labels.ts` (+test)     | `registry/labels.ts`    | **renderer-safe subpath**                                          |
| `sync.ts` (+test)       | `registry/sync.ts`      | moved whole — see decision 1                                       |
| `discovery.ts` (+test)  | `registry/discovery.ts` |                                                                    |

**Import-rewrite rules** (same engine as step 2, plus the renames):

- **Inbound** (every non-`registry` file importing a moved module): insert
  `registry/` into the path, applying the renames — e.g. `./build.js`→
  `./registry/build.js`; `./registry.js`→`./registry/walk.js`;
  `./skill-meta.js`→`./registry/meta.js`; `./skill-record.js`→`./registry/record.js`.
  Touches the barrel + many core files (`install`, `import`, `manifest`,
  `export`, `merge`, `manifest-merge`, …).
- **Intra-`registry`** (e.g. `sync`→`canon`/`heal`/`discovery`, `build`→`source`,
  `skill-lock`-style refs): stay `./`, but renamed targets update in place
  (`./registry.js`→`./walk.js`, `./skill-meta.js`→`./meta.js`).
- **`registry`→out**: `./shared/…`→`../shared/…`, `./github/…`→`../github/…`;
  refs to not-yet-moved skills/manifest modules (`installed`, `install`,
  `manifest*`, `import`, `merge`) stay `../…` and become `../skills|manifest/…`
  in later steps.

**Renderer-safe subpath** (`package.json`): retarget `./labels` →
`./dist/registry/labels.js` (+ `.d.ts`). Specifier unchanged; `labels.ts` stays
pure (no `fs`), so the renderer import is unaffected — the third and last
subpath now points into a domain dir. (`skill-state`/`agents-data` already at
`shared/`.)

**Cross-domain retouch** (the `../` deps from earlier steps now resolve):

- `shared/types.ts` → `../registry/source.js`, `../registry/walk.js`
- `shared/skill-lock.ts` → `../registry/heal.js`, `../registry/walk.js`, `../registry/source.js`
- `shared/conflict.ts` → `../registry/sync.js`
- `shared/skill-state-server.ts` → `../registry/build.js` (`../installed.js` stays → skills)
- `github/probe.ts` → `../registry/build.js`, `../registry/heal.js`
- `github/origin.ts` (lazy imports) → `../registry/{build,source,heal,meta}.js`

**No desktop changes** — barrel + the 3 subpaths absorb it.

**Executed as proposed** (sync moved whole; `registry.ts`→`walk.ts`; sidecar
flat). Two path-depth fixes surfaced beyond the import rewrites — both because
moved files now sit one level deeper:

- `build.test.ts` / `meta.test.ts` compute `repoRoot` via `__dirname` — bumped
  `path.resolve(__dirname, "..", "..", "..")` to four `..`. (`build.ts` itself
  resolves `meta-schema.json` from the runtime `registryRoot`, so it needed no
  change.)
- Two scripts deep-import core (not via the barrel): `scripts/build-index.ts`
  and `scripts/reset-dev-fresh.ts` repointed `core/src/build.js` →
  `core/src/registry/build.js`. (All other scripts use the `index.js` barrel.)

Verified: typecheck, 257 tests, knip, build all clean; `dist/registry/{labels,walk,meta,record}.js` materialized and the renderer resolves `@skills-bank/core/labels`.

> Lesson for remaining steps: grep `scripts/` for deep `core/src/<mod>.js`
> imports, and check moved files/tests for `__dirname`-relative repo-root paths.

## Verify (for the refactor)

`pnpm typecheck && pnpm test` — pure units (`classifySyncDisposition`,
`computeManifestRemovals`, `detectSyncOrphans`) table-test directly;
orchestrators test against a temp registry root. Then `pnpm start` to
exercise both sync paths + a label edit, and `pnpm knip` to catch the
now-dead main-local helpers.
