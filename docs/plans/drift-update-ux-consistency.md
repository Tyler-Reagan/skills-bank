# Drift/Update UX consistency (planned, v0.11.3)

The v0.11.2 paradigm reframe got the data model right (Origin = authoritative upstream) and most user-facing surfaces matched (manual picker rewritten, Update flow rebuilt). What didn't get a consistency pass is the **heal-action surfaces** — the drawer buttons that appear when a skill is in `user-edited-with-upstream`, `upstream-update-available`, or the legacy `bundled-skill-edited` states. These still use pre-reframe vocabulary (`Keep my edits`, `Revert to upstream`, `Accept local changes`, `Take canonical`) inconsistently with the glossary's canonical terms (`Unlink origin`, `Reset to origin`, `Update`).

There's also a discoverability gap: when the probe surfaces N skills with available updates, the only persistent surface is the per-card chip and a header badge that opens UpdatesModal. The Registry tab itself has no native way to filter, highlight, or list pending-update skills. The Rescan button's "N updates found" done-state copy (v0.11.2) fades in 1.5s — informative but ephemeral.

This plan brings the heal surfaces under the canonical glossary, harmonizes their styling, and gives the Registry tab a durable surface for the "skills with updates" subset.

## Depends on

`origin-paradigm-reframe` (v0.11.2, merged). Glossary terms (`Update`, `Reset to origin`, `Unlink origin`, `Mark as local`) are established and what this plan migrates onto. Optional: `skills-directory-split` (v0.11.3) ordered ahead so any new copy referencing folder location is bucket-aware from the start.

## Goals

1. Every user-facing button that operates on Origin uses canonical vocabulary from `UBIQUITOUS_LANGUAGE.md`. No more "Keep my edits" / "Revert to upstream" / "Accept local changes" / "Take canonical."
2. Sibling buttons in the same row share styling weight. No more `btn warn` + `btn` + `btn` rows where the danger styling is inconsistent with semantics, and no more variable button widths.
3. The Registry (Browse) tab grows a native surface for "skills with pending upstream updates" — at minimum a filter chip; ideally also subtle highlight + ordering so updates are visible at a glance.
4. Rescan's "N updates found" done-state becomes actionable — single click reveals what + where, not just a count that fades.
5. Badge copy harmonizes: the SkillCard badge palette is consistent across UPDATE / DRIFT / MISSING / provenance states.

## Non-goals

- No changes to capability classifier logic (`packages/core/src/skill-state.ts`). The renderer maps existing capabilities to new copy; internal capability names (`canTakeUpstream`, `canAcceptDrift`, `canUpdate`) keep their identifiers.
- No new actions added. Every action the drawer can offer today still exists; only language and presentation change.
- No mobile / touch-target adaptations (Electron desktop only).
- No restructuring of the heal-action layout in the drawer (vertical stack of action sections stays).

## Scope

### 1. Canonical button copy

Mapping from current copy to canonical:

| Current copy             | Canonical                  | When it appears                                          |
| ------------------------ | -------------------------- | -------------------------------------------------------- |
| Keep my edits            | **Unlink origin**          | `user-edited-with-upstream` — drift + upstream pointer   |
| Accept local changes     | **Accept drift**           | `bundled-skill-edited` — drift on bundled-sync skill (no upstream pointer) |
| Take canonical           | **Re-baseline**            | `bundled-skill-edited` — re-write the synced-hash to current content |
| Revert to upstream       | **Reset to origin**        | `user-edited-with-upstream` — wipe local, refetch upstream |
| Update                   | **Update**                 | `upstream-update-available` — local clean, upstream moved |
| Forget                   | **Forget this skill**      | `missing` — entry references a folder that's gone        |

Hint paragraphs underneath each action stack update to match. Example for `user-edited-with-upstream`:

> *Your local copy differs from `<repo>`.*
> *Unlink origin* keeps your edits and clears the upstream pointer.
> *Reset to origin* discards your edits and refetches from upstream.

### 2. Consistent button styling

All sibling heal-action buttons in the same row use the same `.btn` class with **at most one** carrying `.btn.primary` (the "happy path" action). No `.btn.warn` proliferation. Per the existing Quick-Reference rule (one primary CTA per surface), the primary in each row is:

