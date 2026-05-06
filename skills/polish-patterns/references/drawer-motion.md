# Drawer entry motion (slide-in + body fade + spring overshoot)

## Problem

A drawer that slides in too fast feels jarring; one that slides in too slowly feels heavy. Linear easing reads as mechanical. And content that's already animating into view while you're trying to read it is disorienting.

`ui-ux-pro-max` §7 calls out: `duration-timing` (150–300ms for micro-interactions, ≤400ms for transitions), `spring-physics`, `interruptible`, `modal-motion` (animate from trigger source for spatial context).

## Pattern

### Keyframes

```css
@keyframes slideInRight {
  from { transform: translateX(100%); opacity: 0.6; }
  to   { transform: translateX(0);    opacity: 1; }
}
@keyframes drawerBodyFade {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
  from { opacity: 0; } to { opacity: 1; }
}
```

### Drawer + body wiring

```css
.drawer-overlay {
  position: fixed;
  inset: 0;
  background: var(--scrim);  /* themable */
  z-index: 200;
  animation: fadeIn var(--t) var(--ease) both;
}
.drawer {
  position: fixed;
  top: 0; right: 0; bottom: 0;
  width: min(420px, 100vw);
  background: var(--bg);
  border-left: 1px solid var(--border);
  box-shadow: var(--shadow-hover);
  z-index: 201;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  /* Spring-ish overshoot — natural without disorienting bounce. */
  animation: slideInRight 0.28s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  will-change: transform, opacity;
}
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--s5);
  /* Reveal contents just after the panel arrives so the eye lands on
     a settled card rather than scrolling content while it slides. */
  animation: drawerBodyFade var(--t) var(--ease) 0.12s both;
}
```

## Choosing the curve

| Curve | Feel | Use when |
|---|---|---|
| `linear` | Mechanical, robotic | Never for UI |
| `cubic-bezier(0.4, 0, 0.2, 1)` (Material standard) | Smooth, neutral | Tab switches, fades |
| `cubic-bezier(0.34, 1.2, 0.64, 1)` (gentle spring) | Natural, hint of overshoot | Drawers, sheets, modals — anything entering |
| `cubic-bezier(0.34, 1.56, 0.64, 1)` | Pronounced bounce | Use sparingly; only when the bounce is intentional UI signal |

## Gotchas

- **Compound animation = layered keyframes**. Don't try to express slide + fade in one keyframe by interpolating both `transform` and `opacity` — splitting them into the panel slide vs the body fade with a small delay (0.12s) is what makes it feel polished.
- **`opacity: 0.6` start, not `0`**. A hard fade-from-invisible feels like the panel materializes; starting at 60% means it appears as a nearly-solid panel arriving.
- **Duration trim with overshoot**. The skill's "150–300ms for micro-interactions" range is right for the *perceived* duration. Spring curves take longer to settle than the same duration of cubic-out, so trim the actual duration (0.28s here) to compensate.
- **`will-change: transform, opacity`** allocates a GPU layer up front so the very first frame is smooth. Don't blanket `will-change` everywhere — only on elements you're actively animating.
- **Backdrop is hardcoded to `0.5`?** Promote it to a `--scrim` token; it should be heavier in dark themes and gentler in light. See [theme-toggle](theme-toggle.md).
- **No exit animation.** Adding one requires tracking a "closing" state and delaying unmount, which is more state. Skip unless the absence is jarring; in a single-page Electron app it usually isn't.
- **Reduced-motion comes from the global `*` rule** ([a11y-focus-and-motion](a11y-focus-and-motion.md)). Don't repeat it per-keyframe.

## See also

- [a11y-focus-and-motion](a11y-focus-and-motion.md) — the focus-trap hooks that pair with this drawer.
- ui-ux-pro-max §7 `exit-faster-than-enter` — if you do add exit animations, run them at ~60–70% of the enter duration.
