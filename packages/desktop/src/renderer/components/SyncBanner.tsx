import React, { useEffect, useRef, useState } from "react";
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

/** Idle time before a successful sync banner self-dismisses. */
const AUTO_FADE_MS = 5000;
/** Opacity transition window once the fade starts. Matches --t-slow. */
const FADE_OUT_MS = 300;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
  );
}

/**
 * Slim banner above the tabs that surfaces sync state. Active state
 * (fetching/applying) shows a spinner; the most recent done/error state
 * shows result + dismiss; if no recent activity but pending conflicts
 * remain from a prior sync, show a persistent reminder.
 *
 * The done state auto-fades after a few seconds (paused while the user
 * hovers, focuses within, or has the detail panel open) and can expand
 * to list which skills were affected. Error and pending states are
 * actionable, so they never auto-dismiss.
 */
export function SyncBanner({
  status,
  pendingConflicts,
  onDismiss,
  onResolveConflicts,
  onResetPending,
}: Props): React.ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const [paused, setPaused] = useState(false);
  const [leaving, setLeaving] = useState(false);

  // onDismiss is an inline arrow in the parent, so keep it in a ref to
  // avoid restarting the fade timer on every parent re-render.
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // commitSha is stable for a given done result, so it identifies "this
  // banner" without churning when the parent re-renders.
  const doneKey = status.kind === "done" ? status.commitSha : null;

  // Reset transient UI whenever a new banner appears.
  useEffect(() => {
    setExpanded(false);
    setPaused(false);
    setLeaving(false);
  }, [doneKey, status.kind]);

  // Auto-fade the done state. Paused by hover/focus/expand.
  useEffect(() => {
    if (status.kind !== "done" || paused || expanded) return;
    const timer = window.setTimeout(() => {
      if (prefersReducedMotion()) {
        onDismissRef.current();
      } else {
        setLeaving(true);
        window.setTimeout(() => onDismissRef.current(), FADE_OUT_MS);
      }
    }, AUTO_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [status.kind, doneKey, paused, expanded]);

  if (status.kind === "fetching") {
    return (
      <div className="sync-banner active" role="status" aria-live="polite">
        <span className="spinner inline" aria-hidden="true" /> Fetching latest
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
    if (status.upserted.length > 0)
      parts.push(
        `${status.upserted.length} skill${status.upserted.length === 1 ? "" : "s"} updated`,
      );
    if (status.conflicts > 0)
      parts.push(
        `${status.conflicts} conflict${status.conflicts === 1 ? "" : "s"} pending`,
      );
    // "Orphaned" in sync.ts means: local skills that carry a
    // syncedFromCommit marker but no longer appear in the upstream
    // discovery — they were deleted upstream. The system never auto-
    // deletes them locally, so the label stays informational. Names move
    // into the detail panel below; the headline keeps just the count.
    if (status.orphaned.length > 0)
      parts.push(
        `${status.orphaned.length} skill${status.orphaned.length === 1 ? "" : "s"} no longer in source repo`,
      );
    if (parts.length === 0) parts.push("already up to date");

    const hasDetails = status.upserted.length > 0 || status.orphaned.length > 0;

    return (
      <div
        className={`sync-banner done expandable${leaving ? " leaving" : ""}`}
        role="status"
        onMouseEnter={() => setPaused(true)}
        onMouseLeave={() => setPaused(false)}
        onFocusCapture={() => setPaused(true)}
        onBlurCapture={() => setPaused(false)}
      >
        <div className="sync-banner-row">
          <span className="sync-banner-msg">
            <Icon name="check" size="sm" /> Sync complete — {parts.join(", ")}.
          </span>
          {hasDetails && (
            <button
              className={`sync-banner-toggle${expanded ? " open" : ""}`}
              type="button"
              aria-expanded={expanded}
              aria-controls="sync-banner-details"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? "Hide" : "Details"}
              <Icon
                name="chevron-down"
                size="sm"
                className="sync-banner-chevron"
              />
            </button>
          )}
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
        {expanded && hasDetails && (
          <div className="sync-banner-details" id="sync-banner-details">
            {status.upserted.length > 0 && (
              <DetailGroup title="Updated" names={status.upserted} />
            )}
            {status.orphaned.length > 0 && (
              <DetailGroup
                title="No longer in source repo"
                names={status.orphaned}
              />
            )}
          </div>
        )}
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

function DetailGroup({
  title,
  names,
}: {
  title: string;
  names: string[];
}): React.ReactElement {
  return (
    <div className="sync-banner-detail-group">
      <span className="sync-banner-detail-title">
        {title} ({names.length})
      </span>
      <div className="sync-banner-detail-names">
        {names.map((name) => (
          <span key={name} className="skill-tag">
            {name}
          </span>
        ))}
      </div>
    </div>
  );
}
