# Renderer inventory

Reference inventory of everything under `src/renderer/`: what each component,
hook, context, and support file does and who consumes it. Repo-internal — not
published to the docs site (`packages/docs/` is the published surface).

> **Freshness: accurate as of commit `d052aed` on `main`
> (2026-07-09).** LOC and used-by columns are snapshots from
> that tree. When the renderer changes materially, re-verify (`wc -l`, grep
> the import graph) and re-stamp this line — or distrust the numbers and
> trust only the purposes, which drift slower.

Tables are sorted alphabetically by file name.

## v1.21 consolidation audit

The desktop half of the v1.21 consolidation pass (core's map lives in
`packages/core/src/INVENTORY.md`). Audited: every module's consumer count,
`@deprecated` exports (none exist), main↔renderer layering (clean —
`auth-config` renderer hits are UI copy naming the file, not imports), the
"every hook has ≥1 real consumer" claim (verified — `useReducedMotion`'s
consumer is intra-hooks: `useAutoDismiss`), and the styles.css orphan
checker (results below). Conclusion: **no module moves or merges are
justified** — every small file is multi-consumer or a documented
convention (`skillState.ts` Vite-safety re-export, `agentDisplay.ts`
8 consumers, hooks one-per-file). What the pass did change:

- **styles.css sweep**: deleted the dead `register-modal-*` section
  (16 classes — RegisterModal no longer uses any of them), `.mt-10`, and
  `.row-end-6` (−83 lines).
- **Dead `docs/plans/` pointers** removed from doc comments in `App.tsx`,
  `AccountModal.tsx`, `shared/ipc.ts`, `main/main.ts` (the directory was
  retired in v1.6; pointers now cite the CHANGELOG).
