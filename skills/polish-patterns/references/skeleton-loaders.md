# Skeleton loaders (shimmer placeholders)

## Problem

A bare spinner over a blank screen feels heavier than it actually is — the user doesn't know what's loading or how the layout will arrange. Skeletons preview the shape of the result, communicating both *something is loading* and *here's where each piece goes*. Use them for any operation expected to exceed ~300ms.

Implements `ui-ux-pro-max` §3 `progressive-loading`, `loading-states`.

## Pattern

### CSS

```css
@keyframes skills-bank-shimmer {
  from { background-position: -800px 0; }
  to   { background-position:  800px 0; }
}

.skeleton {
  display: block;
  background: linear-gradient(
    90deg,
    var(--surface) 0%,
    var(--surface-hi) 50%,
    var(--surface) 100%
  );
  background-size: 800px 100%;
  background-repeat: no-repeat;
  border-radius: var(--r-sm);
  animation: skills-bank-shimmer 1.4s linear infinite;
}
.skeleton-line { height: 12px; margin-bottom: var(--s2); }
.skeleton-card {
  height: 184px;
  border-radius: var(--r-lg);
  animation-duration: 1.6s;
}
```

### Initial-load skeleton (over real chrome)

Render the actual app chrome (header, tabs) immediately so the user sees structure instantly; fill the content area with skeleton cards.

```tsx
if (initialLoading) {
  return (
    <div className="app" aria-busy="true">
      <Header refreshing onRefresh={() => undefined} /* … */ />
      <Tabs active="browse" onChange={() => undefined} /* … */ />
      <div className="content">
        <div className="skills-grid" aria-label="Loading registry and installed skills">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="skeleton skeleton-card"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

### Inline skeleton (for a section that loads after the page)

```tsx
{loading ? (
  <div role="status" aria-busy="true" aria-label="Loading SKILL.md preview">
    {[100, 86, 92, 70, 96, 64].map((width, i) => (
      <div
        key={i}
        className="skeleton skeleton-line"
        style={{ width: `${width}%`, animationDelay: `${i * 60}ms` }}
      />
    ))}
  </div>
) : (
  <Content data={data} />
)}
```

## Gotchas

- **`aria-busy` + `role="status"` for screen readers.** Visual shimmer is meaningless to AT; pair with a label so it announces "Loading X". `aria-busy="true"` tells AT not to announce children as if they were stable content.
- **Stagger animation-delay across instances.** All skeletons shimmering in lockstep looks like a coordinated UI bug. 60–80ms between siblings is enough.
- **Gradient direction matters.** `90deg` (left-to-right) reads as "loading"; `0deg` (top-to-bottom) reads as broken or unintentional.
- **Reduced-motion is implicit if you have the global `*` reduce rule** ([a11y-focus-and-motion](a11y-focus-and-motion.md)). Don't repeat it per-keyframe.
- **Don't try to match exact card height.** Skeletons are signals, not previews of pixel-exact layouts. A roughly card-height block is enough.
- **>300ms gate.** For sub-300ms operations, skeletons make the UI feel slower than just showing the content directly. Reserve skeletons for anything that consistently takes longer.

## See also

- [a11y-focus-and-motion](a11y-focus-and-motion.md) — the global reduced-motion rule that applies here.
- ui-ux-pro-max §3 `font-loading` — same CLS-avoidance principle (reserve space) applies to typography.
