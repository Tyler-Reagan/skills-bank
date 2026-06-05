# Renderer inventory (internal working doc)

Temporary, internal-only inventory of everything under `src/renderer/` — the
working map for the renderer pruning effort. **Not published to the docs site**
(`packages/docs/` is the published surface; this file is repo-internal).
Delete this file when the cleanup series lands.

Status legend: **keep** (cohesive, justified) · **watch** (acceptable now,
revisit if it grows) · **converge** (planned merge into a shared component) ·
**done** (handled by the cheap-wins PR).

LOC figures are from the cheap-wins branch (post-consolidation); re-run
`wc -l` before trusting them in a later PR.

## Cleanup series

1. **Cheap wins** (this PR): `primitives.tsx` merge, `TagFilter` →
   `RegistryFilters`, `DiscoverEmpty` → `DiscoverTab`, `ImportIndicator` →
   `Header`, `manifest/` subfolder, renames (`SyncConflictModal`,
   `InstallCollisionModal`, `DeleteUnregisteredDialog`, `StateBadge`), dead
   `isRegistered` prop chain pruned from `SkillCard`. 52 component files → 45
   (41 flat + 4 under `manifest/`).
2. **Resolver convergence** (next): one generic `ConflictResolver`
   parameterized by domain, absorbing `SyncConflictModal`,
   `InstallCollisionModal`, `ManifestConflictModal` + the `BulkSelectToolbar`
   / `ConflictActionPicker` helpers (~739 + 165 lines → ~350).
   `InstallConflictModal` stays — it's a gate that bounces _to_ a resolver,
   not one itself.
