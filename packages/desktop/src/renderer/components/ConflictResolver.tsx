import React, { useState } from "react";
import { Modal } from "./modalStyles.js";

// Generic conflict-resolver modal shared by the three resolver domains:
//   - SyncConflictModal      — file-content sync collisions (per skill)
//   - InstallCollisionModal  — agent-dir stragglers (per agent)
//   - ManifestConflictModal  — manifest 3-way merge intent (per skill)
// Each domain was a structural clone of the others (toolbar + rows +
// action picker + tally + footer) differing only in row content, action
// unions, and apply semantics — exactly the drift the old
// BulkSelectToolbar comment warned about. The skeleton now lives here
// once; domains own their picks state (controlled), row rendering, and
// decision mapping. InstallConflictModal is NOT a resolver (it's a
// pre-install gate with no per-row picks) and stays separate.

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

interface PickerProps<T extends string> {
  /** Radio group name — must be unique per row so siblings don't share state. */
  name: string;
  options: PickerOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

/**
 * Radio list of action options used inside each conflict row. Also
 * consumed standalone by ManageLabelsModal for its scope/skills picks.
 */
export function ConflictActionPicker<T extends string>({
  name,
  options,
  value,
  onChange,
}: PickerProps<T>): React.ReactElement {
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

interface ToolbarProps<T extends string> {
  actions: BulkAction<T>[];
  onSelectAll: (action: T) => void;
  disabled?: boolean;
  /**
   * Right-aligned live tally text, rendered in an `aria-live` polite
   * region so screen-reader users hear running totals as they adjust
   * per-row picks.
   */
  tally: string;
}

function BulkSelectToolbar<T extends string>({
  actions,
  onSelectAll,
  disabled = false,
  tally,
}: ToolbarProps<T>): React.ReactElement {
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
      <span style={tallyStyle} aria-live="polite">
        {tally}
      </span>
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

interface ConflictResolverProps<T, A extends string> {
  /** Modal aria-label and heading. */
  title: string;
  /** Muted paragraph under the heading explaining the conflict domain. */
  intro: React.ReactNode;
  width?: React.ComponentProps<typeof Modal>["width"];
  items: T[];
  itemKey: (item: T) => string;
  /** Per-row action options. Same set for every row. */
  options: PickerOption<A>[];
  bulkActions: BulkAction<A>[];
  /**
   * Controlled picks, keyed by `itemKey`. State lives in the domain
   * wrapper so it can derive decisions, warnings, and tallies from it.
   */
  picks: Record<string, A>;
  /** Fallback when a key is missing from `picks`. */
  defaultAction: A;
  onPickChange: (key: string, next: A) => void;
  onSetAll: (action: A) => void;
  /** Live summary line shown in the toolbar, e.g. "Keep 2 · Delete 1". */
  tally: string;
  /**
   * Domain row content rendered above the action picker: header,
   * paths, diffs, error alerts. The picker itself is appended by the
   * resolver.
   */
  renderRow: (item: T) => React.ReactNode;
  /** Adds the error border to rows whose apply attempt failed. */
  rowHasError?: (item: T) => boolean;
  /** Optional alert block between the list and the footer. */
  warning?: React.ReactNode;
  applyLabel?: string;
  applyDanger?: boolean;
  /**
   * Apply the current picks. The resolver wraps this in a submitting
   * gate; the domain decides whether to close (success) or stay open
   * with per-row errors (partial failure).
   */
  onApply: () => Promise<void> | void;
  onClose: () => void | Promise<void>;
}

export function ConflictResolver<T, A extends string>({
  title,
  intro,
  width = 640,
  items,
  itemKey,
  options,
  bulkActions,
  picks,
  defaultAction,
  onPickChange,
  onSetAll,
  tally,
  renderRow,
  rowHasError,
  warning,
  applyLabel = "Apply",
  applyDanger = false,
  onApply,
  onClose,
}: ConflictResolverProps<T, A>): React.ReactElement {
  const [submitting, setSubmitting] = useState(false);

  const apply = async () => {
    setSubmitting(true);
    try {
      await onApply();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      label={title}
      onClose={() => void onClose()}
      width={width}
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">{title}</h2>
      <p className="text-muted text-13 mt-4">{intro}</p>

      <BulkSelectToolbar
        actions={bulkActions}
        onSelectAll={onSetAll}
        disabled={submitting}
        tally={tally}
      />

      <div className="conflict-res-scroll">
        {items.map((item) => {
          const key = itemKey(item);
          return (
            <div
              key={key}
              className={`conflict-res-row${rowHasError?.(item) ? " conflict-res-row--error" : ""}`}
            >
              {renderRow(item)}
              <ConflictActionPicker
                name={`conflict-${key}`}
                options={options}
                value={picks[key] ?? defaultAction}
                onChange={(next) => onPickChange(key, next)}
              />
            </div>
          );
        })}
      </div>

      {warning}

      <div className="row-end mt-12">
        <button onClick={() => void onClose()} disabled={submitting}>
          Cancel
        </button>
        <button
          className={applyDanger ? "btn danger" : "primary"}
          onClick={() => void apply()}
          disabled={submitting}
        >
          {submitting ? "Applying…" : applyLabel}
        </button>
      </div>
    </Modal>
  );
}
