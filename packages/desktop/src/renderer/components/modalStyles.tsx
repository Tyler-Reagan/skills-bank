import React, { useRef, type CSSProperties } from "react";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useRegisterModal } from "../ModalRegistryContext.js";
import { Icon } from "./Icon.js";

/**
 * Shared modal primitives. The `<Modal>` component owns scrim + dialog
 * body + click-outside dismiss + focus return + Escape + initial focus
 * + open-modal registration. Every centered modal in the renderer
 * should compose this rather than re-implementing the chrome — that
 * keeps regressions like the v1.11.1 click-outside class (every modal
 * had to be patched individually) structurally impossible.
 *
 * `modalHeader` and `modalFooter` are exported for body content that
 * composes inside `<Modal>`; the scrim and centered-body styles
 * (`overlay`, `modal()`, `closeBtn`) are file-private because the
 * wrapper is the only legitimate consumer.
 */

const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

const modal = (width = 480): CSSProperties => ({
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width,
  maxWidth: "90vw",
  maxHeight: "85vh",
  overflowY: "auto",
  outline: "none",
});

export const modalHeader: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  marginBottom: 4,
};

export const modalFooter: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};

const closeBtn: CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-3)",
  padding: 4,
  borderRadius: 4,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
};

interface ModalProps {
  /**
   * Dismiss handler. Fires on scrim click and Escape keypress. Pass
   * `undefined` (or omit) to make the modal undismissable — used for
   * irreversible-operation-in-flight phases (e.g. ManageLinks /
   * RegisterModal's "applying" states). Callers remain responsible
   * for any explicit X / Cancel button inside `children`.
   */
  onClose?: () => void;
  /** aria-label for the dialog body. */
  label: string;
  /** Container width in px. Defaults to 480. */
  width?: number;
  /**
   * Body style overrides spread onto the dialog div (background,
   * padding, etc.). Width passed here loses to the `width` prop —
   * use `width` for size, this for cosmetic tweaks.
   */
  bodyStyle?: CSSProperties;
  /**
   * When true, Tab + Shift+Tab cycle focus within this modal instead
   * of escaping to the page chrome. Off by default to avoid
   * silently changing focus behavior across the existing modal set;
   * opt in per-modal when the dialog has many focusable controls
   * (e.g. RepoPickerModal's repo list).
   */
  trapFocus?: boolean;
  children: React.ReactNode;
}

export function Modal({
  onClose,
  label,
  width = 480,
  bodyStyle,
  trapFocus = false,
  children,
}: ModalProps): React.ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useFocusReturn();
  useEscapeToClose(() => {
    onClose?.();
  }, onClose !== undefined);
  useInitialFocus(bodyRef);
  useFocusTrap(bodyRef, trapFocus);
  useRegisterModal();

  return (
    <div
      style={overlay}
      onClick={onClose ? () => onClose() : undefined}
      role="presentation"
    >
      <div
        ref={bodyRef}
        style={bodyStyle ? { ...modal(width), ...bodyStyle } : modal(width)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalCloseButtonProps {
  onClose: () => void;
  /** aria-label / title. Defaults to "Close". */
  label?: string;
}

/**
 * The X icon-button repeated across every modal header. Use inside a
 * `<div style={modalHeader}>` adjacent to the title.
 */
export function ModalCloseButton({
  onClose,
  label = "Close",
}: ModalCloseButtonProps): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      title={label}
      style={closeBtn}
    >
      <Icon name="x" size="md" />
    </button>
  );
}
