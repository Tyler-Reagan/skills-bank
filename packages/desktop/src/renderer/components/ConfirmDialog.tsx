import React, { useRef, useState } from "react";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";
import { modal, modalFooter, overlay } from "./modalStyles.js";

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
  useFocusReturn();
  useEscapeToClose(onCancel, open);
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);
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
    <div style={overlay} onClick={onCancel} role="presentation">
      <div
        ref={modalRef}
        style={modal()}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
      >
        <h2 id="confirm-title" style={titleStyle}>
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
      </div>
    </div>
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
