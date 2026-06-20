# Changelog

All notable changes to Skills Bank. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## v1.22.2

Bug-fix patch: a skill's `origin` is now kept truthful against the linked repo, clearing false `UNREACHABLE` badges and un-pullable personal skills.

### Fixed

- **`origin` now means exactly one thing — where the content currently lives and is re-fetched from.** It was overloaded as both ancestral provenance and the re-probe coordinate, and nothing re-pointed it when a skill's home changed. Two breakages followed: (1) a skill living in the linked repo but still pointing at the third-party repo it was first vendored from earned a **false `UNREACHABLE`** badge once that stale upstream removed/renamed the folder; (2) `resolveExportOrigin` synthesized self-origins as `skills/<bucket>/<name>/SKILL.md`, assuming the linked repo mirrors the local bucket layout — it doesn't, so ~20 personal skills carried fictional paths that 404 on a fresh clone.
- **`reconcileResidentOrigins` (`registry/reconcile.ts`) keeps it correct via one long-lived primitive, not a one-time migration.** For each skill whose folder leaf is present in the linked repo's tree, it rewrites the origin to a self-origin at the *real* path and clears any stale probe-failure counter. Idempotent; genuinely vendored skills are untouched. Runs wherever the linked tree is available — on push (preview + push **block** on a tree-fetch failure rather than reconcile from partial data) and after a link/sync.
- **Probe skips self-origin skills** (owned by manifest sync, not the third-party probe) via a new `linkedRepo` resolver; **`buildSkillFolderMap` (`github/origin.ts`)** builds a basename→real-path map from a repo tree, dropping ambiguous leaves; **`vendor-skill.ts`** emits the live `origin`/`vendored` vocabulary instead of the dead `upstream`/`bundled` keys.

### Notes

- No schema bump (manifest stays v5), no tolerant-read window, no migration branch. The field name/shape are unchanged — only the *values* written into `repo`/`skillPath` change. Existing bad data heals as a side effect of the reconcile primitive on the next push/sync.
- `zoom-out` is correctly left `UNREACHABLE` — it's genuinely vendored and upstream really did remove it (that signal feeds the separate drift/restore work in [#126](https://github.com/Tyler-Reagan/skills-bank/issues/126)).

## v1.22.1

Bug-fix patch: drifted skills can now be installed and managed.

### Fixed

- **Install and manage-links restored in drift states.** The `edited-with-origin` and `edited-without-origin` drawer states were left without `canInstall` or `canManageLinks` after v1.20 removed the drift-resolution heal actions. The only affordances visible were Export, Reveal in Finder, and Remove from registry — with no way to link the skill into agent dirs while drifted. Both states now follow the same pattern as `origin-unreachable` and `origin-update-available`: `canInstall: !hasAnyInstallation` / `canManageLinks: hasAnyInstallation`, and a dynamic primary (`"install"` when uninstalled, `"manage-links"` when installed). The static `primary: "manage-links"` that was left vestigial in both arms is replaced by the conditional. Six affected test cases updated; two new "with-installation" test cases added for parity with the `origin-unreachable` test pair.

### Notes

