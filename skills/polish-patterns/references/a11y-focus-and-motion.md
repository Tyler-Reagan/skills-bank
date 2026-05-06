# Focus rings, reduced motion, modal focus management

## Problem

Three accessibility musts that are easy to forget:

1. **Visible focus on every interactive surface**, but not on every click — keyboard users need rings; mouse users find them ugly. (`ui-ux-pro-max` §1 `focus-states`)
2. **Respect `prefers-reduced-motion`** — every animation/transition must collapse to a near-zero duration when the OS setting is on. (§7 `reduced-motion`)
3. **Modal focus must trap and return** — opening a dialog moves focus into it; closing returns focus to the element that opened it. (§1 `escape-routes`, `voiceover-sr`)

Naive approaches fall short:
- Browser default focus rings show on click — visually noisy.
- Hand-checking `prefers-reduced-motion` per animation — easy to forget some.
- Re-focusing the originating element manually — easy to forget; impossible if the element unmounted.

## Pattern

### CSS baseline (one-time setup)

```css
:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--r-sm);
}

/* Inset ring for elements clipped by parent overflow (e.g. cards in a grid). */
.skill-card:focus-visible {
  outline-offset: -2px;
  outline-color: var(--accent);
  border-color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.001ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.001ms !important;
    scroll-behavior: auto !important;
  }
}

.visually-hidden {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

### Focus-return + initial-focus hooks

```ts
// hooks/useFocusReturn.ts
import { useEffect, useRef } from "react";

export function useFocusReturn(): void {
  const originRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    originRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      const target = originRef.current;
      if (target && document.contains(target)) {
        try { target.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
    };
  }, []);
}

export function useInitialFocus<T extends HTMLElement>(
  ref: React.RefObject<T | null>,
): void {
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const focusable = root.querySelector<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable) {
      try { focusable.focus({ preventScroll: true }); } catch { /* ignore */ }
    }
  }, [ref]);
}
```

### Drawer/modal usage

```tsx
import { useRef } from "react";
import { useFocusReturn, useInitialFocus } from "./hooks/useFocusReturn";

export function MyDrawer({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLElement | null>(null);
  useFocusReturn();
  useInitialFocus(ref);

  // Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside ref={ref} role="dialog" aria-modal="true" aria-label="Details">
        {/* … */}
      </aside>
    </>
  );
}
```

## Gotchas

- **`:focus` vs `:focus-visible`** — set `:focus { outline: none; }` *before* `:focus-visible` so click-focus stays clean while keyboard-focus shows the ring. Don't disable focus globally without re-enabling `:focus-visible`.
- **Inset rings on clipped containers** — if your card lives inside a grid with `gap`, the default `outline-offset: 2px` paints into the gap and the ring gets cut. Use a negative offset (`-2px`) on those specific selectors.
- **Reduced-motion is global; per-component opt-in is rare.** The `*` selector with `!important` is the right hammer here. If a particular animation conveys meaning that can't be replaced (e.g. progress indicator), opt it back in via a more specific rule with `prefers-reduced-motion: no-preference` media.
- **Focus return needs `document.contains(target)`** — the originating element may have unmounted while the modal was open (rare but possible). Guard the call.
- **`useInitialFocus` and React Strict Mode** — Strict Mode runs effects twice in dev. The second invocation may steal focus from elsewhere if the modal stayed mounted. In practice we only run the effect once because the dep array is `[ref]`; the ref is stable. If you see double-focus issues, gate with a `did` flag.

## See also

- [aria-tablist](aria-tablist.md) — keyboard nav for tab widgets specifically
- [drawer-motion](drawer-motion.md) — animation tokens that pair with reduced-motion
- [first-run-setup](first-run-setup.md) — uses these hooks in its dialog
