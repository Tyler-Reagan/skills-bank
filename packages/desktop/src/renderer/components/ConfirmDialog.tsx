import React, { useEffect, useRef, useState } from "react";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { Icon } from "./Icon.js";

interface Props {
  open: boolean;
  title: string;
  /** Body text. Plain string for short prompts; ReactNode for richer layouts. */
  body: React.ReactNode;
  /** Defaults to "Cancel". */
  cancelLabel?: string;
  confirmLabel: string;
  /** When true, the confirm button is rendered in the danger family. */
  destructive?: boolean;
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
  destructive = false,
  onCancel,
  onConfirm,
}: Props): React.ReactElement | null {
  useFocusReturn();
  const modalRef = useRef<HTMLDivElement | null>(null);
  useInitialFocus(modalRef);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.code === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () =>
      document.removeEventListener("keydown", onKey, { capture: true });
  }, [onCancel, open]);

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
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        tabIndex={-1}
      >
        <h2 id="confirm-title" style={titleStyle}>
          {destructive && (
            <span style={iconWrap} aria-hidden="true">
              <Icon name="alert-triangle" size="md" />
            </span>
          )}
          {title}
        </h2>
        <div style={bodyStyle}>{body}</div>
        <div style={footer}>
          <button
            className="btn"
            type="button"
            onClick={onCancel}
            disabled={submitting}
          >
            {cancelLabel}
          </button>
          <button
            className={destructive ? "btn danger" : "btn primary"}
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

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const modal: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width: 480,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  outline: "none",
};

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

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};
