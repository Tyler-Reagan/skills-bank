# Plan: ManageLabelsModal

## Context

Labels (category + tags) are now fully user-driven with no auto-derivation. The only interactive
entry points were a per-skill "Auto Categorize" button in DrawerLabelSection and inline chip
editing — neither supports bulk management or discoverability of the labeling state across the
whole registry. This plan introduces a registry-wide "Manage Labels" modal accessible from the
BrowseTab toolbar, with a multi-step "Auto-Generate Labels" flow embedded inside it.

Locked design decisions:
- Entry point: BrowseTab toolbar button (not the drawer)
- Auto-generate flow replaces modal content in-place (slide/phase transition, ← Back breadcrumb)
- No-change rows in review: collapsed by default
- Action language: "Discard changes" (proposal only) / "Apply changes"
- Tags filter: searchable multi-select dropdown with selected items floated to top
- Modal stays mounted when "Open skill" opens the drawer (z-index elevation)
- Browse phase is read/select-only; "Open skill" icon button bridges to per-skill drawer editing

---

## New Files

### `packages/desktop/src/renderer/components/ManageLabelsModal.tsx`

Single file owning the entire feature. Phase-based, following the `RegisterModal`/`ManageLinksModal`
pattern.

**Phase union:**
```typescript
type LabelScope = "both" | "categories" | "tags";

type Proposal = {
  name: string;
  currentCategory: string | null;
  currentTags: string[];
  proposedCategory: string | null;
  proposedTags: string[];
  hasChange: boolean;
};

type Phase =
  | { kind: "browse" }
  | { kind: "gen-scope" }
  | { kind: "gen-skills"; scope: LabelScope }
  | { kind: "gen-review"; scope: LabelScope; skillNames: string[]; proposals: Proposal[]; checkedNames: Set<string> }
  | { kind: "applying" };
```

**Props:**
```typescript
interface Props {
  onClose: () => void;
  onLabelsChanged: () => void;
  onOpenSkill: (entry: RegistryEntry) => void;
}
```

Uses `useRegistry()` internally to get the full skill list. Reads `labelsMap` via
`window.skillsBank.readLabels()` on mount and after any write.

---

### Browse phase

**State:**
- `search: string` — text filter across skill name
- `categoryFilter: string | null` — null = All; matches `categoryRules[*].category` + `"__none__"`
- `tagFilter: string[]` — empty = All; AND semantics across selected tags
- `sort: "name-asc" | "name-desc" | "category" | "uncategorized-first"`
- `selectedNames: Set<string>` — checked rows
- `labelsMap: LabelsMap`

**Layout:**
```
[SearchBar]  Category [All ▾]  Tags [All ▾]  Sort [Name A→Z ▾]
──────────────────────────────────────────────────────────────
☐ Select all   [ Actions ▾ ]   N skills
──────────────────────────────────────────────────────────────
[SkillLabelRow × N]
──────────────────────────────────────────────────────────────
[ ✦ Auto-Generate Labels... ]                    [ Done ]
```

**SkillLabelRow:** checkbox · skill name · category badge (or `—`) · tags as `.label-chip` chips
(max 3 shown, `+N more` overflow) · `[↗]` open-skill icon button (hover-visible only).
`[↗]` calls `onOpenSkill(entry)`.

**Actions dropdown** (`.actions-dropdown`): always rendered, disabled when `selectedNames.size === 0`.
Currently one action: "Clear labels" → opens a `ConfirmDialog` before executing.

**Confirmation gate for "Clear labels":**
Add `confirmClear: boolean` state. When the user triggers "Clear labels" from the dropdown, set
`confirmClear = true` (do not execute immediately). Render:
```tsx
<ConfirmDialog
  open={confirmClear}
  title="Clear labels"
  body={`Remove labels from ${selectedNames.size} skill${selectedNames.size === 1 ? "" : "s"}? This cannot be undone.`}
  confirmLabel="Clear labels"
  tone="danger"
  onCancel={() => setConfirmClear(false)}
  onConfirm={async () => {
    // call resetLabel for each selected name, re-read labels, call onLabelsChanged
    setConfirmClear(false);
  }}
/>
```
`ConfirmDialog` renders its own `Modal` (`position: fixed; z-index: 1100`) which stacks above the
manage-labels modal via DOM order. This is the established pattern in the codebase — no z-index
changes needed.

**Tags multi-select dropdown** (adapt `TagFilter` CSS pattern):
- Trigger button shows `Tags [All ▾]` / `Tags [react +1 ▾]` (first selected + overflow count)
- Dropdown panel includes a search input (`<input type="text">`) at top for filtering the tag list
- Selected items float to top of list, separated by a divider from unselected
- Click to toggle; click selected item (or its `[×]`) to deselect
- Stays open between selections; closes on outside click

