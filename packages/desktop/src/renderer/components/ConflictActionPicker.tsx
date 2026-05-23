import React from "react";

export interface PickerOption<T extends string> {
  value: T;
  label: React.ReactNode;
  description: React.ReactNode;
  /**
   * Selected-state background tone. Defaults to "accent" (the calm
   * blue used for keep/use/replace). Set to "danger" for destructive
   * choices (Delete) so the selected-row colour signals risk at a
   * glance, complementing the bulk-action button's danger tint.
   */
  selectedTone?: "accent" | "danger";
}

interface Props<T extends string> {
  /** Radio group name — must be unique per row so siblings don't share state. */
  name: string;
  options: PickerOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

/**
 * Radio list of action options used inside each conflict row. The
 * outer card (header + path/diff/error display) stays domain-specific
 * — only the action list is shared, because that's the slice that
 * actually drifted between the two conflict modals.
 *
 * Generic over the action-value union; both conflict modals keep their
 * own discriminated `ConflictAction` / `ConflictResolveAction` types
 * and pass them through unchanged.
 */
export function ConflictActionPicker<T extends string>({
  name,
  options,
  value,
  onChange,
}: Props<T>): React.ReactElement {
  return (
    <>
      {options.map((opt) => {
        const selected = value === opt.value;
        const background = !selected
          ? "transparent"
          : opt.selectedTone === "danger"
            ? "var(--danger-dim, rgba(208, 68, 68, 0.18))"
            : "var(--accent-dim)";
        return (
          <label
            key={opt.value}
            style={{
              display: "block",
              padding: 8,
              marginBottom: 4,
              cursor: "pointer",
              background,
              borderRadius: 4,
            }}
          >
            <input
              type="radio"
              name={name}
              checked={selected}
              onChange={() => onChange(opt.value)}
              style={{ marginRight: 8 }}
            />
            <span style={{ fontWeight: 500 }}>{opt.label}</span>
            <p
              style={{
                margin: "2px 0 0 24px",
                fontSize: 12,
                color: "var(--text-2)",
              }}
            >
              {opt.description}
            </p>
          </label>
        );
      })}
    </>
  );
}
