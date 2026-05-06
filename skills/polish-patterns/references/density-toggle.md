# Card density toggle (compact / comfortable)

## Problem

Once your card grid grows past ~50 entries, comfortable density wastes space. But shipping a smaller default punishes the casual user with cramped layouts. The fix is a per-user toggle.

Implements `ui-ux-pro-max` §5 `touch-density`, §10 `data-density`.

## Pattern

Same `[data-x]` attribute pattern as the theme toggle, scoped to layout sizing instead of color.

### CSS — compact override only

```css
/* Default = comfortable; the override only kicks in when the attribute is set. */
:root[data-density="compact"] .skills-grid {
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--s3);
}
:root[data-density="compact"] .skill-card {
  padding: var(--s3);
  border-radius: var(--r);
}
:root[data-density="compact"] .skill-name { font-size: 13px; }
:root[data-density="compact"] .skill-description {
  font-size: 12px;
  -webkit-line-clamp: 2;
  margin-bottom: var(--s2);
}
:root[data-density="compact"] .skill-meta-row {
  margin-bottom: var(--s2);
  font-size: 10px;
}
```

### State + toggle (App)

```tsx
type Density = "comfortable" | "compact";

const LS_DENSITY = "myapp.density";

function readInitialDensity(): Density {
  try {
    const stored = localStorage.getItem(LS_DENSITY);
    if (stored === "compact" || stored === "comfortable") return stored;
  } catch { /* ignore */ }
  return "comfortable";
}

export function App() {
  const [density, setDensity] = useState<Density>(readInitialDensity);

  useEffect(() => {
    document.documentElement.dataset.density = density;
    try { localStorage.setItem(LS_DENSITY, density); } catch { /* ignore */ }
  }, [density]);

  const toggle = () =>
    setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"));

  /* … */
}
```

### Toggle button

Same destination-indicator pattern as theme. Lucide's `align-justify` reads as "rows" (compact); `layout-grid` reads as "spread out" (comfortable).

```tsx
<button
  className="icon-btn"
  type="button"
  onClick={onToggleDensity}
  aria-label={`Switch to ${density === "comfortable" ? "compact" : "comfortable"} card density`}
>
  <Icon
    name={density === "comfortable" ? "density-compact" : "density-comfortable"}
    size="md"
  />
</button>
```

## Gotchas

- **Default lives in the un-overridden tokens, not in the attribute.** Don't write `[data-density="comfortable"] { … }` rules — keep comfortable as the literal default, override only when compact is set. Halves the rule count and makes "no override" debug easier.
- **No system preference for density.** Unlike theme (`prefers-color-scheme`), there's no OS hint. Always default to comfortable on first run.
- **Same selector specificity matters.** `:root[data-density="compact"] .skill-card` (specificity 0,1,1,1) beats `.skill-card { … }` (0,0,1,0). Don't write `body[data-density…]` — `:root` and `<html>` are equivalent and `:root` reads as "tokens".
- **CSS variables would also work** (e.g. `--card-padding`) but bloat the token surface and obscure intent. Direct property overrides are clearer at this scale.

## See also

- [theme-toggle](theme-toggle.md) — sister pattern; both attributes can coexist on `<html>`.
- [icon-system](icon-system.md) — `density-compact` and `density-comfortable` icons.
