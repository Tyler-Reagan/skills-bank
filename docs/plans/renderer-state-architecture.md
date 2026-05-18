# Renderer state architecture (v0.11.6)

Lands the three deferred renderer refactors from the v0.11.4 typescript-react-reviewer audit (`docs/audits/v0.11.4-react-review.md` §D1–D3). Theme: **App.tsx stops being a 2,316-line monolith.**

Behavior-neutral. The user shouldn't see a single observable change. Internal call-graph and prop-drilling get rebuilt.

## Milestones

1. **`useRescanController` hook.** Collapse the rescan state machine — currently five touch-points in App.tsx (state, refs, cleanup effect, click handler, probe-complete branch, view-deeplink callback) — into one tested unit. Hook signature: `useRescanController({ refresh, flashError, setRegistryFilters, setTabPersisted }) → { state, onRefreshClick, onViewUpdates }`. Internal listener for `onUpstreamProbeComplete`.
2. **`RegistryHostContext` provider.** Expose `{ flash, flashError, refresh, pushAppError, dismissAppError }` via context. Today these are threaded as props through >70 call sites in App.tsx alone, plus deeper drilling into BrowseTab, drawer, modals. Prerequisite: move toast state + `<Toast>` renderer into the provider component (currently lives in App.tsx as the toast owner).
3. **App.tsx component split.** Gated on M2. Natural seams: `<RegistryHost>` (registry + installed + refresh + sync + repo picker), `<UpdateHost>` (auto-update state + UpdateNotesModal), `<ToastHost>` (overlaps with M2), `<ConflictHost>` (conflict modals + delete confirmation), `<DrawerHost>` (the giant IIFE around `<SkillDetailDrawer>` and its capability-gated callbacks, App.tsx:2021–2278).

## Recommended execution order

M1 → M2 → M3, in sequence. M3 is gated on M2 (without context, the splits would re-introduce prop-drilling).

## Conflict audit

- **vs v0.11.5 a11y polish.** A11y lands first. The component splits in M3 would force a redo of focus-trap wiring on each new component otherwise.
- **vs v0.11.9 core refactor.** Different package surfaces (renderer vs core). Independent.
- **vs v0.11.10 Origin rename.** Identifier-level. Worth landing v0.11.6 first so the rename codemod targets the post-split file layout.

## Estimated blast radius

- M1: ~80 LOC moved, no new tests required.
- M2: ~150 LOC churn (mostly mechanical drop of props) + a new provider component.
- M3: large file moves; per-host file ≤300 LOC budget. App.tsx becomes a thin shell composing the hosts.

## Exit criteria

- `App.tsx` ≤300 LOC.
- No `flash` / `refresh` / `pushAppError` / `flashError` prop in any leaf component.
- Manual smoke test: all v0.11.0–v0.11.4 features still work identically (rescan, refresh, sync, conflict resolution, drift heal, update modal, settings, account).
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm knip && pnpm build` clean.
