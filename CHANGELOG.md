# Changelog

All notable changes to Skills Bank. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

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
  `2026-05-19-origin-update-missing-validation.md`). Fix queued for the
  next release.

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
