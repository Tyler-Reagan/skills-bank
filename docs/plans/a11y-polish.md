# A11y polish (v0.11.5)

Pick up the 13 deferred items from the v0.11.4 web-design-guidelines audit (`docs/audits/v0.11.4-web-design-guidelines.md`) plus the two chip-tooltip judgement calls from the M4 language-sweep audit. Theme: **the renderer feels production-grade for keyboard + screen-reader users.**

No new features. No paradigm shifts. Markup + CSS + tiny helpers only.

## Milestones

1. **Modal focus-trapping.** `UpdatesModal`, `RepoPickerModal`, `SkillDetailDrawer` all let Tab escape into the background. `useInitialFocus` already lands focus inside on open and `useFocusReturn` restores it on close — what's missing is the in-bounds cycle. Build a `useFocusTrap` hook (preferred over the `react-focus-lock` dep) that cooperates with the existing LIFO Escape stack.
2. **SkillCard → real `<button>` wrapper.** Currently a `<div role="button" tabIndex={0}>` wrapping nested interactive children (tag X, "+ tag" form). Real-button migration requires either splitting the inner action row out of the activation surface or using an event-delegation overlay. Settle the structure first; markup follows.
3. **TagFilter → `aria-pressed` instead of `role="checkbox" aria-checked`.** Verify on VoiceOver + NVDA before flipping; the announced semantics shift slightly.
4. **Drawer overlay semantics.** Replace the clickable `<div aria-hidden="true">` overlay with either a `<button>` overlay (overlays-are-buttons reading) or a backdrop primitive that uses `pointer-events` without a click handler on a div. Keep Escape dismissal intact.
5. **Typography sweep.** Curly quotes throughout user-facing strings; non-breaking spaces between numerals and units; Chicago Title Case audit on button labels (cross-reference glossary — don't re-litigate verbs the canonical entries already pin).
6. **SkillCard animationDelay reduced-motion gating.** Skip the inline `animationDelay` style when `prefers-reduced-motion: reduce` matches. Small `useReducedMotion` hook; reuse across any future motion-conditional logic.
7. **Chip-tooltip judgement calls.** Two M4-deferred rewrites — Bundled chip ("Skills curated as part of the bank's bundled set — managed by Sync.") and Yours chip ("Skills you authored or unlinked from a curated set."). Settle copy once.

## Conflict audit

- **vs v0.11.6 renderer state.** Both touch component files. v0.11.5 lands first (smaller blast radius). v0.11.6's component splits would otherwise force a redo of the focus-trap wiring on each new component.
- **vs v0.11.4's already-shipped `theme.css`.** No conflict; the new `color-scheme` tokens stay.
- **vs v0.12.0 Origin rename.** No conflict — copy uses the user-facing canonical "Origin" which is already settled.

## Exit criteria

- All 13 web-design-guidelines deferred items either landed or explicitly re-deferred with a noted reason.
- VoiceOver + NVDA smoke pass on the three modals.
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm knip && pnpm build` clean.
- Release notes drafted in the user-facing, impact-first style.
