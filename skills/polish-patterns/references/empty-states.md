# Actionable empty states

## Problem

"No results" with nothing else is a dead-end — the user has to figure out what to do next. The skill's `empty-states` rule says: *helpful message and action when no content*. The fix is per-context: distinguish between "genuinely empty" and "filtered to empty", and give the user the right escape.

Implements `ui-ux-pro-max` §8 `empty-states`, §9 `empty-nav-state`.

## Pattern

### Distinguish the two cases

```tsx
interface SkillsGridProps {
  entries: RegistryEntry[];
  emptyMessage?: React.ReactNode;
  /** Pass only when filters are actually narrowing — empty selection should NOT show this. */
  onClearFilters?: () => void;
}

export function SkillsGrid({ entries, emptyMessage, onClearFilters }: SkillsGridProps) {
  if (entries.length === 0) {
    return (
      <div className="empty-state">
        {emptyMessage ?? (
          <>
            <strong>No skills match the current filter.</strong>
            <p>Try a different search term or pick a different tag.</p>
          </>
        )}
        {onClearFilters && (
          <div style={{ marginTop: 16 }}>
            <button className="btn primary" onClick={onClearFilters}>
              Clear filters
            </button>
          </div>
        )}
      </div>
    );
  }
  /* … grid … */
}

// Caller:
<SkillsGrid
  entries={filtered}
  onClearFilters={
    search.length > 0 || selectedTags.length > 0
      ? () => { setSearch(""); setSelectedTags([]); }
      : undefined  // genuinely empty registry → no Clear filters button
  }
/>
```

### Inline empty (smaller, inside a section)

```tsx
{!skillMd ? (
  <div className="empty-inline">
    <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
      No <code>SKILL.md</code> in this folder.
    </p>
    <button
      type="button"
      className="btn ghost"
      onClick={revealInFinder}
      disabled={!path}
    >
      <Icon name="folder" size="sm" /> Open folder to create one
    </button>
  </div>
) : (
  <Preview content={skillMd} />
)}
```

### CSS

```css
.empty-state {
  text-align: center;
  padding: 64px 16px;
  color: var(--text-3);
}
.empty-state strong {
  display: block;
  color: var(--text-2);
  font-size: 15px;
  margin-bottom: 8px;
}
.empty-state p { font-size: 13px; }

/* Softer than .empty-state — for sections inside cards/drawers. */
.empty-inline {
  background: var(--surface);
  border: 1px dashed var(--border);
  border-radius: var(--r);
  padding: 16px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}
.empty-inline p { margin: 0; font-size: 12px; }
```

## Decision matrix

| Scenario | Empty-state should... |
|---|---|
| Registry has 0 entries (no filters applied) | Explain what populates it ("Add a skill folder…") + action that helps ("Refresh", "View docs"). |
| Filtered to 0 of N | "No skills match the current filter." + Clear filters button. |
| Drawer section has 0 items (e.g. no SKILL.md) | Inline note + a low-priority action (open folder, create file). Don't dominate the drawer. |
| Tab content is permanently empty in this state (e.g. nothing installed yet) | Two action buttons: the primary path (browse) + the alternative (scan for existing). |

## Gotchas

- **Don't render the "Clear filters" button when no filters are applied.** The user looks at "0 of 0 skills, [Clear filters]" and gets confused. Pass the callback as `undefined` in that case.
- **Page-level vs inline.** The page-level `.empty-state` is large and centered; the inline `.empty-inline` is small and dashed. Mismatching them feels heavy/light.
- **One primary action per empty state.** Multiple equally-weighted CTAs become decision fatigue. If you have two, make one primary and one ghost.
- **Action copy: do, not describe.** "Refresh" beats "You can refresh"; "Browse registry" beats "There are skills in the registry".
- **An icon-only empty state is rarely enough.** Pair illustrations with text; let neither carry alone.

## See also

- [first-run-setup](first-run-setup.md) — full-page empty state with a single, clear action.
- ui-ux-pro-max §8 `progressive-disclosure` — don't overwhelm; one explanation, one action.
