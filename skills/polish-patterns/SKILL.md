---
name: polish-patterns
description: "Copy-ready React+TypeScript implementations of UI polish patterns — token-driven theming with light/dark + density toggles, focus-return modal hooks, skeleton loaders, toast-with-undo, inline ARIA validation, drawer motion, first-run setup, and a small Icon component. A launchpad of concrete code that complements ui-ux-pro-max's design rules; pair the two when you have a rule to satisfy and want a working starting point."
---

# polish-patterns — Launchpad for React+TS UI polish

This skill is the **implementation companion** to `ui-ux-pro-max`. That skill tells you *which* design rules to follow (priority taxonomy, accessibility requirements, animation timing, etc.); this one gives you concrete code patterns that satisfy them, harvested from a real Electron + React + TS app refactor.

## When to use this skill

Reach for it when you have:

- A UI polish task on a React/TypeScript codebase (Electron, web, or otherwise — patterns are framework-agnostic where possible)
- A specific rule from `ui-ux-pro-max` you need to satisfy and you want a working starting point rather than to derive the implementation from scratch
- A "make this feel less rough" task without a single specific rule attached — flip through the references and triage

## When NOT to use this skill

- Pure design decisions (palette pick, font pairing, layout strategy) — that's `ui-ux-pro-max`.
- Greenfield architectural choices (state management, routing, build tooling).
- Anything outside the React+TS ecosystem — patterns may translate but aren't drop-in.

## Decision table

| I want to… | Reference | ui-ux-pro-max rules it implements |
|---|---|---|
| Make every interactive surface focus-visible without painting outlines on click | [a11y-focus-and-motion](references/a11y-focus-and-motion.md) | §1 `focus-states`, `keyboard-nav`, §7 `reduced-motion` |
| Trap focus in a modal and restore it on close | [a11y-focus-and-motion](references/a11y-focus-and-motion.md) | §1 `escape-routes`, `voiceover-sr` |
| Make tabs (or any custom widget) keyboard-operable | [aria-tablist](references/aria-tablist.md) | §1 `keyboard-nav`, §9 `nav-state-active` |
| Add a dark/light theme toggle that respects OS preference | [theme-toggle](references/theme-toggle.md) | §6 `color-dark-mode`, `color-semantic`, `dark-mode-pairing` |
| Add a card density (compact/comfortable) toggle | [density-toggle](references/density-toggle.md) | §5 `touch-density`, §10 `data-density` |
| Render skeleton loaders instead of a spinner for >300ms operations | [skeleton-loaders](references/skeleton-loaders.md) | §3 `progressive-loading`, `loading-states` |
| Show a toast with an Undo action (reversible destructive op) | [toast-with-undo](references/toast-with-undo.md) | §8 `undo-support`, `confirmation-dialogs`, `success-feedback` |
| Inline-validate an input with proper ARIA wiring | [inline-validation](references/inline-validation.md) | §8 `inline-validation`, `error-clarity`, `aria-live-errors` |
| Build an icon system with `currentColor` SVG | [icon-system](references/icon-system.md) | §4 `no-emoji-icons`, `icon-style-consistent`, `consistent-icon-sizing` |
| Animate a slide-in drawer that doesn't disorient | [drawer-motion](references/drawer-motion.md) | §7 `duration-timing`, `spring-physics`, `interruptible`, `modal-motion` |
| Replace empty-state dead-ends with actionable empty states | [empty-states](references/empty-states.md) | §8 `empty-states`, §9 `empty-nav-state` |
| Add a first-run setup screen with file/folder picker + persistence | [first-run-setup](references/first-run-setup.md) | §8 `progressive-disclosure`, `error-clarity`, `error-recovery` |

## How references are written

Each reference doc is structured the same way:

1. **Problem** — the rule(s) from ui-ux-pro-max being satisfied and why the naive approach falls short.
2. **Pattern** — minimal, copy-ready code (TypeScript + CSS).
3. **Gotchas** — what bit me when I implemented this. The biggest source of value: SVG attribute parsers reject CSS variables, hooks must run in stable order across renders, etc.
4. **See also** — sibling references that compose with this one.

Code is intentionally framework-light (React 18 + plain CSS variables — no styled-components, no Tailwind, no UI library). If you're on a different stack, the patterns translate; the snippets are starting points.

## Tooling alignment

These patterns assume:

- React 18+ with hooks
- TypeScript 5+ (`strict: true` recommended)
- CSS custom properties (works in every modern browser; Electron always)
- A build that lets you keep CSS variables in `:root` and emit semantic tokens
- No mandatory dependencies. The toast and skeleton patterns are pure CSS+React state. The Icon system uses inline SVG paths from Lucide (https://lucide.dev — ISC) but you can sub any path data.

## Pair with ui-ux-pro-max

The intended flow:

1. Run a `ui-ux-pro-max` design-system search for your product type to get palette / typography / style guidance.
2. Open this skill and copy the patterns that match the rules surfaced.
3. Iterate.

If you find a polish pattern that should be here and isn't, the right home is a new reference under this skill — not a new top-level skill — keeping the launchpad coherent.
