# Changelog

All notable changes to Skills Bank. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

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

No new IPC channels. No new on-disk schema changes beyond the gitignored runtime sidecar's new fields (backward-compatible defaults). No cache layer; the local content under `skills/.../<name>/` *is* the cache by virtue of v1.2's discovery mount.

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
  must migrate to the canonical Origin* names:
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
  + `validateSkillMeta` after mirror, and restores from scratch if
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