| State                          | Primary action      | Secondary actions                 |
| ------------------------------ | ------------------- | --------------------------------- |
| `upstream-update-available`    | **Update**          | (none — single action surface)    |
| `user-edited-with-upstream`    | **Reset to origin** | **Unlink origin**                 |
| `bundled-skill-edited`         | **Re-baseline**     | **Accept drift**                  |
| `missing`                      | **Forget this skill** | (none)                         |

Destructive emphasis (`.btn.danger`) is reserved for actions with irreversible local-content loss: Reset to origin (destroys local drift). The destructive styling already exists in `styles.css:1196` but isn't used in these surfaces.

Button row layout: `display: flex, gap: var(--s3)`. Single row when ≤2 buttons; wraps at the breakpoint defined elsewhere. Hint paragraph below the row using `.drawer-action-hint`.

### 3. Badge harmonization

`SkillCard` badges:

| Badge                    | Current             | New                                              |
| ------------------------ | ------------------- | ------------------------------------------------ |
| Update available         | `UPDATE` lowercase | `UPDATE` — keep as canonical                     |
| Drift (with upstream)    | `DRIFT` all-caps   | `EDITED` — softer, matches the action verb "Unlink" |
| Drift (bundled, no upstream) | `DRIFT` all-caps | `EDITED` — same                                  |
| Missing                  | `MISSING`           | `MISSING` — keep                                  |
| Bundled                  | `BUNDLED`           | `BUNDLED` — keep                                  |
| Yours                    | `YOURS`             | `YOURS` — keep                                   |

`DRIFT` reads as a technical term; `EDITED` reads as the user's mental model ("I edited this"). The title-attribute hover text on the badge already explains the implication; the badge itself can be calmer.

Color tokens stay the same (warn-tinted for EDITED, accent for UPDATE, danger for MISSING).

### 4. Registry tab — pending-update surfacing

Three new surfaces on the Browse tab toolbar:

**(a) Filter chip strip** above the grid:

```
[ All ] [ Updates (N) ] [ Edited (M) ] [ Bundled ] [ Yours ] [ Missing (K) ]
```

Each chip is a togglable filter. "All" is mutually exclusive with the others; the rest can stack (you can show Updates AND Edited at once). Counts update live from `registry` state. Default selection: `All`.

The chip styling follows existing tab-control / tag patterns. Active state uses accent-dim background. Counts are right-aligned within the chip in `var(--text-3)`.

**(b) Visual highlight on pending-update cards** (always-on, independent of filter):

A 2px accent-color left border on cards where `entry.upstreamUpdateAvailable === true`. Subtle enough not to dominate; visible enough that the eye lands on update-able skills first when scanning. (Note: per the "absolute bans" in the impeccable design laws, decorative side-stripe borders >1px are out — but here the stripe is **semantic** and **2px** maximum. Tested via the design call.)

Alternative if side-stripe still feels wrong: a small chevron-up icon in the card's top-right corner instead. Decide during craft / quick visual probe.

**(c) Sort precedence** within the grid:

By default (filter = All), pending-update cards float to the top, sub-sorted by name. Within each filter view, alphabetical. Toggleable later if users want a "name-only sort" affordance; not in v1.

### 5. Rescan done-state → actionable

When the Rescan button advances to `done` with `updates > 0`, the button copy gains an action affordance:

```
✓ 2 updates found · View
```

The "View" tail is clickable (within the same button or as a chained action button next to it). Clicking it:
- Opens the existing UpdatesModal *or*
- Sets the BrowseTab filter to `Updates` *or*
- Both

Decision in craft: probably "set filter + scroll to top" since the modal is heavyweight and the new Registry-tab filter is a more natural inline path. The header Updates badge (existing) keeps the modal as its destination — two doors to the same content via different mental models.

Done-state copy with updates: replace "1.5s then fade" with "stays visible until the user clicks View or clicks Rescan again." When the user has acted on at least one update, the count decrements live; when it hits zero, the button reverts to idle. Done-state with `updates === 0` keeps its 1.5s fade — there's nothing to act on.

### 6. UpdatesModal alignment