3. **Renderer root + hooks** (this doc's second half): candidates listed
   below; scope TBD.

## components/

| File                                    | LOC  | Purpose                                                                                                                  | Used by                      | Verdict                                                             |
| --------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------------------------------------------------------------- |
| ManageLabelsModal.tsx                   | 1217 | Registry-wide label management + auto-generate flow                                                                      | ModalHost                    | keep (recent feature, cohesive)                                     |
| ModalHost.tsx                           | 922  | Modal router: 16-kind `ActiveModal` union + inline handlers (resolve-all, overwrite, bulk-repair)                        | App                          | keep; slims when resolvers converge                                 |
| InstalledTab.tsx                        | 708  | Installed view; needs-attention / unregistered / registered sections; `CustomSkillsDirs`, `LocalScanResultsSection` subs | App, ModalHost               | keep                                                                |
| BrowseTab.tsx                           | 606  | Registry view; category sections, `GhostBand` import ghosts, filter/sort pipeline                                        | App                          | keep                                                                |
| DrawerActions.tsx                       | 587  | Capability-gated action panel + repair confirm sub-dialog                                                                | SkillDetailDrawer            | keep (cohesive post-v1.20 cull)                                     |
| SkillDetailDrawer.tsx                   | 559  | Skill detail panel; composes the three Drawer\*Section/Actions subs                                                      | DrawerHost, ModalHost        | keep                                                                |
| RegisterModal.tsx                       | 499  | Scan → plan → apply registration (Register All)                                                                          | ModalHost                    | keep                                                                |
| RegistryFilters.tsx                     | ~570 | Filter chips + sort + dropdowns; `TagFilter` folded in as internal sub-component                                         | BrowseTab                    | done (absorbed TagFilter)                                           |
| SettingsModal.tsx                       | 485  | App preferences                                                                                                          | App, ModalHost               | keep                                                                |
| Header.tsx                              | ~470 | App chrome: sync/scan buttons, theme/density, account chip; `ImportIndicator` folded in                                  | App, SettingsContext         | done (absorbed ImportIndicator)                                     |
| SkillCard.tsx                           | ~420 | Card + `StateBadge` + `StatusChip` + quick tags                                                                          | InstalledTab, SkillsGrid     | done (StateBadge rename, dead prop pruned)                          |
| BulkInstallModal.tsx                    | 404  | Bulk install select → run → done                                                                                         | ModalHost                    | keep                                                                |
| manifest/RepoTransport.tsx              | 384  | Manifest push / pull-merge pane (`ExportView`/`ImportView`, `DiffTable`)                                                 | ManifestModal                | done (moved)                                                        |
| DiscoverTab.tsx                         | ~350 | skills.sh embed + install callout; `DiscoverEmpty` folded in                                                             | App                          | done (absorbed DiscoverEmpty)                                       |
| InstallCollisionModal.tsx               | 305  | Agent-dir collision resolver (per-agent rows; was `ConflictResolveModal`)                                                | ModalHost                    | converge → ConflictResolver                                         |
| DrawerOriginSection.tsx                 | 287  | Origin metadata + manual-link picker                                                                                     | SkillDetailDrawer            | keep                                                                |
| ConnectGithubModal.tsx                  | 282  | GitHub device-flow auth                                                                                                  | ModalHost                    | keep                                                                |
| AccountModal.tsx                        | 271  | Identity + registry source + move-my-registry                                                                            | ModalHost                    | keep                                                                |
| SyncBanner.tsx                          | 265  | Sync status banner + expandable detail lists                                                                             | App                          | keep                                                                |
| DrawerHost.tsx                          | 256  | Drawer wiring glue: context pulls + capability callbacks                                                                 | ModalHost                    | watch (pure glue; fold into ModalHost if it stops earning its keep) |
| Icon.tsx                                | 244  | Icon registry (35+ inline Lucide SVGs)                                                                                   | ~29 files                    | keep                                                                |
| SyncConflictModal.tsx                   | 233  | Sync-collision resolver (per-skill rows + diff; was `ConflictResolutionModal`)                                           | ModalHost                    | converge → ConflictResolver                                         |
| DestinationPickerDialog.tsx             | 202  | Agent-dir picker for unregister destination                                                                              | ModalHost                    | keep (optional: ConfirmDialog body-slot rebase)                     |
| ManifestConflictModal.tsx               | 201  | Manifest 3-way merge resolver                                                                                            | ModalHost                    | converge → ConflictResolver                                         |
| ManageLinksModal.tsx                    | 173  | Per-agent symlink plan → apply                                                                                           | ModalHost                    | keep                                                                |
| UpdatesModal.tsx                        | 162  | Skill-origin updates list (distinct from app-release UpdateNotesModal)                                                   | ModalHost                    | keep                                                                |
| DrawerLabelSection.tsx                  | 160  | Category/tags override UI                                                                                                | SkillDetailDrawer            | keep                                                                |
| primitives.tsx                          | ~160 | Stateless micro-primitives: `SearchBar`, `InfoTooltip`, `DisclosureChevron`, `SkillTagList`, `SplashScreen`              | 7 files                      | done (new; absorbs 5 files)                                         |
| UpdateNotesModal.tsx                    | 153  | App release notes + download/restart flow                                                                                | ModalHost                    | keep                                                                |
| RepoPickerModal.tsx                     | 147  | Linked-repo picker                                                                                                       | ModalHost                    | keep                                                                |
| DiffViewer.tsx                          | 140  | Generic unified-diff renderer                                                                                            | SyncConflictModal            | keep (generic, reusable)                                            |
| ErrorPanel.tsx                          | 133  | Persistent error surface + suggested actions                                                                             | App                          | keep (distinct from SyncBanner)                                     |
| DeleteUnregisteredDialog.tsx            | 132  | Structured delete confirm (was `DeleteUnregisteredConfirm`)                                                              | ModalHost                    | done (renamed)                                                      |
| modalStyles.tsx                         | 118  | Modal chrome: scrim, focus trap, close button, layout constants                                                          | 19 files                     | keep (the pattern primitives.tsx copies)                            |
| manifest/ManifestModal.tsx              | 111  | Transport-mode wrapper (repo vs disk)                                                                                    | ModalHost                    | done (moved)                                                        |
| manifest/ManifestImportConfirmModal.tsx | 111  | Post-import re-link confirm                                                                                              | ModalHost                    | done (moved)                                                        |
| SkillsGrid.tsx                          | 108  | Dumb entries → cards mapper + empty state                                                                                | BrowseTab                    | keep                                                                |
| BulkSelectToolbar.tsx                   | 98   | "Select all:" strip for resolver modals                                                                                  | 3 resolvers                  | converge → ConflictResolver internal                                |
| InstallConflictModal.tsx                | 96   | Pre-install gate (Cancel / Resolve per-agent / Force)                                                                    | ModalHost                    | keep separate (gate, not resolver)                                  |
| ConfirmDialog.tsx                       | 88   | Generic confirm dialog                                                                                                   | ManageLabelsModal, ModalHost | keep                                                                |
| manifest/DiskTransport.tsx              | 72   | OS-dialog manifest transport                                                                                             | ManifestModal                | done (moved)                                                        |
| Tabs.tsx                                | 67   | Tab nav (Browse / Installed / Discover)                                                                                  | App                          | keep (domain-specific)                                              |
| ConflictActionPicker.tsx                | 67   | Generic per-row radio list for resolvers                                                                                 | 4 files                      | converge → ConflictResolver internal                                |
| KeyboardShortcutsOverlay.tsx            | 61   | Static shortcuts table                                                                                                   | ModalHost                    | keep                                                                |
| skillState.ts                           | 8    | Vite-safety re-export of `classifyDrawerState`                                                                           | 3 files                      | keep (required shim)                                                |

Naming convention (now consistent): `*Modal` = full overlay routed through
ModalHost; `*Dialog` = small confirm-style affordance; `*Section` = drawer
sub-panel; primitives live in `primitives.tsx`.

## Renderer root

| File                     | LOC  | Purpose                                                                                                       | Verdict / notes                                                                                                                                                                  |
| ------------------------ | ---- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App.tsx                  | 1061 | Root composition: provider nest, tab state, suggested-action dispatch, review-session state, ModalHost wiring | watch — largest file in the renderer; prior extractions (contexts, hooks, DrawerHost) all came from here. Next candidates: suggested-action dispatch table, review-session state |
| RegistryHostContext.tsx  | 213  | Toast + AppError state and UI                                                                                 | keep                                                                                                                                                                             |
| RegistryContext.tsx      | 208  | Registry/installed snapshots + refresh/rebuild lifecycle                                                      | keep                                                                                                                                                                             |
| SettingsContext.tsx      | 158  | AppSettings + theme/density persistence                                                                       | keep                                                                                                                                                                             |
| ModalRegistryContext.tsx | 77   | Mounted-`<Modal>` counter (`useAnyModalOpen`)                                                                 | keep                                                                                                                                                                             |
| LabelsContext.tsx        | 44   | Shared labels map + reload                                                                                    | keep                                                                                                                                                                             |
| agentDisplay.ts          | 18   | `AGENT_LABELS` / `AGENT_PATHS` display constants                                                              | keep (or fold into a future constants module)                                                                                                                                    |
| main.tsx                 | 12   | Entry point                                                                                                   | keep                                                                                                                                                                             |
| index.html               | —    | Vite shell                                                                                                    | keep                                                                                                                                                                             |
| styles.css               | 5616 | Single global stylesheet                                                                                      | watch — orphaned-selector sweep would need tooling; out of scope for the component cleanup                                                                                       |
| theme.css                | —    | Theme variables                                                                                               | keep                                                                                                                                                                             |

## hooks/

| File                         | LOC | Purpose                                   | Verdict / notes                                                                |
| ---------------------------- | --- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| useRescanController.ts       | 177 | Header rescan button state machine        | keep                                                                           |
| useIpcQuery.ts               | 110 | Cancellation-aware IPC query boilerplate  | keep                                                                           |
| useBrowseFilters.ts          | 93  | BrowseTab filter state + persistence      | keep                                                                           |
| useFocusTrap.ts              | 85  | Tab-focus trap for modals/drawer          | keep                                                                           |
| useManifestImportProgress.ts | 84  | Per-skill import progress feed            | keep                                                                           |
| useAutoDismiss.ts            | 84  | Self-dismiss timer for transient surfaces | keep                                                                           |
| useSyncFeed.ts               | 68  | Sync status feed + boot hydration         | keep                                                                           |
| useUpdateFeed.ts             | 65  | Auto-update status feed + dismissal gate  | keep                                                                           |
| useFocusReturn.ts            | 51  | Restore focus on modal close              | keep                                                                           |
| useEscapeToClose.ts          | 48  | Stacked Escape-to-close handling          | keep                                                                           |
| useDisclosure.ts             | 36  | Boolean expand/collapse state             | keep — tiny but a hook, not a component; primitives.tsx is for rendered chrome |
| useModalRouter.ts            | 26  | Single-slot modal union state             | keep                                                                           |
| useReducedMotion.ts          | 26  | `prefers-reduced-motion` tracker          | keep                                                                           |

The hooks directory is in good shape — every hook has ≥1 real consumer and a
distinct job. No consolidation proposed.

## Known follow-ups beyond the resolver convergence

- **DrawerHost** (256L of glue): fold into ModalHost or App if it doesn't
  grow a real job by the next cleanup pass.
- **App.tsx** (1061L): extract the suggested-action dispatch table and
  review-session state if it crosses ~1200L.
- **styles.css**: orphaned-selector audit (e.g. selectors for removed
  components like the old publish section) — needs a CSS-coverage tool or a
  careful grep pass; deliberately out of scope here.
- **ConfirmDialog body-slot**: optionally rebase `DeleteUnregisteredDialog` /
  `DestinationPickerDialog` on `ConfirmDialog` with a rich `body` ReactNode.
