# Changelog

All notable changes to Skills Bank. Format follows [Keep a Changelog](https://keepachangelog.com/);
versions follow [Semantic Versioning](https://semver.org/).

## v1.1.1

Patch release closing two related correctness gaps in the in-app Origin
Update flow surfaced during the v1.1.0 working-tree cleanup. Both bugs
were filed under `docs/bug-reports/` (2026-05-19) and fix bundled here.

### Fixed

- **In-app Origin Update synthesizes `meta.json` when upstream lacks
  one.** Symptom: a user clicks Update on a vendored skill whose
  upstream no longer ships `meta.json`; the local copy ends up without
  one; `pnpm validate` fails on the next run. The CLI path
  (`vendor:skill`) already synthesizes from SKILL.md frontmatter; the
  runtime in-app path didn't carry the same logic. Fix: extracted the
  synthesis into a shared `synthesizeSkillMeta` in
  `@skills-bank/core`; both call sites now route through it.
- **In-app Origin Update validates `meta.json` after mirror and rolls
  back on schema failure.** Symptom: an upstream `meta.json` with an
  empty description (or any other schema violation) gets baselined
  into `.skills-bank.json` as the new canonical state; drift
  detection then treats the broken state as "the new normal." Fix:
  `applyOriginUpdate` now stashes the pre-mirror skill folder to a
  scratch dir, runs synthesis + `validateSkillMeta` after mirror, and
  restores from scratch if validation fails. The Update toast surfaces
  the specific reason (Ajv error messages) so the user knows to ping
  the upstream's maintainer or accept their local copy via heal.

### Added

- **`@skills-bank/core` exports** `parseSkillFrontmatter`,
  `synthesizeSkillMeta`, `validateSkillMeta`, `SKILL_META_SCHEMA`.
  All four are discoverable from `@skills-bank/core` so the
  maintainer scripts, the in-app runtime, and external SDK consumers
  share one contract for "what makes a valid skill meta.json."
- **Test suite** in `packages/core/src/skill-meta.test.ts` (18 tests)
  pinning the frontmatter parser, the synthesis decision tree, the
  validation discriminated union, and parity between `SKILL_META_SCHEMA`
  (the runtime-bundled copy) and `docs/meta-schema.json` (the canonical
  published version).

### Changed

- **`scripts/vendor-skill.ts` and `scripts/update-skill.ts`** now
  import the shared helpers instead of carrying local copies of the
  frontmatter parser, the synthesis function, and the validation
  logic. The CLI path's behavior is unchanged; the implementation
  moved.

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