- **`main/INVENTORY.md` replaced**: it held the shipped registry-IPC-
  primitives plan (work landed in #118); it's now the reference inventory
  of `src/main/` + `shared/ipc.ts` in this file's style.

The standing observations below were re-checked and still hold (their
trigger conditions remain unmet).

## Structure conventions

- `*Modal` — full overlay routed through `ModalHost` (single-slot: at most
  one open, swapping not stacking).
- `*Dialog` — small confirm-style affordance.
- `Drawer*` — sub-panels composed by `SkillDetailDrawer`.
- `primitives.tsx` — stateless rendered micro-primitives; `modalStyles.tsx`
  — modal chrome. A component earns its own file when it has state or a
  domain; pure shared chrome lives in these two gathering files.
- `components/manifest/` — the manifest import/export feature cluster.

## components/ (46 files)

| File                          | LOC  | Purpose                                                                                                                                                                                                                                                                        | Used by                                                                                                       |
| ------------------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| AccountModal.tsx               | 207  | Identity, registry source, move-my-registry (disk import/merge, manifest entry point)                                                                                                                                                                                        | ModalHost                                                                                                       |
| browseFilters.ts               | 130  | Browse-tab filter/sort algebra: `RegistryFilterTag` / `RegistrySortState` types, `CHIP_DEFS` (chip predicate + label + title), `applyChipFilters` (AND), `applySort`, `floatToTop`. Consumed by BrowseTab + the browse hooks, so kept out of `RegistryFilters.tsx`           | BrowseTab, RegistryFilters, useBrowseFilters, useRescanController                                               |
| BrowseTab.tsx                  | 613  | Registry view; collapsible category sections, `GhostBand` manifest-import ghost cards, search/tag/sort filter pipeline                                                                                                                                                       | App                                                                                                              |
| BulkInstallModal.tsx           | 404  | Bulk install: filter/select skills → per-row install progress → done summary                                                                                                                                                                                                 | ModalHost                                                                                                       |
| CategorySelect.tsx             | 260  | Searchable category combobox: grouped by meta-category (engineering/research/business/creative/productivity), keyboard nav, filter-mode ("All"/"Uncategorized") vs edit-mode ("None") option sets                                                                            | DrawerLabelSection, ManageLabelsModal                                                                           |
| ConfirmDialog.tsx              | 88   | Generic confirm dialog (title, body, button labels, tone)                                                                                                                                                                                                                    | ManageLabelsModal, ModalHost                                                                                     |
| ConflictModal.tsx              | 70   | Generic stateless conflict-modal shell (Modal chrome + title/description/sides/footer options) driven by a `ConflictAdapter`                                                                                                                                                 | ConflictResolver                                                                                                 |
| ConflictResolver.tsx           | 295  | Generic resolver skeleton built over ConflictModal: bulk "Select all" toolbar + per-row `ConflictActionPicker` + live tally + Cancel/Apply footer, assembled into a `ConflictAdapter`. Picks are controlled — state lives in each domain wrapper. Two resolver domains remain (the former sync-collision domain was retired) | InstallCollisionModal, ManifestConflictModal                                                                    |
| ConnectGithubModal.tsx         | 281  | GitHub device-flow auth (start / resume)                                                                                                                                                                                                                                     | ModalHost                                                                                                       |
| DeleteUnregisteredDialog.tsx   | 132  | Structured delete confirm for unregistered skills (lists what's deleted vs unlinked)                                                                                                                                                                                         | ModalHost                                                                                                       |
| DestinationPickerDialog.tsx    | 202  | Agent-dir picker when an unregister destination collides                                                                                                                                                                                                                     | ModalHost                                                                                                       |
| DiscoverTab.tsx                | 357  | skills.sh embedded WebContentsView + install callout (paste `npx skills add` or GitHub URL → direct install to agent dir); `DiscoverEmpty` error card internal                                                                                                              | App                                                                                                              |
| DrawerActions.tsx              | 588  | Capability-gated action panel at the bottom of the drawer (install, register, unregister, repair, update, …) + repair confirm sub-dialog; renders RestoreOriginModal for unreachable origins                                                                                | SkillDetailDrawer                                                                                                |
| DrawerLabelSection.tsx         | 125  | Category + tags override UI backed by LabelsContext                                                                                                                                                                                                                          | SkillDetailDrawer                                                                                                |
| DrawerOriginSection.tsx        | 276  | Origin metadata (repo, stars, path, last commit) + manual-link picker for unlinked-adopted skills                                                                                                                                                                            | SkillDetailDrawer                                                                                                |
| ErrorPanel.tsx                 | 133  | Persistent dismissable error surface: expandable details, copy button, suggested-action buttons                                                                                                                                                                              | App                                                                                                              |
| Header.tsx                     | 482  | App chrome: brand, refresh/sync/check-updates/local-scan buttons, theme + density toggles, account chip; `ImportIndicator` manifest-progress chip internal                                                                                                                   | App, SettingsContext                                                                                             |
| Icon.tsx                       | 244  | Icon registry: 35+ inline Lucide SVGs behind a name/size/stroke API                                                                                                                                                                                                          | ~25 files                                                                                                        |
| InstallCollisionModal.tsx      | 261  | Agent-dir collision resolver (per-agent rows, per-row error retry, delete-all confirmation gate, registered vs unregistered action variants); wrapper over ConflictResolver                                                                                                  | ModalHost                                                                                                       |
| InstallConflictModal.tsx       | 107  | Pre-install gate when something blocks symlink creation: Cancel / Resolve per-agent (bounces to InstallCollisionModal) / Force. A gate, not a resolver — deliberately not on ConflictResolver                                                                                | ModalHost                                                                                                       |
| installedGrouping.ts           | 102  | Pure grouping logic for the Installed tab: `InstalledGroup` type, `ClassifiedGroup` type, `aggregateByName` (dedupe per-agent installs by name, upgrade-to-`ours`), private `kindRank`. Kept out of the `.tsx` so App/ModalHost import the type from non-presentational code | App, InstalledTab, ModalHost, NeedsAttentionSection                                                             |
| InstalledTab.tsx               | 447  | Installed view orchestrator: computes groups/classification, renders intro + counts, composes `NeedsAttentionSection` and the inline unregistered / registered sections; `LocalScanResultsSection` sub-component still inline                                                | App, ModalHost                                                                                                   |
| KeyboardShortcutsOverlay.tsx   | 61   | Static keyboard-shortcuts reference table                                                                                                                                                                                                                                    | ModalHost                                                                                                       |
| ManageLabelsModal.tsx          | 599  | Registry-wide label management: browse/edit categories + tags per skill (via CategorySelect), bulk clear, 3-step auto-generate flow (scope → skills → review)                                                                                                               | ModalHost                                                                                                       |
| ManageLinksModal.tsx           | 173  | Per-agent symlink management: plan → applying → result                                                                                                                                                                                                                       | ModalHost                                                                                                       |
| manifest/DiskTransport.tsx     | 72   | OS-dialog manifest export/import transport                                                                                                                                                                                                                                   | ManifestModal                                                                                                   |
| manifest/ManifestModal.tsx     | 111  | Manifest transport-mode wrapper (repo vs disk)                                                                                                                                                                                                                                | ModalHost                                                                                                       |
| manifest/RepoTransport.tsx     | 387  | Manifest push / pull-merge pane for the linked-repo transport (`ExportView`/`ImportView`, diff preview, rate-limit handling)                                                                                                                                                 | ManifestModal                                                                                                   |
| ManifestConflictModal.tsx      | 169  | Manifest 3-way merge resolver (base/ours/theirs intent compare rows); wrapper over ConflictResolver                                                                                                                                                                          | ModalHost                                                                                                       |
| MetricsTab.tsx                 | 178  | Metrics tab: per-skill invocation counts from the local hook log. Three states (tracking is opt-in via Settings) — off+no-history full-page CTA, off+history "currently off" notice over the prior stats, on ranked usage list + summary + coverage line                    | App                                                                                                              |
| ModalHost.tsx                  | 993  | Modal router: `ActiveModal` discriminated union → one rendered modal, plus inline handlers for resolve-all, overwrite, and bulk-repair flows; internal `DrawerHost` wires SkillDetailDrawer (capability-gated callbacks)                                                     | App                                                                                                              |
| modalStyles.tsx                | 118  | Modal chrome: `Modal` (scrim, focus trap, Escape, width union), `ModalCloseButton`, layout class constants                                                                                                                                                                   | ~16 files                                                                                                        |
| NeedsAttentionSection.tsx      | 160  | Installed tab's "Needs attention" section: bulk repair/resolve header buttons + per-card inline action routing (repair-broken / resolve-conflicts / resolve-registration-conflicts). Extracted from an inline IIFE in InstalledTab                                           | InstalledTab                                                                                                     |
| primitives.tsx                 | 191  | Stateless micro-primitives: `SearchBar`, `InfoTooltip`, `DisclosureChevron`, `SkillTagList`, `SplashScreen`                                                                                                                                                                  | AccountModal, App, BrowseTab, BulkInstallModal, InstalledTab, ManageLabelsModal, RepoTransport, SettingsModal   |
| RegistrationPlanModal.tsx      | 496  | Scan agent dirs → plan → apply registration ("Register All"); fans registrations out to Settings' default install agents when configured                                                                                                                                    | ModalHost                                                                                                       |
| RegistryFilters.tsx            | 473  | Filter chip strip (state + bucket), installed-only toggle, sort controls, tags dropdown (`TagFilter` internal sub-component) — presentation only; the filter/sort algebra lives in `browseFilters.ts`                                                                        | BrowseTab                                                                                                       |
| RepoPickerModal.tsx            | 147  | Linked-repo picker over the authenticated user's repos                                                                                                                                                                                                                       | ModalHost                                                                                                       |
| RestoreOriginModal.tsx         | 178  | Restore an unreachable origin (ADR-0012): repoint to a new GitHub URL, re-home into the linked repo via a PR, or detach to keep the skill local-only — no auto-discovery by design. Rendered directly by DrawerActions, not routed through ModalHost's `ActiveModal` union   | DrawerActions                                                                                                    |
| SettingsModal.tsx              | 358  | App preferences: default install agents, grid columns, search debounce, terminal app (macOS), unregister-destination agent, origin-activity toggle                                                                                                                          | App, ModalHost                                                                                                   |
| SkillCard.tsx                  | 414  | Grid card: name, description, quick tag edit, `StateBadge` (MISSING / UNREACHABLE / UPDATE), `StatusChip` (install kind), bulk-select mode                                                                                                                                   | InstalledTab, SkillsGrid                                                                                        |
| SkillDetailDrawer.tsx          | 396  | Skill detail panel: metadata, tag editing, SKILL.md preview; composes DrawerLabelSection, DrawerOriginSection, DrawerActions                                                                                                                                                 | ModalHost (internal DrawerHost)                                                                                 |
| SkillsGrid.tsx                 | 108  | Dumb entries → SkillCard mapper + empty state with optional clear-filters CTA                                                                                                                                                                                                | BrowseTab                                                                                                       |
| skillState.ts                  | 8    | Vite-safety re-export of `classifyDrawerState` from `@skills-bank/core/skill-state` (renderer must not deep-import core)                                                                                                                                                     | InstalledTab, ModalHost, SkillDetailDrawer                                                                       |
| Tabs.tsx                       | 68   | Tab nav (Browse / Installed / Discover / Metrics) with counts + arrow-key navigation                                                                                                                                                                                         | App                                                                                                              |
| UpdateNotesModal.tsx           | 153  | App release notes + download/restart flow (app updates — distinct from skill UpdatesModal)                                                                                                                                                                                   | ModalHost                                                                                                       |
| UpdatesModal.tsx               | 160  | Skill-origin updates list with per-row and update-all actions (skill updates — distinct from app-release UpdateNotesModal)                                                                                                                                                   | ModalHost                                                                                                       |

## Renderer root

| File                     | LOC  | Purpose                                                                                                                                                                     |
| ------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| agentDisplay.ts          | 18   | `AGENT_LABELS` / `AGENT_PATHS` display constants                                                                                                                            |
| App.tsx                  | 956  | Root composition: provider nest (ModalRegistry → RegistryHost → Settings → Registry → Labels), tab state, suggested-action dispatch, review-session state, ModalHost wiring |
| index.html               | —    | Vite shell                                                                                                                                                                  |
| LabelsContext.tsx        | 44   | Shared labels map + single `reload()` all label surfaces subscribe to                                                                                                       |
| main.tsx                 | 12   | Entry point                                                                                                                                                                 |
| ModalRegistryContext.tsx | 77   | Mounted-`<Modal>` counter; `useAnyModalOpen` replaces hand-curated OR-chains                                                                                                |
| RegistryContext.tsx      | 198  | Registry/installed snapshots + refresh/rebuild lifecycle (the only mutation entry points)                                                                                   |
| RegistryHostContext.tsx  | 213  | Toast + AppError state and rendering; flash/flashError/pushAppError callbacks                                                                                               |
| SettingsContext.tsx      | 158  | AppSettings object + theme/density scalars, persisted to localStorage, dataset writes                                                                                       |
| styles.css               | 5393 | Single global stylesheet                                                                                                                                                    |
| theme.css                | 147  | Theme variables                                                                                                                                                             |
| useRegisterSkill.ts      | 68   | Single-skill Register action: moves the skill's files into the bank + links the default install agents; flashes + refreshes. Bulk "Register All" uses `RegistrationPlanModal` instead |

### styles.css orphan checker

After removing components, re-run: extract `^\.([\w-]+)` class selectors from
`styles.css` and grep each against `renderer/**/*.ts*`. Treat
template-literal-composed names as live — currently
`modal-body--w${width}` (modalStyles) and
`bulk-install-progress-row--${status}` (BulkInstallModal). A selector whose
every compound requires a dead class can never match and is safe to delete.

Last run 2026-06-09 (v1.21 consolidation): removed the orphaned
`register-modal-*` section (16 classes), `.mt-10`, `.row-end-6`. The two
template-literal families above were the only false positives.

## hooks/ (10 files)

| File                         | LOC | Purpose                                                                                 |
| ---------------------------- | --- | --------------------------------------------------------------------------------------- |
| useBrowseFilters.ts          | 93  | BrowseTab filter state + localStorage persistence (sort intentionally session-only)     |
| useDisclosure.ts             | 21  | Boolean expand/collapse state with stable toggle                                        |
| useEscapeToClose.ts          | 48  | Stacked Escape handling: only top-of-stack closes per keypress                          |
| useFocusReturn.ts            | 51  | Restore focus to the opener on modal close                                              |
| useFocusTrap.ts              | 85  | Tab-focus trap for modals/drawer                                                        |
| useIpcQuery.ts               | 110 | Cancellation-aware `useEffect → IPC → setState` boilerplate                             |
| useManifestImportProgress.ts | 84  | Per-skill progress feed for in-flight manifest imports (Header chip + BrowseTab ghosts) |
| useModalRouter.ts            | 26  | Single-slot modal union state (open replaces, never stacks)                             |
| useRescanController.ts       | 177 | Header rescan button state machine end-to-end                                           |
| useUpdateFeed.ts             | 65  | Auto-update status feed + per-version dismissal gate                                    |

Every hook has ≥1 real consumer and a distinct job.

## Sizing philosophy + standing observations

Components scale to their **current** job: pure glue gets folded into its
only consumer now (and re-extracted later if it grows a real job), and
abstractions are built when the need exists — never "kept in case" or
"folded if it never grows". Applied to date: DrawerHost (pure glue,
single consumer) folded into ModalHost in #115.

Standing observations — each states the condition that triggers action,
where the condition is a present-tense fact check, not a hypothetical:

- **App.tsx** (956L): largest renderer file; prior extractions (contexts,
  hooks) all came from here. Extract the suggested-action dispatch table or
  review-session state when either next changes for a feature — not before.
- **ModalHost** (993L incl. internal DrawerHost): resolver routing is thin
  pass-throughs; the inline resolve-all / overwrite / bulk-repair handlers
  become components when one of them next grows multi-step state.
- **ConfirmDialog body-slot**: rebase `DeleteUnregisteredDialog` /
  `DestinationPickerDialog` on `ConfirmDialog` when a third specialized
  confirm appears — two instances is not yet a pattern.
