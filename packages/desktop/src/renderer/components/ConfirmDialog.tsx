import React, { useState } from "react";
import { Icon } from "./Icon.js";
import { Modal, modalFooter } from "./modalStyles.js";

interface Props {
  open: boolean;
  title: string;
  /** Body text. Plain string for short prompts; ReactNode for richer layouts. */
  body: React.ReactNode;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  confirmLabel: string;
  /**
   * Visual treatment of the confirm button. Mirrors
   * `SuggestedAction.tone`. Defaults to `"primary"`.
   */
  tone?: "primary" | "danger";
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
}

/**
 * In-app replacement for `window.confirm` so destructive prompts match
 * the rest of the surface. Native confirm dialogs render with the
 * Electron icon and chrome, which broke the visual contract for the
 * overwrite + bulk-repair flows.
 */
export function ConfirmDialog({
  open,
  title,
  body,
  cancelLabel = "Cancel",
  confirmLabel,
  tone = "primary",
  onCancel,
  onConfirm,
}: Props): React.ReactElement | null {
  const [submitting, setSubmitting] = useState(false);

  if (!open) return null;

  const submit = async () => {
    setSubmitting(true);
    try {
      await onConfirm();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal label={title} onClose={onCancel}>
      <h2 style={titleStyle}>
        {tone === "danger" && (
          <span style={iconWrap} aria-hidden="true">
            <Icon name="alert-triangle" size="md" />
          </span>
        )}
        {title}
      </h2>
      <div style={bodyStyle}>{body}</div>
      <div style={modalFooter}>
        <button
          className="btn"
          type="button"
          onClick={onCancel}
          disabled={submitting}
        >
          {cancelLabel}
        </button>
        <button
          className={tone === "danger" ? "btn danger" : "btn primary"}
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
        >
          {submitting ? (
            <>
              <span className="spinner inline" /> Working
            </>
          ) : (
            confirmLabel
          )}
        </button>
      </div>
    </Modal>
  );
}

const titleStyle: React.CSSProperties = {
  margin: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 15,
  fontWeight: 600,
};

const iconWrap: React.CSSProperties = {
  display: "inline-flex",
  color: "var(--danger, #d04444)",
};

const bodyStyle: React.CSSProperties = {
  margin: "12px 0 0 0",
  fontSize: 13,
  lineHeight: 1.5,
  color: "var(--text-2)",
};
