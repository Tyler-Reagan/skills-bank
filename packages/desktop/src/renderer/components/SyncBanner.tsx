import React from "react";
import type { SyncStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

interface Props {
  status: SyncStatus;
  pendingConflicts: number;
  onDismiss: () => void;
  onResolveConflicts: () => void;
  /**
   * Stuck-state recovery: clear the pending-conflicts.json so the next
   * sync starts clean. Surfaced only when there are pending conflicts.
   */
  onResetPending?: () => void;
}

/**
 * Slim banner above the tabs that surfaces sync state. Active state
 * (fetching/applying) shows a spinner; the most recent done/error state
 * shows result + dismiss; if no recent activity but pending conflicts
 * remain from a prior sync, show a persistent reminder. M5 will turn
 * the conflict reminder into a "Resolve" link.
 */
export function SyncBanner({
  status,
  pendingConflicts,
  onDismiss,
  onResolveConflicts,
  onResetPending,
}: Props): React.ReactElement | null {
  if (status.kind === "fetching") {
    return (
      <div className="sync-banner active" role="status" aria-live="polite">
        <span className="spinner inline" aria-hidden="true" /> Fetching
        bundled skills
      </div>
    );
  }
  if (status.kind === "applying") {
    return (
      <div className="sync-banner active" role="status" aria-live="polite">
        <span className="spinner inline" aria-hidden="true" /> Applying upserts
      </div>
    );
  }
  if (status.kind === "done") {
    const parts: string[] = [];
    if (status.upserted > 0)
      parts.push(
        `${status.upserted} skill${status.upserted === 1 ? "" : "s"} updated`,
      );
    if (status.conflicts > 0)
      parts.push(
        `${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"} pending`,
      );
    if (status.orphaned > 0) parts.push(`${status.orphaned} orphaned`);
    if (parts.length === 0) parts.push("already up to date");
    return (
      <div className="sync-banner done" role="status">
        <Icon name="check" size="sm" /> Sync complete — {parts.join(", ")}.
        {status.conflicts > 0 && (
          <button
            className="sync-banner-action"
            type="button"
            onClick={onResolveConflicts}
          >
            Resolve
          </button>
        )}
        <button
          className="sync-banner-dismiss"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sync result"
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
    );
  }
  if (status.kind === "error") {
    return (
      <div className="sync-banner error" role="alert">
        <Icon name="alert-triangle" size="sm" /> Sync failed: {status.message}
        <button
          className="sync-banner-dismiss"
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss sync error"
        >
          <Icon name="x" size="sm" />
        </button>
      </div>
    );
  }
  // Idle and there are leftover conflicts from a previous run — nudge.
  if (pendingConflicts > 0) {
    return (
      <div className="sync-banner pending">
        <Icon name="alert-circle" size="sm" /> {pendingConflicts} sync conflict
        {pendingConflicts === 1 ? "" : "s"} pending resolution.
        <button
          className="sync-banner-action"
          type="button"
          onClick={onResolveConflicts}
        >
          Resolve
        </button>
        {onResetPending && (
          <button
            className="sync-banner-action"
            type="button"
            onClick={onResetPending}
            title="Discard the pending sync state. Use this if the resolve flow is stuck and you'd rather start fresh on the next Pull Updates."
            style={{ marginLeft: 4, opacity: 0.85 }}
          >
            Reset
          </button>
        )}
      </div>
    );
  }
  return null;
}
