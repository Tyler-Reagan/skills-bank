# Theme toggle (light/dark) via `[data-theme]` token override

## Problem

You want a clean dark/light toggle that:
- Uses CSS custom properties so every component themes automatically (no per-component conditional logic).
- Honors `prefers-color-scheme` on first run.
- Persists the user's explicit choice across sessions.
- Doesn't flicker on launch.

Implements `ui-ux-pro-max` §6 `color-dark-mode`, `color-semantic`, `dark-mode-pairing`.

## Pattern

### 1. Define tokens for both themes (`theme.css`)

Default block sets dark; `[data-theme="light"]` overrides only what differs. Keep semantic *names* identical across themes — only the *values* change.

```css
:root {
  --bg:          #0F172A;
  --surface:     #1E293B;
  --surface-hi:  #272F42;
  --border:      #334155;
  --text:        #F8FAFC;
  --text-2:      #94A3B8;
  --accent:      #22C55E;
  --accent-dim:  rgba(34, 197, 94, 0.12);
  --on-primary:  #0a0d12;     /* foreground on accent backgrounds */
  --scrim:       rgba(0, 0, 0, 0.55);
  --header-bg:   rgba(15, 23, 42, 0.85);
  /* … */
}

:root[data-theme="light"] {
  --bg:          #F8FAFC;
  --surface:     #FFFFFF;
  --surface-hi:  #F1F5F9;
  --border:      #E2E8F0;
  --text:        #0F172A;
  --text-2:      #475569;
  --accent:      #16A34A;       /* one step darker for AA on near-white */
  --accent-dim:  rgba(22, 163, 74, 0.12);
  --on-primary:  #FFFFFF;       /* white on darker green */
  --scrim:       rgba(15, 23, 42, 0.32);
  --header-bg:   rgba(248, 250, 252, 0.88);
  /* … */
}
```

### 2. Read + apply theme (App)

```tsx
type Theme = "dark" | "light";

const LS_THEME = "myapp.theme";

function readInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(LS_THEME);
    if (stored === "dark" || stored === "light") return stored;
  } catch { /* ignore */ }
  if (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: light)").matches
  ) return "light";
  return "dark";
}

export function App() {
  const [theme, setTheme] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(LS_THEME, theme); } catch { /* ignore */ }
  }, [theme]);

  const toggle = () =>
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  return (/* … pass theme + toggle to Header … */);
}
```

### 3. Toggle button (destination-indicator pattern)

Show the icon that represents what *clicking* will result in, not the current state. In dark mode → sun (clicking gives light); in light → moon.

```tsx
<button
  className="icon-btn"
  type="button"
  onClick={onToggleTheme}
  aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
  title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
>
  <Icon name={theme === "dark" ? "sun" : "moon"} size="md" />
</button>
```

## Gotchas

- **Tokens that don't translate.** Hardcoded `rgba(0,0,0,0.5)` for a modal scrim, or `rgba(13,17,23,.92)` for a translucent header — both look heavy in light mode. Promote them to themable tokens (`--scrim`, `--header-bg`) and override per theme.
- **Foreground-on-saturated.** Buttons that fill on hover (e.g. `:hover { background: var(--accent); color: ??? }`) need a `--on-primary` token. Dark theme = near-black on bright green; light theme = white on darker green.
- **Apply to `<html>` not `<body>`.** Tokens cascade from `:root`; setting `data-theme` on `documentElement` lets the override hit before any element's first paint.
- **No flash.** This pattern works without an inline boot-script because Electron's renderer paints after `app.whenReady` and the `useEffect` fires before paint of the main view. For pure web apps, you'd want a small `<script>` in `<head>` that reads localStorage and sets the attribute before the bundle loads.
- **Don't disable `prefers-reduced-motion` transitions on theme change.** A user toggling theme expects an instant swap, not animated. Most CSS properties don't transition by default; double-check anything you have explicit `transition: all` on (you shouldn't).

## Compose with

- [density-toggle](density-toggle.md) uses the same `[data-x]` attribute pattern for compact/comfortable. Two attributes can coexist on `<html>` independently.
- [icon-system](icon-system.md) — sun/moon icons.

## See also

- ui-ux-pro-max §6 `color-accessible-pairs` — verify each foreground/background pair meets 4.5:1 separately in both themes.
