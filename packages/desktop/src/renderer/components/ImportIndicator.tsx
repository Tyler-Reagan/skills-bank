import React from "react";
import { Icon } from "./Icon.js";

interface Props {
  importingManifest: boolean;
  onCancelImport: () => void;
}

/**
 * Persistent header-level affordance that surfaces an in-flight
 * manifest import even when AccountModal is closed. Reads as a
 * status chip (matching the `.updates-badge` visual register)
 * rather than an action button — the spinner does the motion
 * work; the trailing `×` is a one-click cancel that funnels into
 * the same cancel path as the modal's "Cancel import" button.
 *
 * Renders nothing when `importingManifest === false`, so the
 * header slot collapses to zero width between runs.
 */
export function ImportIndicator({
  importingManifest,
  onCancelImport,
}: Props): React.ReactElement | null {
  if (!importingManifest) return null;
  return (
    <div
      className="import-indicator"
      role="status"
      aria-live="polite"
      aria-label="Manifest import in progress"
    >
      <span className="spinner inline" aria-hidden="true" />
      <span>Importing manifest…</span>
      <button
        type="button"
        className="import-indicator-cancel"
        onClick={onCancelImport}
        aria-label="Cancel manifest import"
        title="Cancel manifest import"
      >
        <Icon name="x" size="sm" />
      </button>
    </div>
  );
}
