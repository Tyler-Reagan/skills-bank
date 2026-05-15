import type { CSSProperties } from "react";

/**
 * Shared inline-CSSProperties for the scrim-and-centered-modal pattern
 * used by ConfirmDialog, DestinationPickerDialog,
 * DeleteUnregisteredConfirm, AccountModal, and SettingsModal. The
 * codebase has no global modal CSS class hierarchy — each modal
 * historically inlined these objects, drifting between zIndex values
 * and gap sizes.
 *
 * `modal()` returns a fresh object so callers can splat overrides
 * (e.g. `style={{ ...modal(560), background: 'var(--surface-hi)' }}`).
 */

export const overlay: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1100,
};

export const modal = (width = 480): CSSProperties => ({
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

export const modalFooter: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: 8,
  marginTop: 20,
};
