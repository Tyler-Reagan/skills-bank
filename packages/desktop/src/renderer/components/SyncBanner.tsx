import React, { useEffect } from "react";
import { DisclosureChevron, SkillTagList } from "./primitives.js";
import type { SyncStatus } from "../../shared/ipc.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { useDisclosure } from "../hooks/useDisclosure.js";
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

type DoneStatus = Extract<SyncStatus, { kind: "done" }>;

/** Idle time before a successful sync banner self-dismisses. */
const AUTO_FADE_MS = 5000;
/** Opacity transition window once the fade starts. Matches --t-slow. */
const FADE_OUT_MS = 300;

/**
 * Slim banner above the tabs that surfaces sync state. Active state
 * (fetching/applying) shows a spinner; the most recent done/error state
 * shows result + dismiss; if no recent activity but pending conflicts
 * remain from a prior sync, show a persistent reminder. Each state is a
 * dedicated sub-component below.
 */
export function SyncBanner({
  status,
  pendingConflicts,
  onDismiss,
  onResolveConflicts,
  onResetPending,
}: Props): React.ReactElement | null {
  if (status.kind === "fetching")
    return <ActiveBanner label="Fetching latest" />;
  if (status.kind === "applying")
    return <ActiveBanner label="Applying upserts" />;
  if (status.kind === "done")
    return (
      <DoneBanner
        status={status}
        onDismiss={onDismiss}
        onResolveConflicts={onResolveConflicts}
      />
    );
  if (status.kind === "error")
    return <ErrorBanner message={status.message} onDismiss={onDismiss} />;
  // Idle and there are leftover conflicts from a previous run — nudge.
  if (pendingConflicts > 0)
    return (
      <PendingBanner
        count={pendingConflicts}
        onResolveConflicts={onResolveConflicts}
        onResetPending={onResetPending}
      />
    );
  return null;
}

function ActiveBanner({ label }: { label: string }): React.ReactElement {
  return (
    <div className="sync-banner active" role="status" aria-live="polite">
      <span className="spinner inline" aria-hidden="true" /> {label}
    </div>
  );
}

/**
 * Successful-sync banner. Self-dismisses after a few seconds (paused
 * while hovered, focused, or expanded) and can expand to list which
 * skills were updated or dropped from the source repo.
 */
function DoneBanner({
  status,
  onDismiss,
  onResolveConflicts,
}: {
  status: DoneStatus;
  onDismiss: () => void;
  onResolveConflicts: () => void;
}): React.ReactElement {
  const {
    open: expanded,
    toggle: toggleExpanded,
    close: closeExpanded,
  } = useDisclosure();

  // Collapse the detail panel when a new sync result replaces this one.
  useEffect(() => {
    closeExpanded();
  }, [status.commitSha, closeExpanded]);

  const { leaving, hoverHandlers } = useAutoDismiss({
    active: true,
    paused: expanded,
    resetKey: status.commitSha,
    onDismiss,
    delayMs: AUTO_FADE_MS,
    fadeMs: FADE_OUT_MS,
  });

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
      {...hoverHandlers}
    >
      <div className="sync-banner-row">
        <span className="sync-banner-msg">
          <Icon name="check" size="sm" /> Sync complete — {parts.join(", ")}.
        </span>
        {hasDetails && (
          <button
            className="sync-banner-toggle"
            type="button"
            aria-expanded={expanded}
            aria-controls="sync-banner-details"
            onClick={toggleExpanded}
          >
            {expanded ? "Hide" : "Details"}
            <DisclosureChevron open={expanded} />
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
        <DismissButton onDismiss={onDismiss} label="Dismiss sync result" />
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

function ErrorBanner({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}): React.ReactElement {
  return (
    <div className="sync-banner error" role="alert">
      <Icon name="alert-triangle" size="sm" /> Sync failed: {message}
      <DismissButton onDismiss={onDismiss} label="Dismiss sync error" />
    </div>
  );
}

function PendingBanner({
  count,
  onResolveConflicts,
  onResetPending,
}: {
  count: number;
  onResolveConflicts: () => void;
  onResetPending?: () => void;
}): React.ReactElement {
  return (
    <div className="sync-banner pending">
      <Icon name="alert-circle" size="sm" /> {count} sync conflict
      {count === 1 ? "" : "s"} pending resolution.
      <button
        className="sync-banner-action"
        type="button"
        onClick={onResolveConflicts}
      >
        Resolve
      </button>
      {onResetPending && (
        <button
          className="sync-banner-action sync-banner-reset"
          type="button"
          onClick={onResetPending}
          title="Discard the pending sync state. Use this if the resolve flow is stuck and you'd rather start fresh on the next Pull Updates."
        >
          Reset
        </button>
      )}
    </div>
  );
}

function DismissButton({
  onDismiss,
  label,
}: {
  onDismiss: () => void;
  label: string;
}): React.ReactElement {
  return (
    <button
      className="sync-banner-dismiss"
      type="button"
      onClick={onDismiss}
      aria-label={label}
    >
      <Icon name="x" size="sm" />
    </button>
  );
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
      <SkillTagList names={names} />
    </div>
  );
}
