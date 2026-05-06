# Keyboard-operable tabs (ARIA tablist)

## Problem

A `<div onClick>` masquerading as a tab is invisible to keyboard users — Tab won't focus it, Enter/Space won't activate it, and screen readers don't know it's a tab. The fix isn't just "use a button"; it's the full ARIA tablist contract.

Implements `ui-ux-pro-max` §1 `keyboard-nav` and §9 `nav-state-active`.

## Pattern

```tsx
import React from "react";

export type TabId = "browse" | "installed";

interface Props {
  active: TabId;
  onChange: (tab: TabId) => void;
  registryCount: number;
  installedCount: number;
}

export function Tabs({ active, onChange, registryCount, installedCount }: Props) {
  const tabs: Array<{ id: TabId; label: string; count: number }> = [
    { id: "browse",    label: "Registry",  count: registryCount },
    { id: "installed", label: "Installed", count: installedCount },
  ];

  const onTabKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (currentIdx + dir + tabs.length) % tabs.length;
      onChange(tabs[next]!.id);
      const buttons = (e.currentTarget.parentElement?.querySelectorAll(
        "[role=tab]",
      ) ?? []) as NodeListOf<HTMLButtonElement>;
      buttons[next]?.focus();
    }
  };

  return (
    <div className="tabs-row" role="tablist" aria-label="Skills views">
      {tabs.map((t, idx) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${t.id}`}
            id={`tab-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            className={`tab ${isActive ? "active" : ""}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
          >
            {t.label} <span className="count">({t.count})</span>
          </button>
        );
      })}
    </div>
  );
}
```

The matching content region:

```tsx
<div
  className="content"
  role="tabpanel"
  id={`tabpanel-${tab}`}
  aria-labelledby={`tab-${tab}`}
>
  {/* tab content */}
</div>
```

CSS — make sure `.tab` rule works for both `<div>` (legacy) and `<button>` (correct):

```css
.tab {
  padding: 12px 16px;
  cursor: pointer;
  border: none;            /* button reset */
  background: none;        /* button reset */
  border-bottom: 2px solid transparent;
  user-select: none;
  color: var(--text-2);
  transition: color var(--t) var(--ease), border-color var(--t) var(--ease);
}
.tab:hover { color: var(--text); }
.tab.active { color: var(--accent); border-bottom-color: var(--accent); }
```

## Gotchas

- **Roving tabindex** — `tabIndex={isActive ? 0 : -1}` is the canonical pattern. Tab/Shift+Tab moves focus *into and out of* the tablist; ArrowLeft/Right moves *within*. Without roving, every tab is in the global tab order, and Shift+Tab walks backward through them one at a time which feels wrong.
- **Use `role="tab"` only on widgets that obey the tablist contract.** Just adding the role without ArrowLeft/Right + roving tabindex is worse than not adding it.
- **`aria-controls` + matching panel `id`** — drives screen-reader announcements ("Registry tab, controls Registry panel"). The panel needs `aria-labelledby` pointing back at the tab id for the inverse association.
- **Click-only is fine; don't auto-focus the panel content on tab change.** Some implementations move focus into the panel on activation; that's appropriate for some patterns and disorienting for others. Default to no focus shift.
- **Don't forget `<button type="button">`** — defaults to `type="submit"` inside a form, which would submit when Enter is pressed.

## See also

- [a11y-focus-and-motion](a11y-focus-and-motion.md) — the `:focus-visible` baseline that paints the focus ring
- ui-ux-pro-max §9 `navigation-consistency`, `back-stack-integrity`
