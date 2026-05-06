# Icon system (inline SVG, currentColor, single component)

## Problem

Three smells the `ui-ux-pro-max` skill calls out:

- Emoji as structural icons (✓ ✗ ⚠ × ↻) → render inconsistently across platforms; macOS may upgrade to colored emoji unexpectedly.
- Mixed icon families → looks unprofessional.
- Inconsistent stroke widths and sizes → the skill's `icon-style-consistent`, `consistent-icon-sizing`, `stroke-consistency` rules.

The fix is one Icon component drawing from one source (here: Lucide), one stroke width, one set of size tokens, and `currentColor` so parent CSS controls visible color.

## Pattern

```tsx
// components/Icon.tsx
import React from "react";

export type IconName =
  | "check" | "x" | "refresh" | "alert-triangle" | "alert-circle"
  | "arrow-right" | "external-link" | "search" | "info" | "broken-link"
  | "folder" | "sun" | "moon"
  | "density-compact" | "density-comfortable" | "settings";

interface Props {
  name: IconName;
  size?: number | "sm" | "md" | "lg" | "xl";
  strokeWidth?: number;
  className?: string;
  "aria-hidden"?: boolean;
  "aria-label"?: string;
  title?: string;
}

// SVG width/height attributes don't accept CSS variables, so size names
// resolve to numeric pixel values. Keep these in sync with the
// --icon-sm/md/lg/xl tokens in your theme if you also use them in CSS.
const SIZE_PX: Record<string, number> = { sm: 12, md: 14, lg: 16, xl: 20 };

export function Icon({
  name, size = "md", strokeWidth = 2, className,
  "aria-hidden": ariaHidden = true,
  "aria-label": ariaLabel, title,
}: Props) {
  const dimension =
    typeof size === "number" ? size : (SIZE_PX[size] ?? SIZE_PX["md"]!);
  const a11yProps = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": ariaHidden };

  return (
    <svg
      width={dimension} height={dimension}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-2px" }}
      {...a11yProps}
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}

const PATHS: Record<IconName, React.ReactElement> = {
  check: <polyline points="20 6 9 17 4 12" />,
  x: (
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>
  ),
  refresh: (
    <>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
      <path d="M20.49 15A9 9 0 0 1 5.64 18.36L1 14" />
    </>
  ),
  // …rest of paths from Lucide (https://lucide.dev — ISC).
} as Record<IconName, React.ReactElement>;
```

### Usage

```tsx
{/* Decorative — paired text carries meaning. */}
<button>
  <Icon name="refresh" size="md" /> Refresh
</button>

{/* Standalone meaning — needs a label. */}
<button aria-label="Close" onClick={onClose}>
  <Icon name="x" size="lg" />
</button>

{/* Inside a chip; color flows from chip. */}
<span className="status-chip ours">
  <Icon name="check" size="sm" /> Installed
</span>
```

### Token sizes (CSS, optional)

```css
:root {
  --icon-sm: 12px;
  --icon-md: 14px;
  --icon-lg: 16px;
  --icon-xl: 20px;
}
```

## Gotchas

- **SVG `width`/`height` attributes are SVG `<length>`, not CSS.** They reject `var(--icon-md)` — silently fall back to default 300×300, which is why icons render hilariously oversized. Resolve named sizes to numbers in JS before passing to the SVG element. If you really need CSS-driven sizing, set `width`/`height` via `style={{}}` instead.
- **`currentColor` is the trick.** Setting `color` on a parent (status chip, button text) drives the icon. Lets one component theme correctly in dark/light without conditional logic.
- **`aria-hidden` by default; `aria-label` opt-in.** An icon paired with text is decorative — hide it from AT to avoid double announcement. A standalone icon button needs the parent button to have `aria-label`, or the icon itself to have `role="img"` + `aria-label`.
- **Same `viewBox` (24×24) and `strokeWidth` for everything.** Lucide is consistent here; don't mix in icons from another set without re-tracing them at 24×24, stroke 2.
- **`flex-shrink: 0`** in the inline style prevents flex parents from squishing the icon when their other children grow.

## See also

- [theme-toggle](theme-toggle.md), [density-toggle](density-toggle.md) — both use Icon for the toggle buttons.
- ui-ux-pro-max §4 `effects-match-style` — pick an icon set whose visual language matches your overall style (Lucide is line-based; Heroicons has solid + outline variants; etc.).
