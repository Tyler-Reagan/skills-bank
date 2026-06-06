# Renderer inventory

Reference inventory of everything under `src/renderer/`: what each component,
hook, context, and support file does and who consumes it. Repo-internal — not
published to the docs site (`packages/docs/` is the published surface).

> **Freshness: accurate as of commit `e1fbdf6` (2026-06-05), branch
> `refactor/renderer-cheap-wins`.** LOC and used-by columns are snapshots from
> that tree. When the renderer changes materially, re-verify (`wc -l`, grep
> the import graph) and re-stamp this line — or distrust the numbers and
> trust only the purposes, which drift slower.

## Structure conventions

- `*Modal` — full overlay routed through `ModalHost` (single-slot: at most
  one open, swapping not stacking).
- `*Dialog` — small confirm-style affordance.
- `Drawer*` — sub-panels composed by `SkillDetailDrawer`.
- `primitives.tsx` — stateless rendered micro-primitives; `modalStyles.tsx`
  — modal chrome. A component earns its own file when it has state or a
  domain; pure shared chrome lives in these two gathering files.
- `components/manifest/` — the manifest import/export feature cluster.

## components/ (43 files)

| File                                    | LOC  | Purpose                                                                                                                                                                                                                  | Used by                                                                                          |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| ManageLabelsModal.tsx                   | 1214 | Registry-wide label management: browse/edit categories + tags per skill, bulk clear, 3-step auto-generate flow (scope → skills → review)                                                                                 | ModalHost                                                                                        |
| ModalHost.tsx                           | 1164 | Modal router: `ActiveModal` discriminated union → one rendered modal, plus inline handlers for resolve-all, overwrite, and bulk-repair flows; internal `DrawerHost` wires SkillDetailDrawer (capability-gated callbacks) | App                                                                                              |
| InstalledTab.tsx                        | 706  | Installed view; needs-attention / unregistered / registered sections; `CustomSkillsDirs` and `LocalScanResultsSection` sub-components                                                                                    | App, ModalHost                                                                                   |
| BrowseTab.tsx                           | 604  | Registry view; collapsible category sections, `GhostBand` manifest-import ghost cards, search/tag/sort filter pipeline                                                                                                   | App                                                                                              |
| DrawerActions.tsx                       | 587  | Capability-gated action panel at the bottom of the drawer (install, register, unregister, repair, update, …) + repair confirm sub-dialog                                                                                 | SkillDetailDrawer                                                                                |
| RegistryFilters.tsx                     | 583  | Filter chip strip (state + bucket), installed-only toggle, sort controls, tags dropdown (`TagFilter` internal sub-component)                                                                                             | BrowseTab                                                                                        |
| SkillDetailDrawer.tsx                   | 559  | Skill detail panel: metadata, tag editing, SKILL.md preview; composes DrawerLabelSection, DrawerOriginSection, DrawerActions                                                                                             | ModalHost (internal DrawerHost)                                                                  |
| RegisterModal.tsx                       | 499  | Scan agent dirs → plan → apply registration ("Register All")                                                                                                                                                             | ModalHost                                                                                        |
| SettingsModal.tsx                       | 485  | App preferences: agents, debounce, grid layout, hidden skills, symlink finalization                                                                                                                                      | App, ModalHost                                                                                   |
| Header.tsx                              | 483  | App chrome: brand, refresh/sync/check-updates/local-scan buttons, theme + density toggles, account chip; `ImportIndicator` manifest-progress chip internal                                                               | App, SettingsContext                                                                             |
| SkillCard.tsx                           | 429  | Grid card: name, description, quick tag edit, `StateBadge` (MISSING / UNREACHABLE / UPDATE / CURATED), `StatusChip` (install kind), bulk-select mode                                                                     | InstalledTab, SkillsGrid                                                                         |
| BulkInstallModal.tsx                    | 404  | Bulk install: filter/select skills → per-row install progress → done summary                                                                                                                                             | ModalHost                                                                                        |
| manifest/RepoTransport.tsx              | 383  | Manifest push / pull-merge pane for the linked-repo transport (`ExportView`/`ImportView`, diff preview, rate-limit handling)                                                                                             | ManifestModal                                                                                    |
| DiscoverTab.tsx                         | 360  | skills.sh embedded WebContentsView + install callout (paste `npx skills add` or GitHub URL → direct install to agent dir); `DiscoverEmpty` error card internal                                                           | App                                                                                              |
| ConflictResolver.tsx                    | 288  | Generic resolver skeleton: Modal + bulk "Select all" toolbar + per-row `ConflictActionPicker` + live tally + Cancel/Apply footer. Picks are controlled — state lives in each domain wrapper                              | SyncConflictModal, InstallCollisionModal, ManifestConflictModal; ManageLabelsModal (picker only) |
| DrawerOriginSection.tsx                 | 287  | Origin metadata (repo, stars, path, last commit) + manual-link picker for unlinked-adopted skills                                                                                                                        | SkillDetailDrawer                                                                                |
| ConnectGithubModal.tsx                  | 282  | GitHub device-flow auth (start / resume)                                                                                                                                                                                 | ModalHost                                                                                        |
| AccountModal.tsx                        | 271  | Identity, registry source, move-my-registry (disk import/merge, manifest entry point)                                                                                                                                    | ModalHost                                                                                        |
| SyncBanner.tsx                          | 265  | Sync status banner above the tabs (fetching / applying / done / error) with expandable upserted/orphaned detail lists                                                                                                    | App                                                                                              |
| InstallCollisionModal.tsx               | 261  | Agent-dir collision resolver (per-agent rows, per-row error retry, delete-all confirmation gate, registered vs unregistered action variants); wrapper over ConflictResolver                                              | ModalHost                                                                                        |
| Icon.tsx                                | 244  | Icon registry: 35+ inline Lucide SVGs behind a name/size/stroke API                                                                                                                                                      | ~29 files                                                                                        |
| SyncConflictModal.tsx                   | 206  | Sync-collision resolver (per-skill rows, lazy diff loading via DiffViewer, `SyncDecisions` mapping); wrapper over ConflictResolver                                                                                       | ModalHost                                                                                        |
| DestinationPickerDialog.tsx             | 202  | Agent-dir picker when an unregister destination collides                                                                                                                                                                 | ModalHost                                                                                        |
| ManageLinksModal.tsx                    | 173  | Per-agent symlink management: plan → applying → result                                                                                                                                                                   | ModalHost                                                                                        |
| ManifestConflictModal.tsx               | 169  | Manifest 3-way merge resolver (base/ours/theirs intent compare rows); wrapper over ConflictResolver                                                                                                                      | ModalHost                                                                                        |
| UpdatesModal.tsx                        | 162  | Skill-origin updates list with per-row and update-all actions (skill updates — distinct from app-release UpdateNotesModal)                                                                                               | ModalHost                                                                                        |
| DrawerLabelSection.tsx                  | 160  | Category + tags override UI backed by LabelsContext                                                                                                                                                                      | SkillDetailDrawer                                                                                |
| primitives.tsx                          | 154  | Stateless micro-primitives: `SearchBar`, `InfoTooltip`, `DisclosureChevron`, `SkillTagList`, `SplashScreen`                                                                                                              | App, BrowseTab, BulkInstallModal, InstalledTab, ManageLabelsModal, RepoTransport, SyncBanner     |
| UpdateNotesModal.tsx                    | 153  | App release notes + download/restart flow (app updates — distinct from skill UpdatesModal)                                                                                                                               | ModalHost                                                                                        |
| RepoPickerModal.tsx                     | 147  | Linked-repo picker over the authenticated user's repos                                                                                                                                                                   | ModalHost                                                                                        |
| DiffViewer.tsx                          | 140  | Generic unified-diff renderer: per-file collapsible rows, presentational only                                                                                                                                            | SyncConflictModal                                                                                |
| ErrorPanel.tsx                          | 133  | Persistent dismissable error surface: expandable details, copy button, suggested-action buttons                                                                                                                          | App                                                                                              |
| DeleteUnregisteredDialog.tsx            | 132  | Structured delete confirm for unregistered skills (lists what's deleted vs unlinked)                                                                                                                                     | ModalHost                                                                                        |
| modalStyles.tsx                         | 118  | Modal chrome: `Modal` (scrim, focus trap, Escape, width union), `ModalCloseButton`, layout class constants                                                                                                               | 19 files                                                                                         |
| manifest/ManifestModal.tsx              | 111  | Manifest transport-mode wrapper (repo vs disk)                                                                                                                                                                           | ModalHost                                                                                        |
| manifest/ManifestImportConfirmModal.tsx | 111  | Post-import re-link confirmation (hoisted to App level so import → refresh → confirm sequences cleanly)                                                                                                                  | ModalHost                                                                                        |
| SkillsGrid.tsx                          | 108  | Dumb entries → SkillCard mapper + empty state with optional clear-filters CTA                                                                                                                                            | BrowseTab                                                                                        |
| InstallConflictModal.tsx                | 96   | Pre-install gate when something blocks symlink creation: Cancel / Resolve per-agent (bounces to InstallCollisionModal) / Force. A gate, not a resolver — deliberately not on ConflictResolver                            | ModalHost                                                                                        |
| ConfirmDialog.tsx                       | 88   | Generic confirm dialog (title, body, button labels, tone)                                                                                                                                                                | ManageLabelsModal, ModalHost                                                                     |
| manifest/DiskTransport.tsx              | 72   | OS-dialog manifest export/import transport                                                                                                                                                                               | ManifestModal                                                                                    |
| Tabs.tsx                                | 67   | Tab nav (Browse / Installed / Discover) with counts + arrow-key navigation                                                                                                                                               | App                                                                                              |
| KeyboardShortcutsOverlay.tsx            | 61   | Static keyboard-shortcuts reference table                                                                                                                                                                                | ModalHost                                                                                        |
| skillState.ts                           | 8    | Vite-safety re-export of `classifyDrawerState` from `@skills-bank/core/skill-state` (renderer must not deep-import core)                                                                                                 | DrawerHost, InstalledTab, SkillDetailDrawer                                                      |

## Renderer root

| File                     | LOC  | Purpose                                                                                                                                                                     |
| ------------------------ | ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App.tsx                  | 1061 | Root composition: provider nest (ModalRegistry → RegistryHost → Settings → Registry → Labels), tab state, suggested-action dispatch, review-session state, ModalHost wiring |
| RegistryHostContext.tsx  | 213  | Toast + AppError state and rendering; flash/flashError/pushAppError callbacks                                                                                               |
| RegistryContext.tsx      | 208  | Registry/installed snapshots + refresh/rebuild lifecycle (the only mutation entry points)                                                                                   |
| SettingsContext.tsx      | 158  | AppSettings object + theme/density scalars, persisted to localStorage, dataset writes                                                                                       |
| ModalRegistryContext.tsx | 77   | Mounted-`<Modal>` counter; `useAnyModalOpen` replaces hand-curated OR-chains                                                                                                |
| LabelsContext.tsx        | 44   | Shared labels map + single `reload()` all label surfaces subscribe to                                                                                                       |
| agentDisplay.ts          | 18   | `AGENT_LABELS` / `AGENT_PATHS` display constants                                                                                                                            |
| main.tsx                 | 12   | Entry point                                                                                                                                                                 |
| index.html               | —    | Vite shell                                                                                                                                                                  |
| styles.css               | 5070 | Single global stylesheet                                                                                                                                                    |
| theme.css                | 147  | Theme variables                                                                                                                                                             |

### styles.css orphan checker

After removing components, re-run: extract `^\.([\w-]+)` class selectors from
`styles.css` and grep each against `renderer/**/*.ts*`. Treat
template-literal-composed names as live — currently
`modal-body--w${width}` (modalStyles) and
`bulk-install-progress-row--${status}` (BulkInstallModal). A selector whose
every compound requires a dead class can never match and is safe to delete.

## hooks/ (13 files)

| File                         | LOC | Purpose                                                                                 |
| ---------------------------- | --- | --------------------------------------------------------------------------------------- |
| useRescanController.ts       | 177 | Header rescan button state machine end-to-end                                           |
| useIpcQuery.ts               | 110 | Cancellation-aware `useEffect → IPC → setState` boilerplate                             |
| useBrowseFilters.ts          | 93  | BrowseTab filter state + localStorage persistence (sort intentionally session-only)     |
| useFocusTrap.ts              | 85  | Tab-focus trap for modals/drawer                                                        |
| useManifestImportProgress.ts | 84  | Per-skill progress feed for in-flight manifest imports (Header chip + BrowseTab ghosts) |
| useAutoDismiss.ts            | 84  | Self-dismiss timer for transient surfaces (reduced-motion aware)                        |
| useSyncFeed.ts               | 68  | Sync status feed + boot hydration; auto-opens the sync resolver on conflicts            |
| useUpdateFeed.ts             | 65  | Auto-update status feed + per-version dismissal gate                                    |
| useFocusReturn.ts            | 51  | Restore focus to the opener on modal close                                              |
| useEscapeToClose.ts          | 48  | Stacked Escape handling: only top-of-stack closes per keypress                          |
| useDisclosure.ts             | 36  | Boolean expand/collapse state with stable toggle                                        |
| useModalRouter.ts            | 26  | Single-slot modal union state (open replaces, never stacks)                             |
| useReducedMotion.ts          | 26  | `prefers-reduced-motion` media-query tracker                                            |

Every hook has ≥1 real consumer and a distinct job.

## Sizing philosophy + standing observations

Components scale to their **current** job: pure glue gets folded into its
only consumer now (and re-extracted later if it grows a real job), and
abstractions are built when the need exists — never "kept in case" or
"folded if it never grows". Applied to date: DrawerHost (pure glue,
single consumer) folded into ModalHost at `e1fbdf6`.

Standing observations — each states the condition that triggers action,
where the condition is a present-tense fact check, not a hypothetical:

- **App.tsx** (1061L): largest renderer file; prior extractions (contexts,
  hooks) all came from here. Extract the suggested-action dispatch table or
  review-session state when either next changes for a feature — not before.
- **ModalHost** (1164L incl. internal DrawerHost): resolver routing is thin
  pass-throughs; the inline resolve-all / overwrite / bulk-repair handlers
  become components when one of them next grows multi-step state.
- **ConfirmDialog body-slot**: rebase `DeleteUnregisteredDialog` /
  `DestinationPickerDialog` on `ConfirmDialog` when a third specialized
  confirm appears — two instances is not yet a pattern.
