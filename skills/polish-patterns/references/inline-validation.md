# Inline form validation with ARIA wiring

## Problem

Validation that fires only on submit (and shows a generic "Invalid input" toast) leaves the user guessing what's wrong. Inline validation surfaces the specific cause next to the offending field, with proper ARIA so screen readers announce it.

Implements `ui-ux-pro-max` §8 `inline-validation`, `error-clarity`, `aria-live-errors`.

## Pattern

```tsx
const [tagInput, setTagInput] = useState("");
const [tagInputError, setTagInputError] = useState<string | null>(null);

const addTag = () => {
  const t = tagInput.trim();
  if (!t) return;
  if (t.length > 64) {
    setTagInputError(`tag is ${t.length} chars; 64 max`);
    return;
  }
  if (existingTags.includes(t)) {
    setTagInputError(`"${t}" is already in the list`);
    return;
  }
  // Happy path: clear error, accept the input.
  setExistingTags([...existingTags, t]);
  setTagInput("");
  setTagInputError(null);
};

return (
  <>
    <input
      type="text"
      value={tagInput}
      onChange={(e) => {
        setTagInput(e.target.value);
        if (tagInputError) setTagInputError(null);  // typing clears the error
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          addTag();
        }
      }}
      placeholder="add a tag, press Enter"
      className={`tag-input ${tagInputError ? "invalid" : ""}`}
      aria-invalid={tagInputError ? true : undefined}
      aria-describedby={tagInputError ? "tag-input-error" : undefined}
    />
    {tagInputError && (
      <p id="tag-input-error" className="form-error" role="alert">
        {tagInputError}
      </p>
    )}
  </>
);
```

### CSS

```css
.tag-input.invalid {
  border-color: var(--danger);
}
.tag-input.invalid:focus {
  border-color: var(--danger);
  box-shadow: 0 0 0 3px var(--danger-dim);
}
.form-error {
  margin-top: var(--s1);
  font-size: 11px;
  color: var(--danger);
}
```

## Gotchas

- **Validate on blur (or Enter), not on every keystroke.** Per-keystroke validation creates a flash of "invalid" before the user has finished typing the first character. The skill's `inline-validation` rule is explicit about this.
- **Clear the error when the user starts to fix it.** Otherwise the red ring sticks until they re-blur or press Enter, which feels punishing.
- **`aria-invalid={true|undefined}` not `={true|false}`** — passing `false` puts `aria-invalid="false"` on the element, which AT may announce as "valid" (noisy). Conditional spread or undefined is cleaner.
- **`aria-describedby` ID must match an element actually in the DOM.** If you only conditionally render the error `<p>`, only conditionally set `aria-describedby`. Pointing at a missing id is silent failure.
- **`role="alert"` on the error `<p>`** — announces the message immediately when it appears (vs `aria-live="polite"` which waits). For form errors specifically, alert is appropriate.
- **Position the error close to the field, not at the top of the form.** Top-of-form summaries are useful for *additional* context after submit, but the per-field error must live next to the field. WCAG SC 3.3.1.
- **Server-side errors flow through the same channel.** When a save round-trip fails (e.g. main process rejects), set `tagInputError` from the response. Don't toast it — the field itself is the right place.

## See also

- [a11y-focus-and-motion](a11y-focus-and-motion.md) — focus-visible ring composes with the invalid border.
- ui-ux-pro-max §8 `focus-management`, `error-summary`.
