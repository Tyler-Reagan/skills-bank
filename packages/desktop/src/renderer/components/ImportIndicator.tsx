import React from "react";
import { Icon } from "./Icon.js";

interface Props {
  importingManifest: boolean;
  onCancelImport: () => void;
  /**
   * Optional Tier-2 progress. When provided, the chip renders the
   * compact count `Importing N/total`. Falls back to the generic
   * `Importing manifest…` text when null — covers the brief window
   * between import start and the first progress event arriving.
   */
  progress?: { completed: number; total: number } | null;
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
 *
 * Tier-2 (v1.9): when `progress` is provided, the chip shows the
 * count instead of the generic label. Per-skill detail (currentName,
 * per-skill errors) lives in the BrowseTab "Incoming via manifest"
 * band, NOT here — the chip stays compact so it can survive any
 * tab.
 */
export function ImportIndicator({
  importingManifest,
  onCancelImport,
  progress,
}: Props): React.ReactElement | null {
  if (!importingManifest) return null;
  const label =
    progress && progress.total > 0
      ? `Importing ${progress.completed}/${progress.total}`
      : "Importing manifest…";
  return (
    <div
      className="import-indicator"
      role="status"
      aria-live="polite"
      aria-label={
        progress && progress.total > 0
          ? `Manifest import in progress: ${progress.completed} of ${progress.total}`
          : "Manifest import in progress"
      }
    >
      <span className="spinner inline" aria-hidden="true" />
      <span>{label}</span>
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