**Category dropdown:** `<select>` with "All", "Uncategorized", then `categoryRules` entries via
`categoryDisplayName`. Straightforward — no custom dropdown needed.

---

### Auto-Generate flow (phases gen-scope → gen-skills → gen-review)

Navigation: clicking "✦ Auto-Generate Labels..." sets phase to `{ kind: "gen-scope" }`. Header
gains `← Back to Manage Labels` link (sets phase back to `{ kind: "browse" }`).

**Step indicator** (inline, no separate component):
```
Step 1 of 3  ●──○──○
Step 2 of 3  ●──●──○
Step 3 of 3  ●──●──●
```
CSS: flex row, dots are `::before`/`::after` circles, connecting lines are thin horizontal rules.
Class: `.gen-step-indicator`.

#### Step 1 — Scope (`gen-scope`)
Three radio options using the `ConflictActionPicker` CSS class pattern
(`.conflict-action-label`, `.conflict-action-radio`, etc. — reuse exactly):
- "Both categories and tags"
- "Categories only"
- "Tags only"

Footer: `[ ← Back ]` · `[ Next → ]`

#### Step 2 — Skills (`gen-skills`)
Two radio options (same pattern):
- "All skills (N skills)"
- "Select skills"

When "Select skills" is chosen, a searchable checklist expands inline (no separate step):
- `SearchBar` for filtering
- Scrollable list of all registry skills, alpha-sorted, with checkboxes
- Each row: checkbox · name · current category badge · tag count
- "N selected" count below list

Footer: `[ ← Back ]` · `[ Confirm → ]`
(Confirm is disabled when "Select skills" is chosen and 0 skills are checked.)

#### Step 3 — Review (`gen-review`)

Computed when entering this phase: run `deriveLabels({ name, description })` for each target
skill, then build `Proposal[]` comparing against current `labelsMap`. Respect scope — if
`scope === "categories"`, copy current tags to proposed (no tag change); if `scope === "tags"`,
copy current category.

Render:
- Header stat line: `N skills · M changes · K unchanged`
- Changed rows (checked by default, unchecked to exclude from apply):
  ```
  ☑ react-components
      Category  —  →  frontend
      Tags      —  →  [react] [typescript]
  ```
- "No change" rows: single collapsed disclosure (`── N skills with no changes ── [show ▾]`)
- "Select all / deselect all" toggle link above list

Footer:
```
[ ↺ Run again ]          [ Discard changes ]   [ Apply changes ]
                                                ↑ disabled when 0 checked
                                                ↑ shows "Apply 2 of 4" when partial
```

- **Run again** → sets phase back to `{ kind: "gen-scope" }` with prior scope pre-selected
- **Discard changes** → sets phase back to `{ kind: "browse" }`, no writes
- **Apply changes** → sets phase to `{ kind: "applying" }`, writes checked proposals via
  `window.skillsBank.bulkUpdateLabels(updates)`, then sets phase back to `{ kind: "browse" }`,
  calls `onLabelsChanged()`

`{ kind: "applying" }` phase renders `<Modal onClose={undefined}>` (undismissable spinner),
matching the pattern used by `RegisterModal` and `ManageLinksModal`.

---

## Modified Files

### `packages/desktop/src/shared/ipc.ts`

Add to the `IPC` const:
```typescript
bulkUpdateLabels: "labels:bulkUpdate",
```

Add to the `SkillsBankAPI` interface:
```typescript
bulkUpdateLabels(updates: LabelsMap): Promise<void>;
```

### `packages/desktop/src/main/main.ts`

Add handler after the existing labels block (line ~4160):
```typescript
ipcMain.handle(
  IPC.bulkUpdateLabels,
  (_e, updates: import("@skills-bank/core").LabelsMap): void => {
    const data = readLabelsFile();
    for (const [name, override] of Object.entries(updates)) {
      data[name] = { ...(data[name] ?? {}), ...override };
    }
    writeLabelsFile(data);
  },
);
```

### `packages/desktop/src/main/preload.mts`

Add alongside the existing label channel exposures:
```typescript
bulkUpdateLabels: (updates: LabelsMap) =>
  ipcRenderer.invoke(IPC.bulkUpdateLabels, updates),
```

### `packages/desktop/src/renderer/components/ModalHost.tsx`

1. Add to `ActiveModal` union:
```typescript
| { kind: "manageLabels" }
```

2. Add import for `ManageLabelsModal`.

3. Add render case in `ModalHost` body:
```typescript
{modal?.kind === "manageLabels" && (
  <ManageLabelsModal
    onClose={closeModal}
    onLabelsChanged={onLabelsChanged ?? (() => {})}
    onOpenSkill={setSelected}
  />
)}
```