The existing UpdatesModal becomes the second discoverability path. No structural change, but:
- Per-row Update button uses the new canonical "Update" copy (probably already does).
- The aggregate "Update all" button uses the new canonical phrasing.
- Each row's hint matches the drawer's hint language.

## Schema / IPC audit

No schema changes. `RegistryEntry.upstreamUpdateAvailable` drives the filter count + highlight. `entry.drift` drives the EDITED badge. Already-shipped fields.

## Execution order

Two PRs in sequence, both under the v0.11.3 label:

**PR-1 — Drawer + button consistency.**
Scope: button copy migration in `SkillDetailDrawer.tsx`, badge copy in `SkillCard.tsx`, button styling harmonization in `styles.css` (or button class changes inline), hint paragraph rewrites. UpdatesModal copy alignment. No new components.

Footprint: ~150 lines across 3-4 files. One commit per concern (copy, styling, badges, hints).

**PR-2 — Registry filter + Rescan done-state.**
Scope: new filter-chip strip component, `BrowseTab` filter state, sort precedence, side-stripe (or chevron) highlight on update cards, Rescan done-state actionable copy + state extension, deep-link from done-state to filter.

Footprint: ~200-300 lines, mostly in `BrowseTab.tsx` + a new `RegistryFilterChips.tsx` + small extensions to `Header.tsx` and `App.tsx`.

## Verification

### PR-1

- Every drawer heal-action button label matches `UBIQUITOUS_LANGUAGE.md`'s canonical action verbs.
- Spot-test: create artificial drift on a skill with upstream pointer → drawer shows `[ Reset to origin ]` (primary, danger styling) and `[ Unlink origin ]` (secondary). No "Keep my edits" / "Revert to upstream" copy remains.
- Spot-test: hit a card with `upstreamUpdateAvailable: true` → badge says UPDATE (unchanged), drawer's primary action says `Update`, hint matches the glossary.
- Badge sweep: every `EDITED` instance reads correctly; no `DRIFT` text left.
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm build` clean.

### PR-2

- Browse tab toolbar shows filter chips with live counts.
- Click `Updates (N)` chip → grid filters to only those skills.
- Card with `upstreamUpdateAvailable: true` shows the highlight (chevron or stripe per craft decision).
- Default sort floats updates to the top (`Updates` filter chip not required).
- Rescan done-state with `updates > 0` shows `✓ N updates found · View`, persists until clicked or until Rescan re-fires.
- Click View on done-state → filter chip activates, grid scrolls to top.
- Updates badge in header still opens UpdatesModal (alternate path).
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm build` clean.

## Open / deferred questions

- **Maintainer-only affordances.** Should the Browse tab visually distinguish `personal` vs `vendored` bucket cards on the maintainer's machine? Out of scope here; tracked in `skills-directory-split.md`.
- **"Update all" UX.** UpdatesModal already has it. Whether to surface in the Registry filter view too? Probably not — the modal is the bulk-action destination; the inline filter view is for selecting which to apply individually.
- **Side-stripe vs chevron** — decide during craft via a visual probe. The impeccable design laws ban decorative side-stripes >1px; this one is semantic + 2px, which is the borderline. Be willing to switch to a chevron if it doesn't read right.
- **Filter persistence across sessions.** Should the user's last-active filter survive an app restart? Probably default to `All` on launch — they may have resolved everything since last session. Persist only if user feedback says otherwise.
- **Bulk-select for "Update all from filter view."** Currently UpdatesModal handles bulk Update. Replicating in the filter view is duplicative; defer until a user actually asks.

## Conflict audit

- **`skills-directory-split` (v0.11.3 sibling)** — if it lands first (recommended), `RegistryEntry.bucket` is available and the filter strip can grow a sixth chip `Personal (N) / Vendored (M)` cleanly. If it lands second, this plan ships the existing five filters and bucket filtering is added in v0.11.4.
- **`bank-mode-persistence` (plan 04)** — snapshot-restore flow may want to show a "X skills with available updates" panel during restore. The Updates filter chip is reusable.
- **`in-app-install-from-discover` (plan 05)** — newly-installed skills land with a marker but no probe has run on them yet. The Updates filter shouldn't show them as having updates until the probe fires. Already correct per the existing `probedUpdates` Map; document but don't change.
