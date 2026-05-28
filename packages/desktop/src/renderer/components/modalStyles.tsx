import React, { useRef } from "react";
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
 * composes inside `<Modal>`; they are now CSS class-name strings.
 */

export const modalHeader = "modal-header";
export const modalFooter = "modal-footer";

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
  /** Body width in px. Defaults to 480. Maps to `.modal-body--wN` modifier. */
  width?: 480 | 520 | 540 | 560 | 600 | 640 | 720;
  /**
   * Extra class(es) for the body element (replaces old bodyStyle prop).
   * Use `.modal-body--no-scroll`, `.modal-body--flex-col`, etc.
   */
  bodyClass?: string;
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
  bodyClass,
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

  const widthClass = width && width !== 480 ? ` modal-body--w${width}` : "";
  const bodyClassName = `modal-body${widthClass}${bodyClass ? ` ${bodyClass}` : ""}`;

  return (
    <div
      className="modal-overlay"
      onClick={onClose ? () => onClose() : undefined}
      role="presentation"
    >
      <div
        ref={bodyRef}
        className={bodyClassName}
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
 * `<div className="modal-header">` adjacent to the title.
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
      className="modal-close-btn"
    >
      <Icon name="x" size="md" />
    </button>
  );
}
