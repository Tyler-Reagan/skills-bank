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
        const labelClass = `conflict-action-label${
          !selected
            ? ""
            : opt.selectedTone === "danger"
              ? " conflict-action-label--danger"
              : " conflict-action-label--accent"
        }`;
        return (
          <label key={opt.value} className={labelClass}>
            <input
              type="radio"
              name={name}
              checked={selected}
              onChange={() => onChange(opt.value)}
              className="conflict-action-radio"
            />
            <span className="conflict-action-option-label">{opt.label}</span>
            <p className="conflict-action-desc">{opt.description}</p>
          </label>
        );
      })}
    </>
  );
}