- Drift _resolution_ (rebaseline, keep-local/detach, reset-to-origin) remains absent — that is tracked separately in [#126](https://github.com/Tyler-Reagan/skills-bank/issues/126). This fix restores the install/manage-links affordances _while the skill is drifted_, orthogonal to the resolution redesign.

## v1.22.0

Keep-in-place registration. Custom directories become the home for non-egressable "keep in place" skills (issue #125): a skill discovered in a user custom directory — e.g. a work-org repo that can't be moved into the bank and has no GitHub origin — now registers **in place** by default, getting app-managed agent symlinks and labels without relocating its files, and is kept out of the synced manifest. Under the hood this splits the overloaded register primitive into two coherent ones. See [ADR-0011](docs/adr/ADR-0011-register-vs-move-into-bank-primitive-split.md).

### Changed

- **`register` is now record-only; `move-into-bank` is a separate primitive.** The old `RegistrationAction.register.adopt` boolean conflated "record in the registry" with "move files into `skills/<bucket>/`". `register` now only records (`adopted: false`, files stay put); the new `move-into-bank` action relocates + sweeps agent links. The renderer chains the two in one gesture when the **Settings** auto-move toggle (`registerAdopts`) is on **and** the skill isn't a custom-dir source — custom-dir provenance always keeps files in place. The chain predicate lives in one shared `useRegisterSkill` hook backing both inline call sites (per-card Register, drawer Register); bulk "Register All" routes through the row-based plan modal instead.
- **Custom-directory registration now works end-to-end.** `scanExistingInstalls` takes `{ customDirs }` and the `IPC.register`/`IPC.scan` handlers thread custom directories through, so a custom-dir skill's register action can actually locate its entry (previously it failed with "entry not found in scan"). A real directory whose realpath matches a registry entry is classified `ours`, so a registered in-place skill's own source no longer reads as a self-conflict.
- **In-place skills are excluded from the pushed manifest.** `exportRegistryManifest` filters out `adopted: false` entries — a non-egressable repo's skills are local-only and never travel via push/pull.
- **"Adopt" is now the explicit "Move into bank" drawer action.** Surfaced via a new `canMoveIntoBank` capability on a registered, in-place skill. The per-row plan modal (renamed `RegisterModal` → `RegistrationPlanModal`, scan fixed to include custom dirs) is now the single bulk-registration surface: **"Register All"** opens it from both the empty state and the Unregistered section header, and the inline per-card Register button stays the one-off path. (The empty state no longer has a separate "Scan for existing skills" button — it duplicated the header's Scan Local.)

### Removed

- **The `adopt` boolean — hard cut, no deprecation cycle.** `{adopt}` is an internal renderer↔main wire shape with no external SDK consumer, so it's deleted outright rather than carried for a minor cycle. On-disk `external.json` / `.skills-bank.json` shapes are unchanged.

## v1.21.0

Consolidation + cleanup release. The post-reorg core/desktop consolidation lands; `meta.json` is finally eliminated end-to-end; several orphaned code paths and stale decision records are culled; and the documentation surface — internal docs and the published site — is pruned and trued-up against the live app.

### Removed

- **`meta.json`, for real.** The v1.20 cull missed two stranded paths that kept writing it: the adopt-path synthesis in `adoptIntoRegistry`, and the `editTags` IPC. Both were inert (the index reads SKILL.md frontmatter; Registry cards already render labels-plane tags), yet both were UI-reachable. Removed end-to-end — core write, IPC channel/handler/preload, and the `export.ts` standalone allowance. The app now neither writes nor reads `meta.json`.
- **Orphaned Content (disk) registry import/merge.** `importRegistry` / `importRegistryMerge` / `importRegistryMergeApply` (IPC + `main.ts` handlers), `manifest/disk-import.ts` (`mergeImportRegistry` + `MergeImportReport`, hard-cut from the SDK surface), and the renderer `mergeConflict` modal + dead `AccountModal` props — all live in code but with no UI entry point. The live `bank:*Manifest*` transport and the shared `SyncConflictModal` were surgically preserved.
- **Orphaned `push.ts`** (`pushSkillFolder`) — imported but never called; no IPC, no UI. Leftover from the v1.20 publish cull.
- **Dead decision records** — ADR-0006 (fork), ADR-0007 (push-skill-folder), ADR-0008 (publish), and ADR-0010 (their removal tombstone). The features are gone; the removals live in this changelog.
- **`UBIQUITOUS_LANGUAGE.md`** retired — roughly a third documented the removed Publish/Fork/Safekeeping surface.
- **Eight zero-caller SDK exports** (deprecated in v1.20.3; one-minor window elapsed): `readSkillMdFrontmatter`, `previewDeleteUnregistered`, `groupDiagnosticsByCategory`, `getClaudeHome`, `getClaudeSkillsDir`, `loadIndex`, `readSkillRecord`, `writeSkillRecord`. Glue modules collapsed: `registry/record.ts` deleted, `hide.ts` → `canon.ts`, `manifest/reconcile.ts` → `import.ts`, `skill-state-server.ts` → `skills/classify.ts`.
- **Orphaned `docs/` cruft** — the unreferenced `docs/images/` tree (superseded by `packages/docs/public/images/`) and the shipped `docs/plans/manage-labels-modal.md`.

### Changed

- **Tag editing moved to the labels plane.** The card and drawer tag affordances now write `labels.json` via `updateLabel` instead of the inert `meta.json` path; the drawer's redundant standalone "Tags" section was removed (`DrawerLabelSection` owns label-tag editing).
- **`meta-schema` → `skill-frontmatter` naming.** `docs/meta-schema.json` → `docs/skill-frontmatter-schema.json`; the inlined `SKILL_META_SCHEMA` → `SKILL_FRONTMATTER_SCHEMA` (**direct rename, no compat alias** — no external callers); module `registry/meta.ts` → `registry/frontmatter.ts`; docs route `/reference/meta-schema` → `/reference/skill-metadata`. The accurate "metadata" data symbols (`SkillMeta`, `readSkillMeta`, `validateSkillMeta`) were left as-is.
- **Desktop consolidation** — dead-CSS sweep and renderer inventory truth-up.
- **Published docs site trued-up to the live app.** Code-grounded accuracy pass: removed stale CLI / publish / canon-drift references and the wrong tab name; fixed verbatim label mismatches (`Default install targets`, `Manage your registry`, `Delete from this machine`, `Unregister sends files to`, `Unregistered`, the adopt-setting label/group); trimmed the now-removed Content transport to Manifest-only. Internal `CLAUDE.md` cruft (the v0.11.3-era maintainer-heal section) trimmed.

### Notes

- **Heal** is unchanged: only the **drift-resolution** arm was removed back in v1.20; the bad-state heals (install collisions, broken-symlink repair, missing-entry "Forget") remain live. Restoring drift resolution with proper source-axis semantics is tracked separately.

## v1.20.5

Bug-fix release: third-party installs no longer masquerade as curated, and the test suite (red on `main` since the v1.20 test-subdir reorg) is green again.

### Fixed

- **Manifest import no longer mints `source: "curated"`.** Installing a third-party skill whose manifest claimed `curated` (e.g. `kubernetes-specialist`, `soultrace`) persisted that value verbatim via `stampOriginMarker`, surfacing a false **CURATED** badge on what are user-installed `vendored` skills. Per the `source.ts` doctrine, no runtime install/sync path may mint `curated` — that value is reserved for the maintainer's committed set, reached only via the first-launch seed and curated sync. Import now downgrades an incoming `curated`: github origin → `vendored`, self/none origin → `user`. The fix lives at the runtime boundary (not in `writeSkillSource`) because github-origin is not a valid discriminator — `find-skills` is legitimately curated _and_ github-origin; the true signal is curated-channel sync provenance (`syncedFromCommit`/`syncedAt`).
- **Self-heal for already-installed skills.** A new boot-time `healFalselyCuratedMarkers` pass repairs managed-registry markers matching the bug fingerprint (`curated` + github origin + no sync provenance), so a stale CURATED badge clears on the next launch. Seeded/synced curated skills carry sync stamps and are left untouched.
- **Test suite restored.** The v1.20 "organized test sub-dirs" reorg moved test files one level deeper without updating their relative paths, leaving the `registry/test/` suite unloadable and `pnpm typecheck` failing (CI doesn't run the suite, so it slipped through). Repaired 15 sibling imports (`./X.js` → `../X.js`) across 8 files and the `repoRoot` depth in `build.test.ts` / `meta.test.ts`.

## v1.20.4

Maintenance release: info tooltips no longer hide behind modals, modal internals tidied, and the maintenance-script surface consolidated.

### Fixed

- **Info tooltips no longer clipped.** `InfoTooltip`'s bubble was absolutely positioned, so any ancestor with `overflow: hidden`/`auto` (e.g. `.prefs-card`, `.modal-body`) clipped it — tooltips in the Settings and Account modals rendered hidden or cut off. The bubble now renders through a portal to `<body>`, positioned `fixed` from the icon's rect and lifted above the overlay layer, so it escapes all ancestor clipping.

### Changed

- **Modal cleanup.** `AccountModal` and `SettingsModal` internals refactored; `ModalHost` wiring simplified.
- **Maintenance-script surface consolidated** (root `package.json` scripts 24 → 14). The reset family collapsed to a single dev-only `reset` (the former `reset`/`reset:hard`/`reset:seed` and the two bash reset scripts removed). The provenance/vendoring scripts (`vendor:skill`, `vendor:refresh`, `backfill:bundled`, `discover:bundled`, `update:skill`) unified under one `pnpm bank <command>` dispatcher. Unused `package:*` and `docs:build`/`docs:preview` aliases dropped — release packaging and Vercel invoke their tools directly. A new `SCRIPTS.md` documents the surface.

### Removed

- **Dead scripts and artifacts:** the orphaned `backfill-deployed-upstream.ts`, the `reset-desktop-config.ts` / `seed-source-markers.ts` reset helpers, the bash `skills-bank-full-reset` / `skills-bank-partial-reset` scripts, and stale `packages/cli` build artifacts.

## v1.20.3

Core cleanup release: frontmatter parsing consolidated into one superset parser (fixing a latent block-scalar bug), dead SDK exports deprecated, and a persistent core inventory doc.

### Fixed

- **One frontmatter parser.** Core had two partial parsers — `registry.ts`'s handled block scalars and proper quoted-scalar escape resolution; `skill-meta.ts`'s handled inline/block tag arrays and comments but returned a literal `"|"` for block-scalar descriptions and used a blanket quote-strip. `parseSkillFrontmatter` is now the single superset parser used by validation, index building, and `readSkillMeta`. The bug was latent (no committed skill uses block scalars), but the first `description: |` would have validated and indexed as `"|"`.

### Deprecated

- **Eight exports with zero callers**, removal at the next minor per the post-1.0 convention: `readSkillMdFrontmatter` (use `parseSkillFrontmatter`), `previewDeleteUnregistered`, `groupDiagnosticsByCategory`, `getClaudeHome`, `getClaudeSkillsDir` (CLI-era leftovers), `loadIndex`, `readSkillRecord`, `writeSkillRecord`.

### Added

- **`packages/core/src/INVENTORY.md`** — persistent reference of all 40 core modules (LOC, purpose, consumers, tests), package conventions (SDK surface, renderer-safe subpaths, ADR-0002 sidecar trio), and layering maps. Repo-internal, like the renderer inventory.

### Changed

- Stale docs fixed: `build.ts` no longer documents walking `meta.json` (frontmatter canonical since v1.20); `manifest.ts` no longer claims `deriveLabels` runs at registration (on-demand since v1.19).

## v1.20.2

Renderer pruning release: 52 → 43 component files (net −1,170 lines), the conflict resolvers converged on one skeleton, a CSS orphan sweep, and one small behavior change — Manage agent links only appears once a skill is actually installed.

### Changed

- **Manage agent links requires an installation.** A registered skill with zero installations now offers **Install** as the entry point; Manage agent links appears once links exist. The `origin-unreachable` / `origin-update-available` drawer states gate the same way, offering Install instead when uninstalled.

- **Conflict resolvers converged.** The sync-collision, install-collision, and manifest-merge resolvers — previously three structural clones — now share one generic `ConflictResolver` skeleton (bulk toolbar, per-row action picker, live tally, footer) with thin domain wrappers. Two minor UI unifications: install-collision rows use the shared row styling and its tally moved into the bulk toolbar.

- **Renderer component consolidation.** Five stateless micro-components gathered into `primitives.tsx`; `TagFilter`, `DiscoverEmpty`, and `ImportIndicator` folded into their single parents; the manifest feature cluster grouped under `components/manifest/`; `DrawerHost` (pure glue) folded into `ModalHost`.

- **Component renames** (internal): `ConflictResolutionModal` → `SyncConflictModal`, `ConflictResolveModal` → `InstallCollisionModal`, `DeleteUnregisteredConfirm` → `DeleteUnregisteredDialog`, SkillCard's `PublishBadge` → `StateBadge`.

### Removed

- **67 orphaned CSS classes** (~550 lines) — leftovers from the removed publish section, fork confirm, LoginScreen/setup screens, the retired header dropdown, and v1.19's bulk-install bar.
- Dead `isRegistered` prop chain in `SkillCard`/`StateBadge`.

### Added

- **`src/renderer/INVENTORY.md`** — persistent internal reference of every renderer component, hook, and context (LOC, purpose, consumers), freshness-stamped per commit. Not published to the docs site.

## v1.20.1

Patch release: a pull from a linked repo with zero remote changes no longer fails with "&lt;repo&gt; has no skills the app can recognize".

### Fixed

- **No-op linked-repo pull misreported as an error.** Since v1.13.2's unchanged-hash skip, a pull where every skill already matched its local content hash returned zero upserts — and `replaceRegistryWithRepo` read "0 upserted + 0 conflicts" as "the repo has no recognizable skills". `SyncReport` gains an `unchanged: string[]` field (the hash-skip reports what it skipped; `readLastSyncReport` tolerant-reads older persisted reports), and an all-unchanged pull now succeeds with "&lt;repo&gt; is already up to date (N skill(s) unchanged)". The no-skills error fires only when discovery genuinely finds nothing. Not a v1.20.0 regression — reproduced identically on v1.19.0; the v1.20.0 auto-update timing was coincidental.

- **Stale error copy.** Dropped "or meta.json" from the no-skills message (meta.json was removed in v1.20.0).

### CI

- `pnpm run test` added to `ci.yml` (#113) — the workflow never ran the vitest suite despite CLAUDE.md documenting it, which is how #112 merged with 9 red tests.

## v1.20.0

Paradigm-enforcement cull: the source axis is now enforced end-to-end, the install domain is recomposed into orthogonal primitives, and the stale heal/fork/publish surface, meta.json shims, and CLI package are removed. Net −3,847 lines. See [ADR-0010](docs/adr/ADR-0010-heal-fork-publish-removed.md).

### Added

- **`"vendored"` source value.** Third-party Discover tab installs stamp `source: "vendored"`; `"curated"` is reserved exclusively for committed `.skills-bank.json` files — no runtime install or sync path may produce it for new skills. The sync path preserves existing `"curated"` on bundled skills and stamps `"vendored"` for non-curated vendored syncs.

- **`pnpm reset:fresh`.** Packaged-first-install simulation for `pnpm dev`/`pnpm start`: cleans untracked app-installed skills, reverts runtime-modified sidecars, wipes `~/.skills-bank-dev/`, seeds an isolated managed registry with the committed curated skills, and pre-writes `config.json`. Next boot shows find-skills with no conflicts.

- **[ADR-0010](docs/adr/ADR-0010-heal-fork-publish-removed.md)** — records the heal/fork/publish removal decision; supersedes ADR-0006.

### Changed

- **Install domain primitives renamed and recomposed.** `mirrorSkillFolder` → `installSkillFiles` (idempotent — skips when the destination is non-empty); `installSkill` → `linkSkillToAgents` (direct skillPath, explicit `agents[]`); `uninstallSkill` → `unlinkSkillFromAgents`. Browse Install now composes `installSkillFiles` + `linkSkillToAgents` with the default on-disk agents.

- **Discover tab installs go direct to the agent dir.** The `installSkillFromGithub` IPC now writes GitHub → `~/.agents/skills/<name>` via `installSkillFiles` — no bank entry, no symlinks — producing the same "unregistered" state in the Installed tab as a terminal install outside the app.

- **Discover install feedback** is an inline dismissable banner in the discover-callout area (above the WebContentsView, never behind it) instead of a toast.

### Removed

- **Heal/fork/publish surface** (ADR-0010): `fork.ts`, `publish-classify.ts`, `publish-state.ts`, their tests, and `PublishSection.tsx`; all associated IPC handlers, preload exports, channel constants, interface methods, and capabilities (`canAcceptDrift`, `canTakeCanonical`, `canResetToOrigin`); heal action functions (`keepLocalDetach`, `unlinkOrigin`, `flipSourceToUser`, `rebaselineHash`); the drift badge on `SkillCard`. The concept is intentionally cleared for redesign with proper source-axis semantics.

- **meta.json, fully** (no backward compat): all tag-preservation shims (`readMetaTags`, `writeMetaTags`, `readMetaTagsFromSkillDir`, `restoreMetaTags`, `synthesizeMetaJson`, `synthesizeSkillMeta`) — SKILL.md frontmatter has been canonical since v1.15. The retired one-shot migration scripts (`migrate-meta-to-frontmatter.ts`, `migrate-source-markers.ts`) are deleted along with the stale `skills/personal/gh-cli/meta.json` artifact.

- **`packages/cli`** deleted entirely — the desktop app is the product.

- **Dead IPC**: the `deregister` chain (superseded by `unregister → deleteUnregistered`) and the `exportRegistry` zip chain (deprecated v1.1; manifest export is the live path). Also `InstallFromGithubModal.tsx` (already unwired — no trigger existed) and the `install-from-github.ts` core function + tests.

### Fixed

- **Discover tab `submitInstall` silently swallowed IPC rejections** — missing `catch` block added; the `installSkillFromGithub` IPC handler is wrapped in `try/catch` and returns `mirror-failed` instead of propagating unexpected throws.

- **Discover-installed skills no longer masquerade as "Curated"** — they previously stamped `source: "curated"` and rendered the Curated badge as if they were app-curated content.

- **Core test suite re-pinned to the new contracts.** The refactor landed with 9 stale tests red (CI runs typecheck/build, not `pnpm test`): the `installSkillFiles` partial-failure invariant tests now pass `force: true` past the new idempotency guard (which gets its own pinning test), and the `applyCanonicalSync` tests assert the never-mint-new-curated rule and the removal of the meta.json tag splice.

- **Docs and comments swept for staleness.** Docs site: CLI page + nav removed; Discover install guide rewritten for the direct-to-agent-dir flow; heal guide drops the removed drift-heal arms; concepts updated to the three-value source axis, current card badges, v5 manifest fields, and the Publish/Fork/Safekeeping sections removed; meta.json migration section removed. ADR-0006/0007/0008 stamped Superseded by ADR-0010. Stale code comments fixed (old primitive names, removed heal/publish references); dead `missing-meta-json` branches in `update:skill` and the orphaned `ghRateLimit.ts` deleted; UpdatesModal hint no longer points at the removed drift heal flow.

## v1.19.0

Labels are now fully user-driven, with a new registry-wide Manage Labels modal and a bulk Install Skills modal replacing the inline select-mode bar.

### Added

- **Manage Labels modal.** A "Manage Labels" button in the Registry toolbar opens a 720 px modal for registry-wide label management. The browse phase shows every skill with its current category and tags, with search, category filter (select), tags filter (searchable multi-select with selected items floated to top), and four sort modes. Inline editing per row: click the category badge/placeholder for an in-place select; tag chips have × remove buttons; + appends a tag inline. Select all or a subset → Actions → **Clear labels** (confirm-gated). An **Open skill [↗]** button (hover-revealed) opens the skill's detail drawer elevated above the modal, so label edits from the drawer reflect immediately on close.

- **Auto-Generate Labels flow.** Inside Manage Labels, **✦ Auto-Generate Labels…** launches a 3-step in-place flow: (1) scope — both / categories only / tags only; (2) skills — all or select from a searchable checklist; (3) review — per-skill diff with row checkboxes (all checked by default), partial apply ("Apply 2 of 4"), "Discard changes" exits without writing, "Run again" restarts. An undismissable applying spinner phase covers the write.

- **Install Skills modal.** Replaces the inline bulk-install select bar. Opens from a "Install Skills" button in the Registry toolbar. Filter by install status (Not installed / Installed / All), search by name, see labels per row. Per-row progress during install (pending / installing / done / failed) with cancel-remaining support. Done summary shows succeeded count and any failure reasons.

- **`bulkUpdateLabels` IPC channel.** Writes N label overrides in a single file round-trip, used by the Auto-Generate apply phase.

- **`LabelsContext`.** Replaces the `onLabelsChanged` / `labelsRefreshKey` prop chain with a shared React context (`{ labelsMap, reload }`). Any label write calls `reload()` once; BrowseTab, DrawerLabelSection, and ManageLabelsModal all subscribe and stay in sync automatically. Eliminates the stale-modal bug where label edits in the drawer were not reflected in the modal.

### Changed

- **Labels are fully user-driven.** `deriveLabels` no longer runs automatically at render time, manifest export, or manifest import. It runs only when the user explicitly triggers Auto-Generate or the per-skill Auto Categorize button. Skills with no labels assigned appear under Uncategorized. Manifests export only user-set labels; importing a manifest with empty labels is a no-op for `labels.json`.

- **`SkillLabelOverride` simplified.** `categorySource` and `rejectedTags` removed — both were vestigial after the model change. `addedTags` renamed to `tags` for symmetry with `category`. A tolerant read in `readLabelsFile` migrates legacy `addedTags` entries on first load.

- **Browse toolbar layout.** Results count and Expand/Collapse all moved to the left group (view state). Manage Labels and Install Skills sit on the right (actions). Buttons in the right group now use `row-center-8` (packed) instead of `row-between-8` (spread).

- **Drawer Escape layering.** When the detail drawer is open above the Manage Labels modal, the modal's Escape handler is suppressed (`drawerOpen` prop withholds `onClose` from `useEscapeToClose`). Escape closes the drawer first; a second Escape closes the modal.

- **Category cell affordance in Manage Labels.** When a category is set, hovering reveals a `▾` chevron signalling "dropdown". When empty, hovering shows a "Set category" ghost text replacing the static em dash.

- **BulkInstallState, selectMode, and BulkInstallBar removed from BrowseTab.** The inline select flow and its associated App-level `runBulkInstall` callback are replaced by the Install Skills modal.

### Fixed

- **Toolbar button group layout.** Right-side button group used `row-between-8` (`justify-content: space-between`), spreading Manage Labels, Expand/Collapse, and Bulk Install across the full width. Corrected to `row-center-8`.

## v1.18.0

Registry manifest schema → v5: each per-skill record now carries effective curation labels (category + tags) and a re-fetchable origin for authored-here skills, and `bucket` is derived from origin. Sharpens the git-flow so a pull reconstructs the full registry — content, placement, and curation — from the manifest alone.

### Added

- **Effective labels in the manifest.** Each entry records its `category` (single value from the labels taxonomy) and `tags`, computed as `effectiveLabels(deriveLabels(name, description), labels.json override)` at export. The manifest previously read `tags` from `meta.json` (always empty); it now reflects the same auto-derive-then-user-maintain labels pipeline the app UI uses. On pull, `importRegistryManifest` reconstructs the minimal `SkillLabelOverride` per skill and the desktop app merges it into the local `labels.json`, so curation round-trips across machines.
- **Self-origin for authored-here skills.** An authored skill whose marker is `none` now gets a synthesized self-origin (`kind: "github"`, `repo` = the active linked repo, `skillPath` = its in-registry path) on export when a repo is linked — so it is re-fetchable on pull from the same repo its content commits to, rather than failing as `origin-unreachable`. With no repo linked it stays `none` (untracked until pushed). A new `isSelfOrigin` helper is the single mechanism bucket derivation (and future scan/sync flows) share for the "is this mine?" decision.

### Changed

- **Manifest schema → v5.** `ManifestSkill` drops the duplicated, always-empty `dismissed`/`hidden` booleans and adds `category: string | null`; `tags` is now populated from the labels system. **`bucket` is derived from origin** at export (external GitHub origin → `vendored`; self-origin or no origin → `personal`) rather than read from disk. v2/v3/v4 manifests coerce up through the single `coerceManifestToCurrent` chokepoint (legacy `dismissed`/`hidden` dropped, `category` defaulted to `null`); v1 remains unreadable. `diffManifests` now compares `category`/`tags` as shared curation intent.
- **Import no longer writes `meta.json`.** SKILL.md frontmatter has been the authoritative metadata source since v1.15; the import path now relies on the mirrored frontmatter alone and writes no `meta.json`, dropping the disconnected hand-rolled write that predated the frontmatter migration.

## v1.17.0

Multi-master registry sync: the linked repo's `registry-manifest.json` now behaves like git-versioned state. Pull is a three-way merge that preserves intentional divergence; push refuses to clobber a diverged remote. Fixes the cross-machine bug where one host's push silently deleted every skill another host had authored. See [ADR-0009](docs/adr/ADR-0009-multi-master-manifest-merge.md).

### Added

- **Three-way manifest merge on pull.** "Read from repo" is now **Pull & merge** (`mergeManifests(base, ours, theirs)`). A clean merge reconciles locally; genuine divergence (both sides changed a skill differently, or one edited while the other deleted) surfaces in a new **manifest-conflict resolver modal** with per-skill arms: keep mine / use theirs / keep both (fork the local copy to `<name>-local`). Conflicts persist to `pending-manifest-conflicts.json` so the resolver survives a restart.
- **Merge base.** A per-machine remote-tracking reference for the linked repo's manifest, advanced after every successful sync, so the merge can distinguish "I changed this" from "they changed this."
- **Confirmed-removal arm.** Reconcile now propagates deletions (a skill dropped from the merged manifest is removed locally), where the old import was additive-only. The broad import paths (disk import, account restore) stay strictly additive.

### Changed

- **Manifest schema → v4 with a canonical committed form.** `serializeManifest` writes the linked-repo file sorted with stable keys and **without** the volatile/local fields `exportedAt` and `lastInstalledOn`, so a no-op re-push produces no diff. The full-fidelity form (with those fields) is retained by the disk export and userData snapshots. v2/v3 manifests coerce up; v1 remains unreadable.
- **Push is non-fast-forward-guarded.** A direct push to the linked repo refuses when the remote's manifest no longer matches the local merge base — i.e. it changed since this machine last synced — and tells you to pull & merge first. Pushes the canonical merged manifest and advances the base on success.

### Fixed

- **Frontmatter quote-unescaping** (`registry.ts`). A description authored as a double-quoted YAML scalar with escaped inner quotes (e.g. `"… \"board not found\" …"`) kept its backslashes and re-serialized as a double-escaped `\\\"` (the `zmk-debug` regression). Double-quoted scalars now resolve `\"`/`\\`/`\n` etc.; single-quoted resolve `''`→`'`; plain scalars containing quotes keep them verbatim. (Block scalars `|`/`>`/`>-`/`|-` were already handled in #84.)
- **Stale synced-hash assertion** in `install-from-github.test.ts` that was red on `main` — the sidecar stores the local SHA-256, not the GitHub tree SHA.

## v1.16.0

Install skills directly from the Discover tab, tag inference wired end-to-end, Browse UX polish, and a drift false-positive fix for GitHub-installed skills.

### Added

- **Install from Discover tab.** The Discover tab callout now has an inline URL/command input. Paste either an `npx skills add <url> --skill <name>` command (the format skills.sh copies to the clipboard) or a raw GitHub folder URL — the app parses either, fetches the skill, and adds it to your bank without opening a terminal. On success the existing flash banner confirms the skill name and prompts you to find it in Browse to install.
- **Expand / Collapse All in Browse.** A chevron-prefixed "Collapse all" / "Expand all" button appears in the results row whenever two or more category sections are visible. The chevron rotates to reflect the current state.

### Changed

- **Auto-derived tags now surface everywhere tags are used.** Previously, `deriveLabels` computed tags but only the drawer consumed them — the Browse filter panel, tag search, and skill cards all still read raw `tags` from the registry entry (frontmatter-only). Now an `effectiveTagsMap` is computed once per render (derived + user overrides) and flows through to `TagFilter`, `applyFilters`, and `SkillCard`. Skills with no explicit `tags:` frontmatter now show their inferred tags on cards and participate in tag filtering.
- **"Install a skill from GitHub" moved out of Settings.** The Settings modal section and its button are removed. The action now lives inline on the Discover tab (see above), where it belongs in the workflow.
- **Tag filter dropdown polish.** A border separator between the panel header and the tag list; count badges are now pill-shaped with a tinted background; the active-item indicator is a left accent bar rather than a full perimeter border.
- **Skill card tag chips compacted.** Tags render at 10 px in a borderless tight-pill style (`color-mix` neutral tint, no border, 4 px border-radius) instead of the previous 11 px bordered pill. Compact-density mode shaves one more pixel of vertical padding.

### Fixed

- **False-positive drift on every GitHub-installed skill.** `installSkillFromGithub` was storing the git tree SHA-1 (from the GitHub Trees API) as the `.skills-bank-hash` baseline, but drift detection compares against `hashSkillFolder`'s local content hash — two different algorithms that never match. The baseline is now written with `hashSkillFolder` after the files land on disk, consistent with how `sync` and `merge` baseline their skills.
- **Repo picker list items flowing inline.** `.repo-picker-item` had no base CSS rule, so `<button>` elements defaulted to `display: inline-block` and rendered horizontally. A base rule (`display: block; width: 100%`) corrects the layout.

## v1.15.0

SKILL.md YAML frontmatter becomes the single source of skill metadata, and the drift detector stops flagging skills that install dependencies into their own folder.

### Added

- **SKILL.md YAML frontmatter as the metadata source.** A skill's `name` / `description` / etc. now live in the SKILL.md frontmatter; `meta.json` is synthesized on demand from it for mirrored skills that don't ship one. A `migrate-meta-to-frontmatter` script folds existing `meta.json` files into frontmatter. (#106)

### Changed

- **Frontmatter is now the _sole_ metadata source — the `meta.json` tolerant-read shim is removed.** Skills are read from SKILL.md frontmatter only; the `meta.json` fallback for unmigrated skills is gone. (#107)

### Fixed

- **Drift hash honors the skill's `.gitignore`.** `hashSkillFolder` now excludes paths a skill declares ignorable (e.g. `node_modules/`, build/test output), so a skill that installs dependencies or writes artifacts into its own folder at runtime no longer shows up as "edited". Pruning ignored directories also keeps a heavy `node_modules/` from tripping the 8 MB hash budget. (#108)

## v1.14.0

Two-tier skill labeling: every skill now has a category and zero-or-more tags, derived automatically from its name and description and fully overridable per-skill from the detail drawer.

### Added

- **Category grouping in Browse.** Skills are organized into collapsible sections — one per inferred or user-set category — ordered by a fixed priority list (frontend → backend → infrastructure → … → hardware), with an Uncategorized section at the end. Sections expand and collapse in-session.
- **Tag and category inference engine** (`packages/core/src/labels.ts`). A pure `deriveLabels` function tokenizes each skill's name + description and applies 15 category rules (first-match) and 34 tag rules (all-match). Categories include: frontend, backend, infrastructure, testing, writing, product, ai-tooling, design, dx, git, data, security, mobile, research, hardware. Tags include: react, vue, svelte, typescript, python, golang, rust, node, css, next, vite, electron, flutter, react-native, cli, mcp, terraform, github, gitlab, docker, docs, api, graphql, ui, testing, e2e, review, refactor, naming, diagrams, design-system, seo, sql, branding.
- **Label overrides persisted in `labels.json`** (userData). The `effectiveLabels` function merges user overrides onto auto-derived values: user-set category replaces derived; tags = (derived − rejected) ∪ added. Three IPC channels back it: `labels:read`, `labels:update` (merge-patch), `labels:reset` (per-skill delete).
- **Label editing in the detail drawer** (`DrawerLabelSection`). Category `<select>` with all 15 options, tag chips with per-chip remove (auto-derived chips reject on ✕, user-added chips remove), inline add-tag input with `<datalist>` suggestions from the tag rules, and a rejected-tags row with click-to-restore.
- **Label review session.** The Browse tab shows a first-run banner ("Review labels") the first time the app runs with labels enabled. Clicking it opens a sequenced review flow through the visible registry: a progress bar in the drawer header shows "X / N", Prev/Next navigate between skills, and Exit ends the session. The banner is dismissed permanently via the `__meta` key in `labels.json`.
- **Auto-derive on register.** When skills are registered via the Register modal, each newly registered skill with no existing override has its auto-derived category seeded into `labels.json` (`categorySource: "auto"`), so it lands in the correct section immediately.
- **Docs reference page** (`/reference/labels`) listing all 15 categories and 34 tags with descriptions. (#105)

### Fixed

- `categoryDisplayName` helper ensures "AI Tooling" and "DX" render with correct capitalisation rather than "Ai Tooling" / "Dx". (#105)

## v1.13.0

Expandable detail views for the sync banner and the manifest diff, plus a renderer-internal cleanup pass — lifecycle hooks, a modal router, and wider `useIpcQuery` adoption.

### Added

- **SyncBanner expandable details + auto-fade.** A successful sync banner now carries a "Details" disclosure that lists which skills were updated and which are no longer in the source repo, and it self-dismisses after 5s — paused while hovered, focused, or expanded, and instant under `prefers-reduced-motion`. Error and pending-conflict banners stay put (they're actionable). (#90)
- **Manifest diff per-category detail.** Each `DiffTable` category — Added / Removed / Changed / Unchanged — is now a disclosure row that expands to list the skills in it. (#90)

### Changed (internal)

- **`SyncStatus.done.upserted` and `ManifestDiff.unchanged` now carry skill names** (`string[]`) rather than just counts, feeding the new detail views; `manifest-diff` reports `unchanged` as names like the other three axes. (#90)
- **`useModalRouter`** consolidates ~18 scattered modal-state variables in `AppContent` into a single `ActiveModal` discriminated union — "two navigation modals open at once" is now unrepresentable. The drawer, the sync-triggered conflict resolver, and the bulk resolve-all flow stay separate by design. (#98)
- **Lifecycle hooks `useSyncFeed` / `useUpdateFeed` / `useManifestImportProgress`** pull the boot + subscription effects (sync feed, auto-update feed + badge derivation, manifest-import progress) out of `App.tsx`, each owning its full boot-load → subscription → derived-state lifecycle. (#93)
- **Shared `SkillTagList` / `DisclosureChevron` / `useDisclosure` primitives + a `useAutoDismiss` hook** back the expand/auto-fade UI; `SyncBanner` is decomposed into per-state sub-components. (#90)
- **`useIpcQuery` adopted in `SettingsModal`, `ConflictResolutionModal`, and `RepoTransport`'s preview fetch**, removing the remaining hand-rolled mount-fetch effects. A `rateLimitReached` helper centralizes the GitHub rate-limit message prefix. (#91)

### Fixed

- **Pre-existing prettier drift in `main.ts`** (`runManifestImportCore` signature) that was failing `format:check` on `main`. (#91)

## v1.12.0

Manifest linked-repo transport: push and pull `registry-manifest.json` directly to and from your linked GitHub repo without leaving the app.

### Added

- **Manifest push/pull via GitHub repo.** Export manifest now offers a two-phase repo transport alongside the existing file dialog: preview shows a diff table (added / removed / changed / unchanged skill counts) against whatever is currently in the repo, then a single click commits `registry-manifest.json` directly to your linked repo's default branch. A "Open as pull request" toggle routes the write to a stable `manifest/registry-manifest` branch and opens (or appends to) a PR instead of a direct commit. The result phase shows the short commit SHA and a "View on GitHub" link.
- **Manifest import from repo.** Import manifest shows the same diff-preview against your local registry before fetching. The "not found" state surfaces a friendly message when no manifest exists in the repo yet. Cancel and in-progress states use the same flow as the existing disk import.
- **`ManifestModal`** replaces the raw dialog calls in `AccountModal`. Renders the appropriate transport automatically: repo transport when a linked repo is configured (default), with a "Use a file" toggle to fall back to the disk dialog. No linked repo → disk-only, no toggle shown.
- **`github-files.ts` core primitives** (`readRepoFile`, `writeRepoFile`, `writeRepoFileAsBranch`) built on `ghFetch` — Contents API read/write without shelling out to git.
- **`diffManifests`** (`manifest-diff.ts`) — pure diff of two `RegistryManifest` values by skill name, comparing source / origin / tags / hidden / dismissed axes.
- **`defaultBranch` stored at link time** so push and read operations target the repo's actual default branch instead of hardcoding `"main"`.

### Fixed

- **`ManifestSkill.description` restored.** The v3 manifest schema was missing the `description` field that v1.5.1-exported manifests carried; exports now include it again. Import logic is unaffected (description is informational only).

## v1.11.2

Internal-refactor release. Closes the four-MR component-redundancy housekeeping branch. No user-visible feature changes; one small visual convergence in the install-collision picker rows.

### Changed (internal)

- **Unified modal chrome behind a single `<Modal>` wrapper** (`modalStyles.tsx`). Owns scrim + dialog body + click-outside dismiss + focus return + Escape + initial focus + opt-in focus trap + auto-registration with a new `ModalRegistryContext`. Migrated 14 centered modals + `PublishSection`'s ForkConfirmModal; each lost its local `overlay` / `modal` / `closeBtn` style blocks and its three chrome-hook calls. `App.tsx`'s 20-line `modalOpen` OR-chain that drove `discoverHideSync()` collapsed to `useAnyModalOpen()` — new modals participate automatically, no opt-in step that can be forgotten. (#85)
- **Extracted `<BulkSelectToolbar>` + `<ConflictActionPicker>`** shared by `ConflictResolutionModal` and `ConflictResolveModal`. The v1.11.0 / v1.11.1 drift between these two modals (one got the "Select all:" treatment, the other didn't; one got the language overhaul, the other didn't) becomes structurally impossible to repeat. Picker rows in `ConflictResolveModal` converged on the slightly-more-generous padding/font sizes already used by `ConflictResolutionModal`. (#86)
- **Introduced `useIpcQuery` hook** wrapping the cancellation-aware `useEffect → window.skillsBank.foo() → setState → catch` boilerplate that appeared five times across `SkillDetailDrawer`, `PublishSection`, and `RepoPickerModal`. (#87)
- **Lifted settings + registry state into dedicated contexts.** New `SettingsContext` owns `AppSettings` + `saveSettings` + `theme` + `density` + the dataset-write side effects. New `RegistryContext` (depending on `SettingsContext` for `customSkillsDirs`) owns `registry` + `installed` + derived maps + `refresh` / `rebuild` / `mutateRegistry`. App.tsx dropped 13 `useState` calls, 4 dataset-write `useEffect`s, and the local `saveSettings` / `refresh` / `rebuild` callbacks — net 129 lines lighter. (#88)

### Fixed

- **`saveCardTags` optimistic-paint flow** now reconciles through the new `RegistryContext.mutateRegistry` primitive instead of an inline `setRegistry` call. Behavior identical; the raw setter is no longer exposed on the context surface. (#88)

### Audited (no changes)

- All 7 `key={i}` sites in the renderer are correct: every one is in a static-list / never-reorder context (skeleton placeholders, immutable warnings/errors from a single render, diff line spans). Two were false positives — `i` was a variable named for "installation," not an array index.
- Both `eslint-disable react-hooks/exhaustive-deps` directives carry inline justifications and are correct uses of the escape hatch.

## v1.11.1

Bug-fix release. Restores click-outside dismiss, hides the embedded skills.sh browser for every modal, aligns Register's agent fan-out with Install, finishes the v1.11.0 bulk-toolbar treatment on the sync conflict modal, and lands the docs site as the canonical source of truth.

### Fixed

- **Click-outside dismiss restored on 14 modals** plus the `PublishSection` fork prompt: `AccountModal`, `SettingsModal`, `RepoPickerModal`, `ManifestImportConfirmModal`, `InstallFromGithubModal`, `InstallConflictModal`, `ConflictResolutionModal`, `ConflictResolveModal`, `RegisterModal`, `ManageLinksModal`, `UpdatesModal`, `UpdateNotesModal`, `DeleteUnregisteredConfirm`, `ConnectGithubModal`. Matches the existing `ConfirmDialog` / `DestinationPickerDialog` / `KeyboardShortcutsOverlay` pattern (overlay `onClick={onClose}` + child `stopPropagation`).
- **Embedded skills.sh browser occluding modals** (`App.tsx`). The `modalOpen` OR-chain driving `discoverHideSync()` was missing `installConflict`, `manifestImportHints`, `showUpdatesModal`, `showInstallFromGithub`, and `isUpdateModalOpen` — opening any of them (most visibly the Updates modal from the Rescan-done badge) left the WebContentsView rendering above the scrim.
- **Install vs Register agent set divergence**. The `InstallConflictModal` force-install path no longer falls through to "every existing agent dir"; it threads `settings.defaultInstallAgents` like every other install entry point. `RegistrationAction.register` gained an optional `agents?: AgentId[]`; when set with `adopt: true`, `applyRegistration` calls `setAgentLinks` post-adopt so Register lands the skill in exactly the agent set Install would have. Wired through `DrawerHost` and `RegisterModal` (new `defaultInstallAgents` prop).
- **`ConflictResolutionModal` bulk-select strip** missed the v1.11.0 toolbar treatment that `ConflictResolveModal` received. Applied the same "Select all:" labelled strip (subtle surface + border, compact labels, smaller font) so the bulk shortcuts no longer compete visually with Apply.

### Docs

- **Vercel deployment for `packages/docs/`** (`vercel.json`, Root-Directory + workspace-install configuration). The VitePress docs site now ships at [skills-bank-desktop.vercel.app](https://skills-bank-desktop.vercel.app/).
- **Docs site is the source of truth.** Deleted the diverged repo-root `docs/concepts.md`, `getting-started.md`, `keyboard.md`, `self-host.md`, `troubleshooting.md`, `user-guide.md` and the retired `TAXONOMY_ALIGNMENT_PLAN.md`. README and the desktop app's `SELF_HOST_URL` now point at the live site. Added `cleanUrls: true` to `vercel.json` so deep-links like `/concepts` stop 404'ing.

## v1.11.0

VitePress docs site, sync conflict modal language overhaul, install collision modal UI polish, and a full screenshot refresh.

### Added

- **VitePress docs site** (`packages/docs`). Fourteen pages covering Getting Started, Concepts, Guides (install, register, manage links, sync, sign in, heal, unregister), Reference (CLI, keyboard shortcuts, meta.json schema, troubleshooting), and Self-hosting. Hot-reloads via `pnpm docs:dev`; builds to `packages/docs/dist/` via `pnpm docs:build`.

### Changed

- **Sync conflict modal language** (`ConflictResolutionModal.tsx`). Title changed from "Sync conflicts" to "Incoming update conflicts". Actions renamed: "Keep mine", "Use incoming (replaces mine)", "Rename mine to `<name>-local`". Bulk button "Use all curated" → "Use all incoming". Diff toggle "Show diff (mine → curated)" → "Compare changes". "Apply & re-sync" → "Apply".
- **Install collision modal bulk-select** (`ConflictResolveModal.tsx`). Three bare buttons (Replace / Keep / Delete) reformatted into a labelled "Select all:" toolbar strip with consistent sizing and danger-colour scoping on Delete.
- **First-launch copy in Getting Started** (`packages/docs/getting-started.md`). Removed stale two-option picker description (LoginScreen retired in Phase 2); replaced with accurate single-sentence boot description.

### Fixed

- **Six doc inaccuracies** across `guides/sync.md`, `guides/sign-in.md`, `guides/heal.md`, `guides/install.md`, and `cli.md`: button labels, badge names, modal titles, and removed-command desktop equivalents.
- **Account panel "Refresh from repo" button** (`guides/sign-in.md`). Clarified that the canonical pull action is the **Pull from `<repo>`** header button; Account panel linked-repo row is a status display, not a button.

### Docs

- All screenshots replaced with current captures: registry, installed, skill detail (default, user-authored, collision), manage-links, settings (Default install agents), account, resolve-conflict.
- Added `account.png` (previously missing). Removed `setup.png` and `skill-detail-unregistered.png` (no longer referenced).

## v1.10.3

Four fixes: curated skills falsely flagged as orphaned on linked-repo pulls, tab-intro bottom margin halved, `Tyler-Reagan/skills-bank` removed as the recommended registry repo target, and the CSS margin change.

### Fixed

- **Curated skills falsely flagged as "no longer in source repo"** (`packages/core/src/sync.ts`). Orphan detection was keyed on `syncedFromCommit` presence alone, so curated skills like `find-skills` (which carry `source: "curated"` + `syncedFromCommit` from the bundled sync) were reported as orphaned when pulling from a linked repo that doesn't include them. Fix: scope the check to the current sync channel — curated syncs only orphan `source: "curated"` skills; linked-repo syncs only orphan `source: "user"` skills.
- **`Tyler-Reagan/skills-bank` surfaced as recommended registry repo** (`packages/desktop/src/renderer/components/RepoPickerModal.tsx`). The repo picker injected the app's own source repo as a pinned "Recommended" row. Users should link their own skills repo; the curated set ships with the app and needs no GitHub link.
- **Tab-intro bottom margin** (`packages/desktop/src/renderer/styles.css`). Reduced from `--s5` (20px) to 10px.

## v1.10.2

Three bug fixes: manifest import falsely flagging every skill as edited, local scan results not updating the installed list, and orphaned skill names missing from the sync banner.

### Fixed

- **Manifest import marks all skills as "edited"** (`packages/core/src/manifest.ts`). `stampOriginMarker` was writing `mirror.folderHash` (a GitHub tree SHA-1, 40 chars) to `.skills-bank-hash`, but drift detection reads that file and compares it against `hashSkillFolder()` output (SHA-256, 64 chars). Different algorithms, different lengths — they can never match, so every imported skill appeared "edited" immediately after import. Fix: compute `hashSkillFolder()` after `restoreAuxState()` (which writes `meta.json`) and write that local SHA-256 as the baseline — mirroring the pattern already used in the sync path in `upstream.ts`.
- **Local scan does not update the installed list** (`packages/desktop/src/renderer/App.tsx`). `runLocalScan()` stored the diagnostic report but never refreshed the `installed` state. Skills detected as unregistered installs appeared in the "From last local scan" section but not in the Unregistered section or counts, because `installed` was stale from the last full refresh. Fix: run `listInstalled()` in parallel with `localDiagnosticsScan()` and update `installed` state before rendering results.
- **Orphaned skill names missing from sync banner** (`packages/desktop/src/shared/ipc.ts`, `main.ts`, `SyncBanner.tsx`). `SyncStatus.orphaned` was a count (`number`); only "N no longer in source repo" appeared after a pull. Widened to `string[]` and passed the full name list through so the banner names the specific skills (≤3 listed individually; >3 collapses to a count).

## v1.10.1

Hotfix: v3 manifests were rejected at the IPC gate before reaching the coercion layer.

### Fixed

- **v3 manifest import blocked by stale IPC guard** (`packages/desktop/src/main/main.ts`). The `bank:importManifest` handler checked `sv !== 1 && sv !== 2` and returned an "Unsupported schemaVersion" error for any v3 export, even though `coerceManifestToCurrent` (introduced in v1.10.0) handles v3 correctly. Guard updated to `sv !== 2 && sv !== 3`; v1 is no longer accepted consistent with `MANIFEST_OLDEST_READABLE_VERSION = 2`.

## v1.10.0

Manifest schema v3, drift-state Unregister bail-out, frontmatter block-scalar parsing, and a stale-doc sweep — pulls correctness fixes across three independent surfaces that the v2-manifest-only path had been quietly blocking.

### Added

- **`coerceManifestToCurrent` — single quarantined version coercion** in `packages/core/src/manifest.ts` (#84). All version-gated logic lives in one function; the import body downstream treats v3 as the only manifest shape. v2 manifests coerce up by deriving `bucket` from origin (`origin.kind === "github" → vendored`; otherwise `personal`). v1 manifests are no longer readable — `MANIFEST_OLDEST_READABLE_VERSION` bumped from 1 to 2.
- **`bucket: "personal" | "vendored"` on `ManifestSkill`** (#84). v3 schema decouples bucket from the source axis so a `source: user` skill harvested from a third-party origin can be exported and re-imported as `vendored/` instead of collapsing into `personal/` on every receiving machine. Export reads `entry.bucket` directly; import reads `skill.bucket` directly.
- **YAML block-scalar parsing in `readSkillMdFrontmatter`** (#84). Handles `description: |` (literal, newlines preserved) and `description: >` (folded, newlines → spaces) with chomp indicators (`|-`, `|+`, `>-`, `>+`). Pre-fix the parser captured the indicator char as the value, which then propagated through `restoreAuxState` into a malformed `meta.json` and tripped drift detection downstream — `fix-knip-unused-exports` was the canonical case.

### Changed

- **`installSkillFromGithub` IPC derives bucket from origin** (#84). Compares `parsed.repo` against `linkedRepo.fullName` — same repo → `personal/`, anything else → `vendored/`. Future GitHub-URL installs land in the correct bucket from the start instead of every install defaulting to `personal/`.
- **Drift states surface `canUnregister`** (#84). `edited-with-origin`, `edited-without-origin`, `origin-unreachable`, and `origin-update-available` now grant the capability so a stuck skill with a broken upstream can be removed without first severing the origin pointer. All four states wrapped in `applyCanonGate` so canon skills strip Unregister and grant Hide instead.
- **Sync banner copy** (#84). Replaces `Fetching bundled skills` with `Fetching latest` (the banner fires for any pull, curated or linked-repo). Renames `N orphaned` → `N no longer in source repo` — defends the underlying concept (local skills carrying a `syncedFromCommit` marker but absent from the current upstream discovery) without the alarming connotation that triggered "did something get deleted?" confusion.
- **`InstalledTab` local-scan results — unregistered-installs category collapses to a summary line** (#84). The category was duplicating the dedicated Unregistered section below it with per-card Register / Delete buttons; the collapsed line points readers to the existing surface instead of rendering the same skills twice.
- **Stale-doc sweep** (#84). `docs/flows/sync.md` rewritten for the universal Pull flow (the standalone `Sync skills` button retired post-v1.3); `docs/flows/heal.md` and `docs/flows/unregister.md` get a vocab pass (`bundled-skill-edited` → `edited-without-origin`, `bundled` / `yours` → `curated` / `user`). CLAUDE.md and UBIQUITOUS_LANGUAGE.md updated to reflect the current state of the source-axis deprecation and the new v3 manifest schema.

### Compatibility

- **v1 registry manifests no longer readable.** The original deprecation window targeted v1.4; we're four minor releases past that. v2 manifests still coerce up transparently through `coerceManifestToCurrent`. v2 imports with skills authored in the linked repo will mis-bucket as `vendored/` (the coercer has no signal to identify "self" origins); fix-up is `pnpm update:skill <name> --bucket personal`.
- **`canUnregister: true` on drift states** is additive — no caller that previously expected `canUnregister: false` in those states will silently break, but renderer surfaces that gated UI on this flag will now surface a button they didn't before.

## v1.9.0

Three feature bundles ship together: the third header action (local-disk diagnostics), per-skill progress events for manifest import, and the ghost-card band that surfaces incoming skills during a manifest pull.

### Added

- **`Scan local` — third header action button** (#81). Walks agent dirs + the registry index and surfaces items needing attention across four categories: unregistered installs, broken symlinks, external-target-missing entries, registry-folder-missing entries. Local-only — no network. Mirrors the existing three-phase state machine: `Scan local` → `Scanning…` → `All clean` (auto-fade 1.5s) or `N items · Review` (persistent; click bounces to Installed tab + scrolls to top).
- **`From last local scan` section on the Installed tab** (#81). Categorized list of every item the most recent local scan surfaced, with per-item fix buttons: Register (opens the existing drawer for the synthetic entry), Remove broken link (calls `removeBrokenLinks`), Forget (calls `forgetMissing` for missing-files heal states). Diagnostics refresh after each fix. Parallel to the existing classifier-driven Needs-attention section — both stay rendered.
- **New core module `scanLocalDiagnostics`** (#81). Returns a categorized `DiagnosticReport`. Reuses existing primitives (`buildRegistryIndex`'s `missing: true` flag drives missing-files categories; `listInstalled`'s `InstalledKind` drives unregistered + broken-symlink categories).
- **Per-skill progress events on manifest import** (#82). `importRegistryManifest` accepts optional `onProgress(event)`. Fires at the top of each per-skill iteration with cumulative `completed`, `currentName`, and `lastError` from the previous iteration's failure. The first event carries `manifestNames` + `manifestSkills` for downstream ghost-card pre-rendering. A terminal event lands after the loop with `completed === total`.
- **`ImportIndicator` chip shows N/total** (#82). The persistent header chip transitions from the brief generic `Importing manifest…` to `Importing N/total` once the first progress event arrives. Per-skill detail stays out of the chip — that's the ghost band's job.
- **`Incoming via manifest` ghost-card band on BrowseTab** (#83). A band at the top of the registry surface during a manifest import, one row per net-new manifest skill. Each row tracks per-skill status: pending (shimmer), current (highlighted), errored (red border + Retry + Dismiss), settled (faded check). Band dissolves automatically when the import resolves and the registry refreshes.
- **`manifestImportRetrySkill` IPC** (#83). Single-shot retry path for a failed ghost. Main wraps the entry in a one-skill manifest and runs the existing `importRegistryManifest` pipeline; returns the single outcome. Renderer updates ghost state from the result (clear error + settle on success; update error on repeated failure; toast on collision).

### Changed

- **New IPC surface entries** on `SkillsBankApi`: `localDiagnosticsScan`, `onManifestImportProgress`, `manifestImportRetrySkill`. All additive; existing consumers unaffected.
- **`ManifestImportProgressEvent` is now a public type** exported from `@skills-bank/core`. Consumed by the desktop renderer's manifest UI; intentionally kept stable for any future CLI / API equivalents.

### Compatibility

- `importRegistryManifest`'s options gained optional `onProgress?`. Non-breaking — existing callers (CLI, tests) that don't pass the callback get the same behavior as before.
- The local-diagnostics surface and the ghost-card band are net-new. No existing UI removed, including the InstalledTab classifier-driven Needs-attention section (intentionally parallel to give the v1.9 surfaces room to prove their value before any consolidation).

## v1.8.0

Header rationalization release. The polymorphic `Refresh from {bank | owner/repo}` button is decomposed, Rescan is renamed for clarity, and the manifest-import indicator from v1.7.0's cancel infrastructure gets a persistent home in the header that survives modal close.

### Added

- **Persistent manifest-import indicator in the header** (#78). New `<ImportIndicator />` component renders to the right of the action cluster, left of the avatar. Visible whenever an import is in flight, regardless of modal state. Carries the inline spinner, `Importing manifest…` label, and a small × cancel button that calls the same abort path as AccountModal's "Cancel import" button. Users can now dismiss AccountModal mid-import and retain a visible status + one-click cancel.
- **Mid-import AccountModal close support** (#78). The modal's existing close paths (X / Escape / backdrop) already complete synchronously without awaiting the import; this PR confirms and documents that — closing the modal does NOT cancel the running import. PR #77's `await importManifest()` close path remains in place for the success-flow, but other close paths now visibly leave the import running.
- **Curated skills section in Settings** (#79). Read-only. Lists each curated entry (currently just `find-skills` post-v1.2 minimization), shows a `Last checked: <timestamp>` line from `getSyncReport().syncedAt`, and subtext `Curated skills update automatically on app restart.` making the refresh mechanism explicit.

### Changed

- **Header `Refresh from {bank | owner/repo}` decomposed** (#79). The polymorphic button is gone. The bundled-default branch is dropped entirely — when no GitHub repo is linked, the header simply doesn't render the button. The surviving linked-repo branch is renamed to `Pull from owner/repo` with: working state `Pulling…`, a brief `✓ Pulled` confirmation auto-fading after 1.5s, and a clarified tooltip explaining the diff-before-apply guarantee.
- **Header `Rescan` renamed to `Check for updates`** (#80). Universal product-update vocabulary matches App Store / OS conventions and contrasts clearly with the Pull content-action. State labels: `Check for updates` / `Checking for updates…` / `Up to date` / `N updates · View` (dropped the "found" word for terseness; · separator unchanged). Behavior unchanged — same probe-and-flag flow, same per-card chip apply mechanism.
- **`Rescan` button tooltip rewritten** (#80). Drops the stale "agent directories" claim (that role is moving to the planned local-diagnostics button) and explicitly states what does NOT happen: "does not download anything." That was the most-confused-about aspect of the prior copy.
- **BrowseTab copy sweep** (#80, follow-up). `REGISTRY_TOOLTIP`, the tab-intro paragraph, and the empty-state helper text all referenced the retired `Refresh from <repo>` button name; updated to `Pull from <repo>` with the linked-repo conditional clause.
- **Curated set auto-refreshes on app launch** (#79). A silent `runSync()` fires shortly after the boot probe (roughly 7s into launch). Errors are swallowed by design — the user sees a stale `Last checked` timestamp in Settings and the next launch retries. The previous manual user lever is retired.

### Compatibility

- `RescanState` type and `useRescanController` internals are unchanged. The Rescan rename is strings-only.
- The `Pull from owner/repo` button uses the existing `reposRefreshCurrent` IPC under the hood — no new IPC channel for the rename.
- `AccountModal` props gained `importingManifest` and `onCancelImport` already in v1.7.0 (via PR #77); PR #78 added their downstream consumers in the header without changing the AccountModal shape.

## v1.7.0

Cancel-able manifest import with an AccountModal busy state, plus two correctness fixes: the upstream-probe completion event and duplicate description warnings on manifest-imported skills.

### Added

- **Cancel-able manifest import** (#77). New IPC channel `bank:importManifestCancel`. `importRegistryManifest` accepts an optional `AbortSignal` and checks it between per-skill iterations; already-mirrored skills are preserved on cancel (no rollback). Result type gains an optional `cancelled?: boolean` flag.
- **AccountModal busy + Cancel affordance during import** (#77). The Import manifest button shows a busy spinner during the in-flight IPC. Corruption-risking buttons (Import folder, Refresh from repo, Merge registry, Sign out, Connect GitHub / Repo picker) disable for the duration. Read-only buttons (Export folder, Export manifest, Check for updates) stay enabled. A new "Cancel import" button appears next to Import manifest, visible only during the import. Modal-close moves to after the import resolves so the busy state remains visible.
- **`readSkillMdFrontmatter` helper** exported from `packages/core/src/registry.ts` (#76). Parses YAML frontmatter from SKILL.md only — bypasses `readSkillMeta`'s meta.json-first preference. Useful for callers that need frontmatter as a distinct source from meta.json.

### Fixed

- **Probe `runOnce` exit paths emit completion events** (#75). The three early-return paths (no registry root, `buildRegistryIndex` throws, zero github-origin candidates) previously returned without firing `opts.onComplete`, leaving the renderer's Rescan-button state machine stuck on `working` indefinitely. The zero-candidates case was the common trigger — a registry with no baselined `skillFolderHash` markers. Each path now emits an empty `onComplete({})` so the renderer transitions to `done` normally.
- **Manifest-import description warnings** (#76). Two compounding bugs surfaced as duplicate `missing description` warnings on every manifest-imported skill. `restoreAuxState` always wrote a fresh `meta.json` containing only `{ name, tags? }`, dropping description even when present in the upstream's mirrored SKILL.md frontmatter; and `readSkillMeta`'s strict "meta.json wins" preference meant `buildEntry`'s fallback couldn't recover from a description-less-but-valid meta.json. Fix: `restoreAuxState` now reads SKILL.md frontmatter and merges `description` / `version` / `author` into the meta.json it writes. Additionally, `build.ts` filters AJV `required`-keyword violations for `name` and `description` since those fields are recovered by the existing SKILL.md fallback and the human-readable warnings already convey the same complaint. Net effect: manifest-imported skills produce zero description warnings; genuinely description-less skills produce exactly one warning instead of two.

### Compatibility

- `readSkillMeta` contract unchanged (strict "meta.json wins").
- `ImportRegistryManifestOptions` gained optional `signal?: AbortSignal`. `ImportRegistryManifestResult` gained optional `cancelled?: boolean`. Both additions are non-breaking.
- New IPC channel `bank:importManifestCancel` exposed on `SkillsBankApi` as `importManifestCancel()`.
- The persistent header indicator + mid-import AccountModal close are out of scope for this release; tracked as a follow-up PR on top of this baseline.

## v1.6.2

Docs-only release. Cleans up the documentation tree to match the post-v1.6 state.

### Removed

- **`docs/plans/`** (20 files). The plan files were implementation drafts; every plan through Phase 5 + cli-minimal had shipped. The CHANGELOG is the as-shipped record.
- **`docs/audits/`** (7 files). v0.11.x snapshot analyses, superseded by current code state.
- **`docs/bug-reports/`** (3 files). All three bugs resolved in shipped releases:
  - `2026-05-18-fetchedAt-churn` — fixed in v0.11.7 (`f8d9a3f`).
  - `2026-05-19-origin-update-missing-meta-synthesis` — fixed in `c2fea10`.
  - `2026-05-19-origin-update-missing-validation` — same commit.

### Changed

- **User docs vocabulary swept** to current vocabulary throughout:
  - `drawer` → `dialog` in user-facing prose where it describes the visual element. CSS class names stay `.drawer-*` internally.
  - `source: "yours"` / `"bundled"` → `"user"` / `"curated"` where the literal axis values appeared.
  - `bundled` / `yours` (axis adjectives) → `curated` / `user`. Noun phrases like "bundled default" (the unauth-mode startup state) stay — that's the UI's wording for the mode.
  - "Persona" references (v1.2 first-launch picker, collapsed in v1.3) → "linked repo vs bundled default" framing.
- **README CLI section** rewritten (done in v1.6.0; this release captures the trailing follow-on edits).
- **Getting started**: Intel DMG filename corrected to `-x64.dmg` to match actual release assets.
- **Troubleshooting**: persona-tagged "Registry tab is empty" causes rewritten as bundled-default-vs-custom-repo; bug-report template updated to the v1.6.x Account-vs-Settings shape.
- **Self-host**: dropped the "power-persona registry-replacement" pointer; redirects to Account → Sign in with GitHub.
- **CLAUDE.md**: the 20-row plans-tracking table collapsed to one paragraph pointing at the CHANGELOG. Repo-orientation list no longer mentions the retired `docs/plans/` directory. Multi-milestone-plans convention rewritten to point at PR descriptions / ADRs.
- **UBIQUITOUS_LANGUAGE.md**: inbound links to the deleted `docs/plans/` files rewritten to CHANGELOG anchors + inline version references.
- **ADR-0001 / ADR-0002**: references to the deleted audits/plans dirs rewritten to inline context or CHANGELOG anchors.

### Documentation surface

- 22 docs files post-cleanup (was 51 pre-cleanup).
- Every doc that embeds a screenshot now carries a `> [!NOTE]` declaring the visuals predate the v1.5.1 dialog redesign and the v1.6.0 Account/Settings reshuffle. Screenshots themselves were intentionally not updated in this pass.

### Pretty-mermaid fix

A YAML-scalar artifact in `pretty-mermaid`'s `meta.json` (description value was literally `"|"`) was corrected in both this repo's local copy and the maintainer's `Tyler-Reagan/skills` linked repo. Not formally part of this release — out-of-band fix to the registry content.

### Compatibility

- No code changes. Zero impact on `packages/core` SDK surface or on-disk schemas.

## v1.6.1

Bug fix + UX cleanup on the registry-data move surface. Importing a registry manifest now refreshes the registry automatically (the pre-fix path required a manual Rescan), and the manifest ops join the content ops under one converged "Move my registry" section in Account.

### Fixed

- **Manifest import didn't refresh the registry.** The `Import registry manifest` handler lived in `SettingsModal` and flashed a toast on success but never called App's `refresh()`. Sibling content-import handlers (`Import from disk`, `Merge from disk`) in `App.tsx` already called `refresh()` after success — the manifest path was an outlier because it was plumbed through a child component that didn't have the refresh callback in scope. Hoisted the manifest handlers up to App.tsx; the post-import install-hint follow-up modal is hoisted too. Imported skills now appear in the Registry tab immediately.

### Changed

- **Account / Settings seam clarified.** Pre-fix, "move my registry" was split across two modals: Account had content ops (Import / Merge / Export folder), Settings had manifest ops (Import / Export JSON pointer list). Both move registry data; the split was technically real (bulk content vs pointer list) but arbitrary from a user's mental model.

  Converged into AccountModal under a single **Move my registry** section with two clearly-labelled subgroups:
  - **Content** — Import from disk (replace) · Merge from disk · Export as folder
  - **Manifest** — Import manifest · Export manifest

  The seam now reads cleanly:
  - **Account** = identity + where my registry lives + how I move it
  - **Settings** = app preferences (default install agents, density, debounce, agent-dir collapse)

- `SettingsModal`'s "Registry manifest" section, its handlers, and its local `ManifestImportConfirmModal` sub-component all moved out (~120 lines removed from SettingsModal). The confirm modal is now a standalone component (`packages/desktop/src/renderer/components/ManifestImportConfirmModal.tsx`) rendered at App level so it doesn't depend on Settings being open.

### Compatibility

- No `packages/core` SDK-surface changes.
- No on-disk schema changes.
- Renderer CSS class names unchanged.

## v1.6.0

CLI-minimal. The `skills-bank` CLI gets stripped to five commands shaped for shell composition; four commands tied to interactive flows are removed and replaced with redirect-stubs that point at the in-app equivalent. The desktop app is unchanged.

### Added

- **`skills-bank path <name>`** — prints the absolute path to a registered skill. Enables `cd $(skills-bank path foo)` and `$EDITOR $(skills-bank path foo)/SKILL.md`. Exits non-zero on miss so subshell substitution fails fast.
- **`--json`** flag on `list` and `installed` — first-class shell composition surface (`list --json | jq '.[].name'`).
- **`--agent <id>`** on `install` and `uninstall` — scope to a single agent dir. Default behavior (broadcast to every existing agent dir) is unchanged when the flag is omitted.

### Removed

The CLI no longer exposes these four commands:

- `skills-bank import` — interactive scan/register flow.
- `skills-bank export <name>` — bulk export of a single skill as `.md`/`.zip`.
- `skills-bank finalize` — top-level agent-dir symlink collapse.
- `skills-bank sync-installed` — relink-after-pull pass.

Each is kept as a hidden redirect-stub that prints a one-line pointer to the in-app equivalent and exits with code 2 — scripts calling them surface the change loudly rather than silently no-op'ing.

| Removed CLI      | Where the operation lives now                                                              |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `import`         | **Register existing skills** (desktop app) — or Account → Import a registry for a manifest |
| `export`         | **Account → Export current registry** (desktop app)                                        |
| `finalize`       | **Settings → Collapse symlinked agent dirs** (desktop app)                                 |
| `sync-installed` | Automatic — the app rewires installations on its own; no CLI equivalent                    |

### Changed

- **CLI tagline** in the README and `--help` description: "Same operations through either surface" → "Desktop app for humans, CLI for scripts." The CLI is now explicitly the scripting surface; interactive flows live in the desktop app.
- **`packages/core/src/install.ts`** error string: pointed at "Register existing skills in the desktop app" instead of the removed `skills-bank import`.
- **`packages/core/src/import.ts`** synthesized-meta placeholder: matched copy.

### Compatibility

- The redirect-stubs are the deprecation-cycle equivalent for the four removed commands. They will not be removed before v2.0.0; scripts that called them will continue to fail loudly (exit 2) rather than silently.
- No `packages/core` SDK-surface changes. The CLI now consumes only pure-TS exports that already existed (`installSkill`, `uninstallSkill`, `listInstalled`, `buildRegistryIndex`, `resolveRegistryRoot`, `getAgent`).
- No on-disk schema changes.

## v1.5.1

Bug fix + drawer redesign. One PR ([#71](https://github.com/Tyler-Reagan/skills-bank/pull/71)) covering both, since the redesign grew out of opening the drawer to test the bug fix. No new plan-phase work — this is polish on the v1.5 surface.

### Fixed

- **`scanExistingInstalls` per-agent collision.** When the same skill name lived in multiple agent dirs — e.g. a real directory at `~/.agents/skills/<name>` plus stale broken-symlinks in `~/.claude/skills/` and `~/.cursor/skills/` — `RegisterModal` keyed rows and choices by `e.name` alone, so React collapsed the duplicate keys and the user only saw one entry. From the user's perspective the scan "missed" the skill. The data layer was correct (`listInstalled` returns one row per `(agent, name)` pair); the wire format wasn't — `RegistrationAction` only carried a `name`, so the IPC handler had to dedupe with a `kindRank` tiebreaker that masked exactly the case the renderer needed to surface. New `installed.test.ts` pins the invariant.
- **`unknown` publish-state chip** rendered as a misleading "Unknown" label, reading as "this skill is in an unknown state" rather than "the probe couldn't reach a verdict". Now renders as an unobtrusive `?` glyph with a tooltip explaining the cause (token expired / tree truncated / transient network error) and a Rescan hint.
- **Mid-word text wrap** in `.drawer-meta-value`. `word-break: break-all` split ordinary English words ("desktop" → "de | sktop") in repo description rows. Switched to `overflow-wrap: anywhere` — only breaks when no word or slash boundary fits.

### Added

- **`RegistrationAction.agent` + `RegistrationAction.customDir`** (optional, additive) on the `register` / `remove` / `skip` variants. The IPC handler routes to the exact entry when the action carries an agent; legacy callers fall back to the existing `kindRank` dedup. SDK-surface addition, no break.
- **`.drawer-meta-value.prose`** variant for sentence text (Origin repo description, etc.) — sans-serif, left-aligned, italic. Replaces the mono/right-aligned inheritance meant for paths and hashes.
- **`.drawer-section.lede`** modifier applied to the Description section — 14px / 1.65 line-height so it reads as the entry point, not as one more sibling.

### Changed

- **Skill detail surface shape — drawer → centered dialog.** The right-anchored slide-out became a centered modal: `min(960px, 92vw)` × `min(820px, 88vh)`, rounded corners, scale-and-fade pop. The overlay doubles as a flex positioning container; backdrop click closes only when the click hits the overlay itself. Under 720px the layout falls back to a stacked column with a bottom-pinned action footer. Class names stay `.drawer-*` — the identifier now describes the role (contextual detail surface) more than the visual pattern.
- **Two-column body** under the header: left column holds the reading content (Description → Tags → SKILL.md preview → Origin → Metadata), right rail (~280px) holds the action stack with hints. Each column scrolls independently — a long preview can no longer push the primary action below the fold.
- **Content reorder.** SKILL.md preview promoted to immediately after Tags (content anchor first). Metadata demoted to last.
- **`.drawer-meta-row` loses per-row bottom borders.** Rows align on a baseline with a min-width on the key column for tabular feel; the list reads as a single block separated from siblings by section margin, not by horizontal rules.
- **SKILL.md preview drops its card-in-card chrome** (surface bg + border + radius) for inline content with a thin 2px left rail. Max-height bumped 320 → 360 for one-screen scanability.
- **Linked repo section redesigned for the rail.** Editorial uppercase label replaces the boxed flow pill. Path shows the inside-repo destination only (`skills/personal/<name>/`); full path lives in the title tooltip. Fork flow gets the warn token + alert-triangle on the label (single visual cue); the duplicate Fork badge next to Publish is gone. Explicit `<owner>/<repo>` acknowledgement with a check icon sits under the section heading. Primary button stretches to full rail width.
- **Ellipsis sweep on loading states.** 13 button strings (`Registering…`, `Installing…`, `Saving…`, etc.) lost the trailing `…`. The commit-message truncation case dropped its `+ "…"` too — the wrapper span already carries `title={lastCommit.message}` for the full text.
- **a11y polish.** aria-labels on Tags Edit/Save/Cancel, Origin-picker Cancel, and SKILL.md empty-state buttons. The overlay no longer carries `aria-hidden="true"` (would have hidden the now-nested dialog from screen readers).
- **Misleading scan copy** in `RegisterModal` ("Inspecting `~/.claude/skills/`") swept to match the existing "Nothing to register" copy that lists all eight agents.

### Compatibility

- `RegistrationAction` wire format change is additive (optional fields). IPC handler accepts both shapes. No deprecation cycle needed.
- No on-disk schema changes.
- Renderer CSS class names unchanged (`.drawer-*` kept for stability).

## v1.5.0

Phases 4 and 5 of the post-v1.0 roadmap, shipped together: [in-app-install-from-discover](docs/plans/in-app-install-from-discover.md) (one PR) and [in-app-publish](docs/plans/in-app-publish.md) (M1 + M2+M3+M4). With Phase 5, every skill in the user's registry has a round-trip path to their linked GitHub repo — install from a URL on the way in, publish a PR on the way out. The two flows share `mirrorSkillFolder` (v1.2) on the install side and the new `pushSkillFolder` on the publish side; classification, fork, and publish-state pinning live in `packages/core` so the CLI can adopt the same primitives later.

### Added — install (Phase 4)

- **One-shot GitHub-URL install.** Paste any GitHub folder URL containing a `SKILL.md` (skills.sh deep link, repo browse URL, raw GitHub URL); the app parses to `{repo, ref, skillPath}`, validates the manifest, and mirrors via the existing `mirrorSkillFolder` path. No `npx`, no terminal, no skills.sh-specific scraping.
- **Settings → Install from GitHub URL** entry point with paste field, dry-run preview, and inline validation.

### Added — publish (Phase 5)

- **`forkSkill` core primitive** (`packages/core/src/fork.ts`). Scratch-dir + atomic-swap; refuse-on-collision; flips `source: curated` → `source: user`, calls `unlinkOrigin`, relocates `vendored/<name>` → `personal/<name>`. Per [ADR-0006](docs/adr/ADR-0006-fork-atomicity.md).
- **`pushSkillFolder` core primitive** (`packages/core/src/upstream.ts`). Six-step push (tree → commit → ref → PR) with ref-as-commit-point atomicity, PR-state-aware branch resolution, rate-limit handling that mirrors `mirrorSkillFolder`. PR-only — the linked repo's default branch is never written directly. Subsequent publishes append commits to an open PR. Per [ADR-0007](docs/adr/ADR-0007-push-atomicity.md).
- **`publish-state.ts` dual-mode rewrite.** `computePublishStatesFromGit` (local, fast) and `computePublishStatesFromRemote` (GitHub Trees, packaged-app-safe). The remote mode fixes a silent canon-gate bug where packaged installs without `git` on PATH defaulted every skill to `unknown`. Per [ADR-0008](docs/adr/ADR-0008-publish-state-pinning.md).
- **`publish-classify.ts`** — routes each publish into one of three sub-flows (new skill / safekeeping / fork) from `{source, origin, syncedFromCommit, drift, publishState}`.
- **Publish IPC channels.** `publish:classify`, `publish:fork`, `publish:push`, `publish:state` — four new channels in `packages/desktop/src/shared/ipc.ts`. Main orchestrator caches the linked-repo tree per session, invalidates on linked-repo change.
- **Drawer Publish surface.** `PublishSection` mounts in `SkillDetailDrawer`'s Linked-repo section: pre-flight chip (`READY` / `DRAFT` / `IN SYNC` / `BLOCKED`), Publish button, Fork-confirm modal for vendored-with-edits skills. The classifier and canon gate share `publish-state.ts`'s output so chip and button never disagree.
- **Auto-prompt RepoPicker after Device Flow** when the user signs in with no `linkedRepo` yet — avoids the dead-end "signed in, now what?" state.

### Changed

- **Sync conflict + orphan detection now key off `syncedFromCommit` presence.** Three call sites in `applyCanonicalSync` previously used `source === "curated"` as a proxy for "previously synced from somewhere," which broke once Phase 1's `mountTo: "personal"` started stamping linked-repo skills as `source: "user"`. The discriminator is `!!syncedFromCommit`; the source axis is now derived from the `mountTo` param the caller supplies. (See `syncedFromCommit` notes in [`UBIQUITOUS_LANGUAGE.md`](UBIQUITOUS_LANGUAGE.md) and the curated-proxy bug-family entry in [`CLAUDE.md`](CLAUDE.md).)
- **`ConflictResolutionModal` vocabulary** — `bundled` references swept to `curated` to match v1.3's vocabulary rename.
- **Linked-repo drawer section restructured.** Heading row + flow-type tag + target path as code + tighter purpose-line hint + separated action row. Less prose, more scanability.
- **`RegisterModal` scan copy** lists all eight agents the scan walks; `SyncBanner` gets vertical breathing room from the header; `InstallFromGithubModal` placeholder loses its ellipsis (UI-text convention).

### Removed

- **`RegistryEntry.publishState`.** The pre-flight publish state lives in `publish-state.ts` and is read on demand by the drawer surface; no need to thread it through the registry index.
- **`migrateLegacyGithubMarkers`.** The one-cycle legacy-marker migration carved out in v1.3 has fully aged out; tolerant-read on the source-marker reader remains.

### Compatibility

- **Public-surface deprecations.** Per the v1.0 backcompat policy, the removed `publishState` field on `RegistryEntry` and the dropped `migrateLegacyGithubMarkers` export are SDK-surface changes; both were never public-API-stable (`publishState` was added and removed within an unreleased Phase 5 window).
- **No on-disk schema changes.** `.skills-bank.json`, `.skills-bank-runtime.json`, and the manifest are all unchanged.

## v1.4.0

Phase 3 of the post-v1.0 roadmap ([bank-mode-persistence](docs/plans/bank-mode-persistence.md)). Originally scoped much larger; trimmed during plan rewrite (commit `2182788`) to align with the post-v1.2/v1.3 ground state. The product promise — "skills you've installed stay safe with you, even if their upstream goes dark" — was already met by v1.2's discovery-mount + local-content-copy architecture; what was missing was the **recovery UX** for skills whose origin probe persistently fails. v1.4 lands exactly that.

### Added

- **`origin-unreachable` drawer state.** New `DrawerState` triggered when a github-origin skill's probe has failed `ORIGIN_UNREACHABLE_THRESHOLD` (3) consecutive non-rate-limit times. Lower priority than drift (drift implies reachable-recently); higher than `origin-update-available` (can't surface updates we couldn't probe for).
- **Drawer recovery banner** with two actions: **Retry probe** (re-runs the full probe pass via the existing `IPC.originProbe`) and **Keep this skill** (routes through the existing `IPC.acceptDrift` → `unlinkOrigin` dispatch v1.3 wired). Hint copy explains the local copy is intact regardless.
- **`UNREACHABLE` SkillCard chip** for list-level visibility. Same priority slot as `MISSING`.
- **`probeFailureCount` / `lastProbeFailureAt` in `.skills-bank-runtime.json`.** Runtime-only — ADR-0002 invariants preserved. Counter increments on per-skill failure (folder not in tree) and per-repo non-429 failure (tree fetch errored). Resets on success. Saturates at the threshold to avoid unbounded growth + sidecar churn.
- **`RegistryEntry.originUnreachable`** boolean populated by `buildRegistryIndex` from the runtime sidecar.

### Changed

- **`docs/plans/bank-mode-persistence.md` rewritten.** Original plan (pre-v1.0) called for a per-skill `bankSnapshot` cache layer that the v1.2 grill retired, plus `npx skills add` integration that v1.2's `mirrorSkillFolder` superseded, plus pre-rename vocabulary. The rewrite scopes Phase 3 to the recovery UX only.

### Compatibility

No new IPC channels. No new on-disk schema changes beyond the gitignored runtime sidecar's new fields (backward-compatible defaults). No cache layer; the local content under `skills/.../<name>/` _is_ the cache by virtue of v1.2's discovery mount.

### Phase 4 inheritance

`in-app-install-from-discover` will get the same recovery UX automatically — any Discover-installed skill picks up a github origin and inherits the probe-failure tracking by virtue of `entry.source.origin?.kind === "github"`.

## v1.3.0

Phase 2 of the post-v1.0 roadmap ([vocabulary-rename](docs/plans/vocabulary-rename.md)). Mechanical vocabulary sweep + persona-collapse the v1.2 plan had carved out as a Phase 2 non-goal. Every wire-format / SDK-surface change ships behind a one-minor-cycle tolerant-read window; legacy aliases are dropped in v1.4.

### Changed

- **Source axis values renamed.** `bundled` → `curated`, `yours` → `user`. The user-facing axis on each registry skill, persisted as `.skills-bank.json`'s `source` field. "Curated" replaces "bundled" because the curated set has never literally shipped in the app binary — it ships from the linked repo. "User" replaces "yours" to drop second-person framing from badges + tooltips. `readSkillSource` tolerantly accepts both old and new values for one minor cycle (v1.3.x); `writeSkillSource` emits only the new form.
- **`.skills-bank.json` field `upstream` → `origin`.** The TypeScript surface already used "origin" in prose post-v0.11.10; v1.3 lands the wire-format rename to match. `parseOrigin` accepts both keys for one minor cycle. **ADR-0002 amended** to reframe the stability claim around tolerant-read windows.
- **`acceptDriftSeverUpstream` → `unlinkOrigin`.** The function-name rename matches UL canon. The old export stays as a `@deprecated` const alias for one minor cycle.
- **UI provenance badges.** Dropped the `YOURS` chip entirely (the **Mine** filter on the Registry tab is the single surface for "show me only my skills"). `BUNDLED` rung becomes `CURATED`. Filter chip "Yours" → "Mine".
- **Persona collapse.** Removed the first-launch picker. Every install starts on the bundled-default (`linkedRepo: null`); GitHub linking moves to a single entry point in **Settings → Account → "Sign in with GitHub"**. `resolveBootRegistrySource` normalizes legacy `null` configs to `"local"`. `AuthStatus.registrySource` becomes a derived alias for one minor cycle and is removed in v1.4.
- **Manifest `schemaVersion` v1 → v2.** `importRegistryManifest` grows a migration head (`migrateManifestV1ToV2`) that handles v1 imports transparently; exports always emit v2. The IPC handler accepts both. Removal of v1 reader targeted at v1.4.
- **`docs/concepts.md` rewritten.** Source axis values updated; persona section folded into a single "Linked repo vs bundled default" configuration spectrum. `docs/personas.md` deleted (content folded in).

### Added

- **`pnpm migrate:source-markers`** — one-shot eager rewrite of every committed `.skills-bank.json` in a registry to the post-v1.3 form. Optional cleanup; the tolerant-read path handles legacy markers indefinitely within the v1.3.x window. Ran against this repo's curation layer as part of this release — the `find-skills` marker now uses `source: "curated"` + `origin` field.
- **Deprecation aliases (SDK).** `SkillOriginLegacy` type (re-exports the legacy literal-string union), `acceptDriftSeverUpstream` const (alias of `unlinkOrigin`). One minor cycle; both removed in v1.4.

### Removed

- **`docs/personas.md`** — folded into `docs/concepts.md`. The persona distinction disappears from first launch; the bundled-default vs linked-repo split stays as a configuration spectrum, not a persona fork.
- **`LoginScreen.tsx`** — first-launch picker retired. `ConnectGithubModal` already owned the device-flow + resume surface, so the entry point for GitHub linking moved cleanly into Settings → Account.

### Fixed

- **`applyCanonicalSync` no longer silently wipes per-skill `origin`** across every sync. (Pre-existing v0.11.3 oddity surfaced during the v1.2 Phase 1 work, then folded into the wire-format rename here.) `readSkillSource` now spreads existing source axes before stamping registry-level fields, so per-skill origin attribution survives.

### Migration notes for SDK consumers

- **TypeScript literal-string callers** (`source === "bundled"`) get a TS error post-upgrade. Migration: rename to `source === "curated"`. The `SkillOriginLegacy` type alias is a one-cycle escape hatch.
- **JSON wire-format callers** outside the app (anything that reads `.skills-bank.json` directly) should switch to the new keys (`origin`, `curated`, `user`). Tolerant-read for one minor cycle means existing v1.2-written files still parse correctly on v1.3, but the rewrite happens on the next mutation.
- **Manifest v1 consumers** continue to import successfully via the migration head. Exports always emit v2.

## v1.2.0

Phase 1 of the post-v1.0 roadmap ([curation-layer-reset](docs/plans/curation-layer-reset.md)). Resets the bundled set to a deliberate MVP, extracts the maintainer's authored skills into their own origin repo, ships a metadata-only registry-manifest export/import flow with zero-effort `userData` auto-snapshots, and drops the remote-layout invariant so any GitHub repo (flat / bucketed / nested) is linkable as-is.

### Added

- **Registry manifest export/import.** New `exportRegistryManifest` / `importRegistryManifest` primitives in `packages/core/src/manifest.ts` produce a metadata-only JSON snapshot (per-skill source axis, origin pointer, tags, dismissed/hidden, `lastInstalledOn` per agent). Import re-fetches each skill's content from its GitHub origin via `mirrorSkillFolder`, restores tags + hide state, and surfaces an `installHints` list for a single user-confirmed batch install. Settings → **Export registry manifest** / **Import registry manifest**; post-import confirm modal batches the hint-driven installs. `bank:exportManifest`, `bank:importManifest`, `bank:installFromManifestHint` IPC channels.
- **`userData` auto-snapshots.** Every registry-mutating IPC handler now flows through a `mutatingHandle` wrapper that writes a `RegistryManifest` snapshot to `<userData>/registry-snapshots/snapshot-<timestamp>.json`, rotating to the last five by mtime. The manifest concept lands for every user — including those without a linked repo — as a zero-effort backup.
- **Discovery-based linked-repo mount.** New `discoverSkillsInTree` core primitive in `packages/core/src/discovery.ts` walks any source tree by file convention (presence of `SKILL.md` and/or `meta.json`), surfacing name collisions and nested-skill anomalies for the caller to handle. `applyCanonicalSync` now takes a `mountTo: SkillBucket` parameter — `IPC.syncCanonical` → `mountTo: "vendored"`, `IPC.reposReplaceRegistry` → `mountTo: "personal"`. Remote repos no longer need a `skills/` directory at the root; flat layouts, single-bucket layouts, and deeply nested layouts (`docs/skills/<category>/<name>/`) all link cleanly.
- **`Tyler-Reagan/skills`.** New origin repo for the four authored skills (`gitlab-ci-inspector`, `gitlab-mr-writing`, `pretty-mermaid`, `terraform-plan-summary`), extracted from the curation layer via `git subtree split`. Linkable in-app via "Your own registry."

### Changed

- **Curation layer reset.** `skills/vendored/` shipped with one canonical MVP — `find-skills` — instead of the prior 63 accumulated entries. The displaced skills retain upstream-origin validity; they are reinstallable via Discover when Phase 3 (`in-app-install-from-discover.md`) ships. `skills/personal/` no longer exists in the curation layer; the maintainer's authored skills live in their own linked repo.
- **Bucket UL** narrowed to the **app-internal** layout. Goal #5 reframed: every registry the app manages uses `skills/{personal,vendored}/<name>/`, but remote repos (linked, origin, curated) can use any layout — discovery is by file convention. Section 10 of the plan captures the design.
- **`applyCanonicalSync` upstream preservation.** Pre-existing v0.11.3 oddity fixed in passing: per-skill `upstream` pointers no longer get silently wiped across every sync. Source axes spread first; only registry-level axes (`source`, `syncedFromCommit`, `syncedAt`) are overwritten.
- **`pnpm reset:seed`** narrowed to `skills/vendored/` only. `skills/personal/` no longer exists in the curation layer, so the seed step skips that half entirely.

### Deprecated

- **`exportRegistry`** (content-bearing zip in `packages/core/src/export.ts`). Marked `@deprecated`; canonical replacement is `exportRegistryManifest`. Removal targeted at v1.3 per post-1.0 backcompat discipline. `exportSkill` / `getExportInfo` are unaffected.

### Removed

- **`pnpm stamp:self-authored`.** Decommissioned. Targets (the four authored skills) moved to their own origin repo.

### Fixed

- **Manifest import never surfaced the install-hint modal after `rm -rf ~/.skills-bank-dev` + re-link.** The agent-dir intersection in `importRegistryManifest` silently dropped every hint when no agent dirs existed yet. Dropped the intersection — `installSkill` creates dirs on demand and a stray symlink under an unused agent is harmless.
- **Manifest export / import feedback was trapped inside the Settings modal.** Both flows now flash a confirmation toast via `useRegistryHost`, so closing Settings doesn't hide the result.

### Maintainer migration

The maintainer's continuity for the 62 displaced vendored skills is deliberately deferred to Phase 5 (`in-app-publish.md` bulk safekeeping). During Phases 1–4 development, daily use continues via the pre-Phase-1 packaged install; dev-mode runs in `~/.skills-bank-dev/` isolation.

## v1.1.0

Three new maintenance flows + a Registry-tab bulk-install affordance + the
publish-feature design pinned in three new ADRs. Closes the v0.11.10
origin-rename deprecation cycle (SDK-surface change).

### Added

- **`pnpm vendor:refresh`.** Bulk drift-detect + re-mirror script for vendored
  skills. Default is review-only; `--apply` re-mirrors drifted skills and
  re-baselines `skillFolderHash`. `--only foo,bar` scopes to a subset; `--json`
  for machine-readable output. Per-skill opt-out via `"refresh": "manual"` in
  `.skills-bank.json`. Missing/relocated upstreams surface as `missing` rather
  than auto-deleted. Closes [#58](https://github.com/Tyler-Reagan/skills-bank/issues/58).
- **`.github/workflows/vendor-refresh.yml`.** Schedulable companion to the
  CLI — weekly Monday 09:00 UTC cron + manual `workflow_dispatch` (with `only`
  filter and `apply` toggle). Opens a maintainer-review PR via
  `peter-evans/create-pull-request` on the stable `chore/vendor-refresh`
  branch. Re-runs update the same PR rather than stacking duplicates.
- **`pnpm update:skill`.** Maintainer-only CLI for pulling a locally-edited
  skill from `~/.claude/skills/<name>/` (override with `--from`) back into
  this repo's `skills/personal/<name>/` or `skills/vendored/<name>/`. Bucket
  is auto-detected when the skill already exists; pass `--bucket` for new
  skills. Schema-validates `meta.json`. Preserves the destination's
  `.skills-bank.json` / `.skills-bank-hash` provenance markers across the
  content refresh. Closes [#59](https://github.com/Tyler-Reagan/skills-bank/issues/59).
- **Bulk install on the Registry tab.** New "Bulk install" toggle switches
  cards into select mode with leading checkboxes; an action bar offers
  "Select all visible" + "Install N selected" and reports progress inline as
  each skill installs. Skip-and-continue error handling with per-card status
  chips (`▸` in-flight, `✓` installed, `✕` failed). Already-installed skills
  render with a disabled checkbox so the user sees what bulk install will
  skip. Reuses `settings.defaultInstallAgents` for agent routing. Closes
  [#60](https://github.com/Tyler-Reagan/skills-bank/issues/60).
- **Three new ADRs** pinning the design for the post-v1.0 in-app Publish
  feature (planned; not yet implemented):
  - **ADR-0006** — `forkSkill` invariants (scratch-dir atomic swap,
    collision refusal, must-have-origin trigger).
  - **ADR-0007** — `pushSkillFolder` invariants (ref-as-commit-point
    atomicity, PR-state-aware branch resolution, rate-limit handling
    matching `mirrorSkillFolder`).
  - **ADR-0008** — Dual-mode publish-state computation (git + GitHub-API
    paths, auto-detector, compute-on-call with 5-min tree cache, drops
    `publishState` from `RegistryEntry`).
- **`docs/plans/in-app-publish.md`.** Four-milestone implementation plan
  tying the three ADRs together. Listed in CLAUDE.md's remaining-plans
  table as post-v1.0.
- **UBIQUITOUS_LANGUAGE.md vocabulary extension** for the in-app Publish
  flow: `Publish` / `Fork` / `Safekeeping` / `Linked repo` as user-visible
  verbs and concept, with explicit aliases-to-avoid columns and two new
  Flagged ambiguities for the Fork-vs-Unlink-origin composition and the
  Safekeeping-as-rationale-not-operation framing.
- **`docs/adr/ADR-0001` amended** to note that post-v1.0 primitives may
  extend the v0.11.7 test foundation per their own ADR (the precedent ADRs
  0006 / 0007 / 0008 follow).
- **`docs/concepts.md`** cross-references `UBIQUITOUS_LANGUAGE.md` as the
  canonical engineering glossary; when the two disagree, UL is canonical.
- **`@skills-bank/core` exports** `parseSkillFrontmatter`,
  `synthesizeSkillMeta`, `validateSkillMeta`, `SKILL_META_SCHEMA`.
  All four are discoverable from the SDK so maintainer scripts, the in-app
  runtime, and external consumers share one contract for "what makes a
  valid skill meta.json." Tests in `packages/core/src/skill-meta.test.ts`
  (18) pin the frontmatter parser, the synthesis decision tree, the
  validation discriminated union, and `SKILL_META_SCHEMA` parity with
  `docs/meta-schema.json`.
- **Stash-and-restore rollback** in `applyOriginUpdate`. The pre-mirror
  skill folder is stashed to
  `<registryRoot>/.skills-bank/scratch/origin-update-<rand>/` before the
  network fetch; if post-mirror invariants (synthesis + validation) fail,
  the function restores from the stash. Extends ADR-0001 Suite 4's
  no-mutation discipline beyond `mirrorSkillFolder` itself to the full
  Update operation.

### Changed

- **SDK surface — v0.11.10 origin-rename deprecation cycle closed.** All
  `@deprecated` `Upstream*` aliases introduced in v0.11.10 have been removed.
  Consumers of `@skills-bank/core` that reached for any of the following
  must migrate to the canonical Origin\* names:
  - `UPSTREAM_KIND_GITHUB` → `ORIGIN_KIND_GITHUB`
  - `UpstreamKind` → `OriginKind`
  - `UpstreamPointer` → `OriginPointer`
  - `probeRepoTree` → `probeOriginTree`
  - `applyUpstreamUpdate` → `applyOriginUpdate`
  - `createUpstreamProbeRunner` → `createOriginProbeRunner`
  - `UpstreamUpdateResult` / `UpstreamUpdateContext` → `OriginUpdateResult`
    / `OriginUpdateContext`
  - `UpstreamProbeRunnerOpts` / `UpstreamProbeRunner` → `OriginProbeRunnerOpts`
    / `OriginProbeRunner`
  - `UpstreamManualChoice` / `UpstreamProbeCompleteEvent` /
    `UpstreamProbeResult` / `UpstreamRepoMetadata` / `UpstreamLastCommit`
    → respective `Origin*` names
    Per CLAUDE.md's "post-1.0 backcompat-conscious" policy, the aliases shipped
    with `@deprecated` re-exports through v1.0.x; v1.1.0 cuts them.

### Fixed

- **Register no longer adopts into the pre-v0.11.3 flat path.**
  `adoptIntoRegistry`, `repairBrokenLinks`, and `resolveSkillConflicts` were
  all joining `skills/<name>/` directly — the pre-bucket-split layout. The
  walker only descends `skills/personal/` and `skills/vendored/`, so any
  Register-flow adoption landed in a directory the index couldn't see.
  Symptom: a registered skill stuck in "Fix broken link (0)" with no
  actionable repair. Fix: new `findSkillFolder(root, name)` helper in
  `registry.ts`; default adoption destination is `skills/personal/<name>/`;
  existing-bucket detection preserves the location when the skill already
  lives in one.
- **`classifyDrawerState` no longer falls through to `unregistered-broken`
  for `kind: "ours"` installs with no index entry.** A symlink whose target
  resolves inside the registry tree but isn't tracked by any
  `RegistryEntry` (the github-actions-docs symptom above) now routes to
  `unregistered-foreign` with `primary: register`. Combined with the bucket
  fix, clicking Register heals the stale layout by relocating the folder
  into the correct bucket.
- **In-app Origin Update synthesizes `meta.json` when upstream lacks one.**
  Symptom: a user clicks Update on a vendored skill whose upstream no longer
  ships `meta.json`; the local copy ends up without one; `pnpm validate`
  fails on the next run. The CLI path (`vendor:skill`) already synthesized
  from SKILL.md frontmatter; the runtime in-app path didn't carry the same
  logic. Fix: extracted the synthesis into a shared `synthesizeSkillMeta` in
  `@skills-bank/core`; both call sites now route through it.
  ([bug report](https://github.com/Tyler-Reagan/skills-bank/blob/main/docs/bug-reports/2026-05-19-origin-update-missing-meta-synthesis.md))
- **In-app Origin Update validates `meta.json` after mirror and rolls back
  on schema failure.** Symptom: an upstream `meta.json` with an empty
  description (or any other schema violation) gets baselined into
  `.skills-bank.json` as the new canonical state; drift detection then
  treats the broken state as "the new normal." Fix: `applyOriginUpdate`
  now stashes the pre-mirror skill folder to a scratch dir, runs synthesis
  - `validateSkillMeta` after mirror, and restores from scratch if
    validation fails. The Update result surfaces the specific Ajv error
    messages so the user knows what's wrong upstream.
    ([bug report](https://github.com/Tyler-Reagan/skills-bank/blob/main/docs/bug-reports/2026-05-19-origin-update-missing-validation.md))

### Removed

- **Dead `diff` dependency** from `packages/desktop/package.json`. Knip-
  flagged; no source reference.

### Maintenance

- 29 local + 23 remote stale branches deleted (all fully merged into main).
- Knip output now zero — no unused dependencies, no unused exports, no
  duplicate exports, no configuration hints.
- ADR test foundation extended from 5 suites to 7+ (Suite 6: `forkSkill`,
  Suite 7: `pushSkillFolder`; Suite 8 lands when the in-app-publish plan's
  M1 ships).
- Two bug reports filed under `docs/bug-reports/` for in-app Origin Update
  gaps surfaced during working-tree cleanup
  (`2026-05-19-origin-update-missing-meta-synthesis.md` and
  `2026-05-19-origin-update-missing-validation.md`); both fixes shipped in
  this release (see Added → `@skills-bank/core` exports and
  stash-and-restore rollback; see Fixed → synthesizes / validates).
- Test count: 82 (was 64 — +18 for `skill-meta.test.ts`).
- ~100 lines of duplicated frontmatter parsing and validation removed from
  `scripts/vendor-skill.ts` and `scripts/update-skill.ts`; both now import
  the shared helpers from `@skills-bank/core`.

---

## v1.0.1

Dev-experience hardening and two small visual fixes. No user-facing feature
changes for packaged-app users; SDK surface unchanged.

### Added

- **Dev-mode isolation.** Unpackaged runs (`pnpm dev` / `pnpm start`) now
  redirect every persistent side effect (userData, per-agent skill sinks) into
  `~/.skills-bank-dev/`, with window title "Skills Bank (Dev)". The packaged
  install's userData (`~/Library/Application Support/Skills Bank/`) and skill
  sinks (`~/.claude/skills/`, `~/.cursor/skills/`, etc.) are now genuinely
  untouchable from a local clone. New env var `SKILLS_BANK_HOME_OVERRIDE`
  consulted by `getAgentSkillsDir` in `packages/core/src/agents.ts` — backwards
  compatible (defaults to `os.homedir()` when unset).
- **`CLAUDE.md` documents the isolation pattern** under Conventions so future
  agents reading repo context can rely on the boundary.

### Changed

- **`pnpm reset` / `reset:hard` no longer target the packaged install's
  userData** — only the dev path. Pre-isolation the script wiped both, which
  re-introduced cross-contamination on every reset.

### Fixed

- **Header skill-update badge now visually distinct from the app-update badge.**
  Both badges previously used identical green styling despite the CSS comment
  claiming they were "distinct." Skill-updates now uses `--warn` amber so the
  green/amber pairing maps to "app binary update" vs "skill content updates"
  at a glance.
- **Registry tab filter popovers no longer paint behind skill cards.** The
  filter-glossary and "Tags ▾" panels had `z-index: 20` but lived inside a
  container that didn't establish a stacking context; each `.skill-card`'s
  `transform: translateZ(0)` (paint-perf hint) stacked them above the popovers.
  Lifting `.filters-section` to its own stacking context fixes both popovers
  in one rule.

---

## v1.0.0

The release marker — Skills Bank exits the pre-1.0 maintainer-only era. No new
features in this release on its own; the cut is structural and signals API
stability for `packages/core` and the IPC surface.

### Changed

- **Public-surface stance flips from "cut hard" to "deprecation aliases for one
  minor cycle"** for `@skills-bank/core` exports and `.skills-bank.json` schema
  changes. Renderer-internal types stay flexible. See `CLAUDE.md` conventions.
- All workspace package versions bumped to `1.0.0` for monorepo coherence (core,
  desktop, cli).

### Fixed

- **Account header avatar no longer fails to load.** CSP `img-src` was implicit
  `default-src 'self'`, blocking the GitHub avatar fetched from
  `avatars.githubusercontent.com`. Explicit `img-src 'self' data:
https://avatars.githubusercontent.com` allows it.

### Carried forward

- **v0.11.10 deprecation aliases retained for the v1.x cycle.** They were
  originally marked "drop in v0.12.0" but the v0.12.0 release didn't happen —
  the jump went straight to v1.0.0. Dropping them in v1.0.0 would give
  downstream consumers zero grace; instead they survive until v1.1.0 or later.

---

## v0.11.10 — Origin internal rename

Three-phase identifier rename across `packages/core`, IPC, and the renderer.
Internal `upstream` → `origin` to align with the user-facing copy that landed in
v0.11.4. Deprecation aliases for every renamed type / function / IPC channel so
downstream consumers had a soft landing.

Deferred from the plan: the `SkillSource.upstream` JSON-field rename (wants its
own migration sweep across the 66 committed `.skills-bank.json` markers) and
the `acceptDriftKeepLocal` / `SeverUpstream` / `TakeCanonical` heal-action
renames (plan didn't pin exact targets).

## v0.11.9 — Core architecture refactor

Eight milestones consolidating `packages/core` and shrinking `main.ts`.

- **M1** `SkillRecord` facade — unified read/write surface over the three
  per-skill sidecars.
- **M2** Probe scheduler → core (`createOriginProbeRunner`).
- **M3** Folder diff → core.
- **M4** `applyOriginUpdate` → core.
- **M5** Conflict-resolution unification — shared `applyConflictDecision()`.
- **M6** `computePublishStates` → its own module, with injection escape hatch.
- **M7** **Persistent probe cache** — relaunching within the 5-min TTL no longer
  re-probes upstream. Sole user-visible win in the release.
- **M8** Extracted `commitGithubLinkage(meta)`; full split deferred.

Plus a follow-up fix that preserves user-curated `meta.json` tags across Update
(parity with Sync's existing tag-splice).

## v0.11.8 — Security hardening

- **ADR-0004** `safeStorage` tier with notice — Linux users on systems without a
  keyring see a one-time toast explaining the weak-encryption fallback.
- **ADR-0005** `toggleDevTools` removed from packaged builds — keeps the
  console-paste social-engineering vector off-surface. Dev launches unchanged.
- M5 path guardrails — `setRegistryRoot` and `pickCustomSkillsDir` warn when the
  user picks the filesystem root, their home directory, or common POSIX system
  paths.
- M1 stricter CSP, M3 device-flow encryption, M6 Discover CSP — deliberately
  deferred with rationale in the plan.

## v0.11.7 — Core test foundation

- vitest@2 wired into `packages/core`. 63 tests across 5 suites covering the
  contracts named in ADR-0001: `hashSkillFolder`, `applyCanonicalSync`,
  `mergeImportRegistry`, `mirrorSkillFolder` (partial-failure invariant),
  `classifyDrawerState`.
- **Three ADRs** under `docs/adr/`:
  - **ADR-0001** Test entry criteria.
  - **ADR-0002** Three-sidecar Skill record stays split.
  - **ADR-0003** Direct-fetch Update vs `npx skills update`.
- **M8 `fetchedAt` probe-path fix** — moved out of the committed
  `.skills-bank.json` into a gitignored `.skills-bank-runtime.json` sidecar,
  killing the recurring marker churn after every app launch.

## v0.11.6 — Renderer state architecture

- M1 `useRescanController` hook — collapsed five App.tsx touchpoints of the
  Rescan button state machine into one tested-ready unit.
- M2 `RegistryHostContext` provider — toast and AppError state hoisted out of
  App.tsx; flash callbacks reach consumers via context.
- M3 (follow-up) `DrawerHost` extraction — pulled the giant IIFE around
  `SkillDetailDrawer` and its capability-gated callbacks into a focused 287-LOC
  component. The remaining host extractions (UpdateHost / ConflictHost /
  RegistryHost) are low-priority cleanup, deferred.

## v0.11.5 — A11y polish

- Modal focus-trap hook (`useFocusTrap`) applied to RepoPickerModal,
  UpdatesModal, and SkillDetailDrawer's confirm-delete sub-dialog.
- `useReducedMotion` hook gates JS-driven `animationDelay` styles for users
  who opted into reduced motion.
- TagFilter `role="checkbox"` → `aria-pressed` for proper SR semantics.
- Plus three follow-up polishes:
  - **Unblocked blank window** — preload bundled to CJS (sandbox-compatible)
    and hoisted two `useMemo`s above the App.tsx auth early-return.
  - **Focus-ring clipping fix** — global `:focus-visible` default flipped to
    `outline-offset: 0` to eliminate the Chromium overflow-x-collapse class of
    bugs.
  - **Filter chip glossary popover** + degenerate-chip suppression in
    `RegistryFilters` (chips that match all or none auto-hide; the info-icon
    popover surfaces axis definitions on demand).
