import React from "react";

/**
 * A single bulk action button shown in the toolbar.
 * `label` is a `ReactNode` so callers can embed inline `<code>` (e.g.
 * `Rename to <name>-local`); `danger` tints the label red for
 * destructive bulk operations (`Delete all`).
 */
export interface BulkAction<T extends string> {
  value: T;
  label: React.ReactNode;
  danger?: boolean;
}

interface Props<T extends string> {
  actions: BulkAction<T>[];
  onSelectAll: (action: T) => void;
  disabled?: boolean;
  /**
   * Optional right-aligned tally text. Renders inside an `aria-live`
   * polite region so screen-reader users hear running totals as they
   * adjust per-row picks. Pass `undefined` to omit the slot entirely.
   */
  tally?: string;
}

/**
 * Labelled "Select all:" strip used by both conflict modals. Owns the
 * subtle-surface container, the leading label, and the compact-button
 * styling so the v1.11.0/v1.11.1 drift (one modal got the treatment,
 * the other didn't) becomes structurally impossible to repeat.
 *
 * The action set is caller-controlled — sync conflicts pass three
 * actions (keep / use-incoming / rename), install collisions pass two
 * or three (replace / keep / delete). Generic over the action-value
 * union so each caller keeps its own discriminated type.
 */
export function BulkSelectToolbar<T extends string>({
  actions,
  onSelectAll,
  disabled = false,
  tally,
}: Props<T>): React.ReactElement {
  return (
    <div style={toolbar}>
      <span style={leadingLabel}>Select all:</span>
      {actions.map((a) => (
        <button
          key={a.value}
          type="button"
          onClick={() => onSelectAll(a.value)}
          disabled={disabled}
          style={a.danger ? { ...btn, color: "var(--danger, #d04444)" } : btn}
        >
          {a.label}
        </button>
      ))}
      {tally !== undefined && (
        <span style={tallyStyle} aria-live="polite">
          {tally}
        </span>
      )}
    </div>
  );
}

const toolbar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 6,
  marginTop: 12,
  marginBottom: 12,
  padding: "6px 10px",
  background: "var(--surface-2, rgba(0,0,0,0.03))",
  border: "1px solid var(--border)",
  borderRadius: 6,
};

const leadingLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
  marginRight: 2,
  flexShrink: 0,
};

const btn: React.CSSProperties = {
  fontSize: 12,
  padding: "2px 8px",
};

const tallyStyle: React.CSSProperties = {
  flex: 1,
  textAlign: "right",
  alignSelf: "center",
  fontSize: 11,
  color: "var(--text-3)",
};
