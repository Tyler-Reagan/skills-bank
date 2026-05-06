# Toast with action (undo for reversible destructive ops)

## Problem

Confirmation dialogs interrupt flow ("Are you sure you want to uninstall?"). For trivially reversible ops, the modern pattern is *fire-and-undo*: do the thing immediately, surface the result with an Undo button on the toast, time-limited. Implements `ui-ux-pro-max` §8 `undo-support`, `confirmation-dialogs`, `success-feedback`.

This pattern is *only* appropriate when the operation is genuinely reversible. For irreversible deletes (destroying the source), use a confirmation dialog instead.

## Pattern

### Toast shape + helpers

```tsx
type Toast = {
  message: string;
  action?: { label: string; onClick: () => void };
};

const [toast, setToast] = useState<Toast | null>(null);
const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

const flash = useCallback((msg: string) => {
  if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  setToast({ message: msg });
  toastTimerRef.current = setTimeout(() => setToast(null), 2500);
}, []);

const flashWithAction = useCallback(
  (msg: string, label: string, onClick: () => void) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({
      message: msg,
      action: {
        label,
        onClick: () => {
          if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
          setToast(null);
          onClick();
        },
      },
    });
    // Longer timeout when there's an action — user needs time to read + click.
    toastTimerRef.current = setTimeout(() => setToast(null), 6000);
  },
  [],
);
```

### Render

```tsx
{toast && (
  <div className="toast" role="status" aria-live="polite">
    <span>{toast.message}</span>
    {toast.action && (
      <button className="toast-action" onClick={toast.action.onClick}>
        {toast.action.label}
      </button>
    )}
  </div>
)}
```

### Use case (uninstall + undo)

```tsx
// In a child component (e.g. Drawer):
const uninstall = async () => {
  const r = await window.skillsBank.uninstall(name);
  if (r.ok && onUninstalled) {
    onUninstalled(name);  // App-side handler will flashWithAction
  } else {
    onChanged(r.message);
  }
};

// In App:
const undoUninstall = useCallback((name: string) => {
  void (async () => {
    const r = await window.skillsBank.install(name, false);
    flash(r.message);
    await refresh();
  })();
}, [refresh, flash]);

// Wired into the drawer's onUninstalled prop:
<SkillDetailDrawer
  /* … */
  onUninstalled={(name) => {
    flashWithAction(`Uninstalled ${name}`, "Undo", () => undoUninstall(name));
    void refresh();
  }}
/>
```

### CSS

```css
.toast {
  position: fixed;
  bottom: 20px;
  right: 20px;
  background: var(--surface);
  border: 1px solid var(--border-hi);
  padding: var(--s3) var(--s4);
  border-radius: var(--r);
  font-size: 12px;
  box-shadow: var(--shadow);
  z-index: 300;
  animation: slideDown var(--t) var(--ease) both;
  display: flex;
  align-items: center;
  gap: var(--s3);
}
.toast-action {
  background: transparent;
  border: 1px solid var(--accent);
  color: var(--accent);
  border-radius: var(--r-sm);
  padding: 2px var(--s2);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  transition: background var(--t-fast), color var(--t-fast);
}
.toast-action:hover {
  background: var(--accent);
  color: var(--on-primary);
}
```

## Gotchas

- **Single toast at a time.** Always clear the previous timer before setting a new one. Otherwise rapid actions stack timers and the toast disappears unexpectedly mid-read.
- **`role="status"` + `aria-live="polite"`** — announces the message without stealing focus. Don't use `role="alert"`/`aria-live="assertive"` here; that's for errors.
- **Action buttons cancel the timer.** Click → run callback → dismiss the toast. If you don't cancel the timer, the action might fire just as the toast vanishes (visually janky and the user wonders if it worked).
- **Timeout differs by toast type.** Plain `flash` 2.5s; `flashWithAction` 6s. The user needs time to read the message AND react. MD recommends 3–5s for plain; 6s is appropriate when there's a button to click.
- **Undo's reverse op should be idempotent.** If the user clicks Undo twice (rapidly), nothing should break. In our case `installSkill` is idempotent (already-correct symlink → no-op) so this is free.
- **Don't wedge undo into irreversible operations.** "Permanently deleted X — Undo" is dishonest if the data is actually gone. Use a real confirmation dialog instead.

## See also

- [a11y-focus-and-motion](a11y-focus-and-motion.md) — `aria-live` polite/assertive distinction.
- ui-ux-pro-max §8 `error-clarity` — the failure mode when a toast can't be undone needs to explain why and what to do.