4. Add `elevated` prop to `DrawerHost` call:
```typescript
elevated={modal?.kind === "manageLabels"}
```

### `packages/desktop/src/renderer/components/BrowseTab.tsx`

1. Add to `Props`:
```typescript
onManageLabels?: () => void;
```

2. Add button in the toolbar row (right side, before expand/collapse):
```typescript
{onManageLabels && (
  <button
    type="button"
    className="btn"
    onClick={onManageLabels}
  >
    Manage Labels
  </button>
)}
```

### `packages/desktop/src/renderer/App.tsx`

Wire `onManageLabels` on the BrowseTab render:
```typescript
onManageLabels={() => openModal({ kind: "manageLabels" })}
```

### `packages/desktop/src/renderer/components/DrawerHost.tsx`

1. Add to `Props`:
```typescript
elevated?: boolean;
```

2. Apply class on the overlay element (check whether it lives in `DrawerHost` or `SkillDetailDrawer`):
```typescript
<div className={`drawer-overlay${elevated ? " drawer-overlay--elevated" : ""}`}>
```

### `packages/desktop/src/renderer/styles.css`

Add z-index elevation rule (drawer must sit above modal-overlay at 1100):
```css
.drawer-overlay--elevated {
  z-index: 1200;
}
```

Add new component styles:
- `.manage-labels-filters` — filter row layout
- `.manage-labels-table-header` — select-all + actions + count bar
- `.manage-labels-row` — skill list row (flex, hover state, hover-reveal for `[↗]`)
- `.manage-labels-row-open` — open-skill icon button, `opacity: 0` at rest, `1` on row hover
- `.gen-step-indicator` — step dots + connecting lines
- `.gen-review-row` — diff row with checkbox and two-column diff
- `.gen-review-no-change` — collapsed disclosure for unchanged skills
- `.actions-dropdown` — actions dropdown panel (mirrors `.tag-filter-panel` pattern)

---

## Reused Without Modification

| What | From |
|------|------|
| `Modal` container + focus/escape/scrim | `modalStyles.tsx` |
| `SearchBar` | `SearchBar.tsx` |
| `Icon` component | `Icon.tsx` |
| `.conflict-action-label/radio/desc` CSS | `styles.css` (scope + skills radio steps) |
| `.tag-filter-panel/item/clear` CSS | `styles.css` (tags dropdown) |
| `.label-chip` CSS | `styles.css` (tag display in browse rows) |
| `.btn` / `.btn.primary` | `styles.css` |
| `categoryRules`, `categoryDisplayName` | `@skills-bank/core/labels` |
| `deriveLabels`, `effectiveLabels` | `@skills-bank/core/labels` |
| `useRegistry()` | `RegistryContext.tsx` |
| `readLabels`, `updateLabel`, `resetLabel` IPC | existing channels |
| `ConfirmDialog` | `ConfirmDialog.tsx` (destructive-action gate) |

---

## Destructive-Action Gates

| Action | Confirmation required | Rationale |
|--------|-----------------------|-----------|
| Browse — "Clear labels" (any selection) | ✓ `ConfirmDialog` with count + `tone="danger"` | Irreversible data deletion |
| Gen-review — "Discard changes" | ✗ | Exits proposal only; no data written |
| Gen-review — "Apply changes" | ✗ | User reviewed a full diff; review is the gate |
| Gen-review — "Run again" | ✗ | Non-destructive; restarts the flow |

---

## DrawerLabelSection

No changes. The per-skill "Auto Categorize" button remains for direct single-skill use from the
drawer. The modal is additive, not a replacement.

---

## Verification

```
pnpm typecheck     # must be clean
pnpm test          # no regressions
pnpm start         # manual smoke test
```

Manual smoke test path:
1. BrowseTab: "Manage Labels" button visible in toolbar
2. Click opens modal in browse phase — all skills listed, labels shown correctly
3. Search, category filter, tag filter, sort — all narrow/reorder the list
4. Select rows → Actions dropdown enables → "Clear labels" → ConfirmDialog → clears and refreshes
5. "Auto-Generate Labels..." → step indicator shows Step 1 → pick scope → Next
6. Step 2 → pick "All" → Confirm OR pick "Select" → select a few → Confirm
7. Step 3 → proposals shown, changed vs unchanged separated → partial uncheck → "Apply 2 of 4"
8. Apply: applying spinner → browse phase returns → BrowseTab category grouping updates
9. "Discard changes" → returns to browse, no writes
10. "Run again" → returns to Step 1
11. "Open skill" [↗] button: drawer opens on top of modal (modal visible behind drawer scrim)
12. Close drawer: modal regains focus, state preserved
