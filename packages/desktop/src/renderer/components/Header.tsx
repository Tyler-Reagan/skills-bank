import React from "react";
import type { AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";

/**
 * Three-phase state of the "Check for updates" affordance. Drives a
 * single button through both the synchronous rebuild and the async
 * upstream probe so the user has unbroken feedback for the entire
 * "did anything change?" cycle.
 *
 *   - `idle`     ↻ Check for updates
 *   - `working`  ◐ Checking for updates…
 *   - `done`     ✓ Up to date  /  ✓ N updates · View
 *
 * Boot probes and the 6h periodic probe never set this — the renderer
 * gates with a local `userTriggeredProbe` flag so background probes
 * stay silent.
 */
export type OriginProbeState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; updates: number };

/**
 * Three-phase state of the "Scan Local" affordance. Mirrors the
 * Check-for-updates state machine but for the local-disk diagnostics
 * pass (unregistered installs, broken symlinks, missing-files heal
 * states). Local-only — no network.
 *
 *   - `idle`     ↻ Scan local
 *   - `working`  ◐ Scanning…
 *   - `done`     ✓ All clean  /  ✓ N items · Review
 */
export type LocalScanState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; count: number };

interface Props {
  originProbeState: OriginProbeState;
  onCheckSkillUpdates: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onToggleDensity: () => void;
  /**
   * Import from the Linked Repo: re-fetch its manifest and reconcile
   * the local Registry to match (the blunt path — a replace, not the
   * three-way merge behind Account → Import manifest). Hidden when on
   * the bundled default (no repo linked).
   */
  importingLinkedRepo: boolean;
  onImportLinkedRepo: () => void;
  authStatus: AuthStatus | null;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  /**
   * Version string of an app update that's been detected. When non-null,
   * the badge renders next to the brand. Click invokes `onShowAppUpdate`.
   * The host decides what "detected" means (typically: latest update
   * status is `available` or `downloaded`, and not in the dismissed set).
   */
  pendingAppUpdateVersion: string | null;
  onShowAppUpdate: () => void;
  /**
   * Count of skills with `skillUpdateAvailable === true` from the
   * latest probe. When non-zero, the header renders an aggregate
   * badge that opens the SkillUpdatesModal. Click invokes `onShowSkillUpdates`.
   */
  pendingSkillUpdates: number;
  onShowSkillUpdates: () => void;
  /**
   * Invoked when the user clicks "View" in the done-state after a
   * probe surfaces N>0 updates. The host is expected to switch to
   * the Browse tab, flip the Updates chip on, and scroll the grid to
   * the top. The button stays in done-state until this fires (or the
   * user clicks "Check for skill updates" again) — no auto-fade.
   */
  onViewSkillUpdates: () => void;
  /**
   * True while a manifest import is in flight (initiated from
   * AccountModal but tracked at App.tsx so the indicator survives
   * modal close). Drives the persistent `<ImportIndicator />` chip
   * in the header action cluster.
   */
  importingManifest: boolean;
  /**
   * Cancels the in-flight manifest import. Same callback the modal's
   * "Cancel import" button uses — both funnel into the v1.7.0 cancel
   * IPC.
   */
  onCancelImport: () => void;
  /**
   * Three-phase state for the `Scan Local` button. Click target runs
   * the local-diagnostics IPC; on done with N>0 the user clicks
   * Review to bounce to the Installed-tab "Needs attention" section.
   */
  localScanState: LocalScanState;
  onLocalScan: () => void;
  /**
   * Invoked when the user clicks "Review" on the Scan Local done-state.
   * Host bounces to Installed tab and scrolls to the diagnostics
   * section. Button stays in done-state until this fires (or the user
   * clicks Scan Local again) — no auto-fade.
   */
  onViewLocalScan: () => void;
  /**
   * Tier-2 (v1.9): per-skill progress count for the in-flight manifest
   * import. Passes through to the `<ImportIndicator />` chip so it
   * renders `Importing N/total` instead of the generic
   * `Importing manifest…`. Null/undefined during the brief window
   * before the first progress event arrives.
   */
  manifestImportProgress?: { completed: number; total: number } | null;
}

export function Header({
  originProbeState,
  onCheckSkillUpdates,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  importingLinkedRepo,
  onImportLinkedRepo,
  authStatus,
  onOpenAccount,
  onOpenSettings,
  pendingAppUpdateVersion,
  onShowAppUpdate,
  pendingSkillUpdates,
  onShowSkillUpdates,
  onViewSkillUpdates,
  importingManifest,
  onCancelImport,
  localScanState,
  onLocalScan,
  onViewLocalScan,
  manifestImportProgress,
}: Props): React.ReactElement {
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const nextDensity: Density =
    density === "comfortable" ? "compact" : "comfortable";
  const linkedRepo = authStatus?.linkedRepo ?? null;
  const sourceChipText = linkedRepo ? linkedRepo.fullName : "Not linked";

  // Brief "Imported" done-state on importingLinkedRepo→idle transition.
  // Auto-fades after 1.5s so a successful import with zero content delta
  // still has a visible "operation completed" signal — without it, the
  // spinner stops and the grid looks unchanged.
  const [importDoneAt, setImportDoneAt] = React.useState<number | null>(null);
  const prevImportingRef = React.useRef(importingLinkedRepo);
  React.useEffect(() => {
    const wasImporting = prevImportingRef.current;
    prevImportingRef.current = importingLinkedRepo;
    if (wasImporting && !importingLinkedRepo) {
      setImportDoneAt(Date.now());
      const t = setTimeout(() => setImportDoneAt(null), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [importingLinkedRepo]);
  return (
    <header className="header">
      <h1 className="visually-hidden">skills-bank</h1>
      <div className="header-inner">
        <div className="header-left">
          <div className="header-brand" aria-hidden="true">
            skills<span>-</span>bank
          </div>
          {pendingAppUpdateVersion && (
            <button
              type="button"
              className="update-badge"
              onClick={onShowAppUpdate}
              title={`Skills Bank ${pendingAppUpdateVersion} is ready. Click to review and install.`}
              aria-label={`App update ${pendingAppUpdateVersion} available — open install dialog`}
            >
              <Icon name="download" size="sm" />
              <span>Update {pendingAppUpdateVersion}</span>
            </button>
          )}
          {pendingSkillUpdates > 0 && (
            <button
              type="button"
              className="updates-badge"
              onClick={onShowSkillUpdates}
              title={`${pendingSkillUpdates} skill${
                pendingSkillUpdates === 1 ? "" : "s"
              } can be updated from Origin. Click to review.`}
              aria-label={`${pendingSkillUpdates} skill Origin updates available — open updates modal`}
            >
              <Icon name="refresh" size="sm" />
              <span>
                {pendingSkillUpdates} update
                {pendingSkillUpdates === 1 ? "" : "s"}
              </span>
            </button>
          )}
        </div>
        <div className="header-stats">
          <button
            className="icon-btn"
            type="button"
            onClick={onToggleDensity}
            aria-label={`Switch to ${nextDensity} card density`}
            title={`Switch to ${nextDensity} card density`}
          >
            <Icon
              name={
                density === "comfortable"
                  ? "density-compact"
                  : "density-comfortable"
              }
              size="md"
            />
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={onToggleTheme}
            aria-label={`Switch to ${nextTheme} mode`}
            title={`Switch to ${nextTheme} mode`}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size="md" />
          </button>
          {linkedRepo && (
            <button
              className="refresh-btn"
              disabled={importingLinkedRepo}
              title={`Import from ${linkedRepo!.fullName}: re-fetch its manifest and reconcile the local bank to match. This is a replace, not a merge — for a 3-way merge that preserves local edits, use Account → Import manifest.`}
              aria-label={
                importingLinkedRepo
                  ? `Importing from ${linkedRepo!.fullName}`
                  : importDoneAt !== null
                    ? `Imported from ${linkedRepo!.fullName}`
                    : `Import from ${linkedRepo!.fullName}`
              }
              onClick={onImportLinkedRepo}
            >
              {importingLinkedRepo ? (
                <>
                  <span className="spinner inline" aria-hidden="true" />{" "}
                  Importing…
                </>
              ) : importDoneAt !== null ? (
                <>
                  <Icon name="check" size="md" /> Imported
                </>
              ) : (
                <>
                  <Icon name="download" size="md" /> Import from{" "}
                  {linkedRepo!.fullName}
                </>
              )}
            </button>
          )}
          <button
            className={`refresh-btn origin-probe-${originProbeState.phase}${
              originProbeState.phase === "done" && originProbeState.updates > 0
                ? " origin-probe-done-actionable"
                : ""
            }`}
            disabled={originProbeState.phase === "working"}
            aria-busy={originProbeState.phase === "working" || undefined}
            title={
              originProbeState.phase === "working"
                ? "Checking each skill's authoritative GitHub Origin for newer content"
                : originProbeState.phase === "done" &&
                    originProbeState.updates > 0
                  ? `${originProbeState.updates} update${
                      originProbeState.updates === 1 ? "" : "s"
                    } available. Click to view in the registry.`
                  : "Check each skill's authoritative GitHub Origin for newer content. Surfaces available updates as chips on the cards — does not download anything. To apply an update, click the chip on the card itself."
            }
            aria-label={
              originProbeState.phase === "working"
                ? "Checking for skill updates"
                : originProbeState.phase === "done"
                  ? originProbeState.updates === 0
                    ? "Up to date"
                    : `${originProbeState.updates} update${originProbeState.updates === 1 ? "" : "s"} available — view in registry`
                  : "Check for skill updates"
            }
            onClick={
              originProbeState.phase === "done" && originProbeState.updates > 0
                ? onViewSkillUpdates
                : onCheckSkillUpdates
            }
          >
            {originProbeState.phase === "working" ? (
              <>
                <span className="spinner inline" aria-hidden="true" /> Checking
                for skill updates…
              </>
            ) : originProbeState.phase === "done" ? (
              originProbeState.updates === 0 ? (
                <>
                  <Icon name="check" size="md" /> Up to date
                </>
              ) : (
                <>
                  <Icon name="check" size="md" />{" "}
                  {originProbeState.updates === 1
                    ? "1 update"
                    : `${originProbeState.updates} updates`}
                  <span className="rescan-view-cta"> · View</span>
                </>
              )
            ) : (
              <>
                <Icon name="refresh" size="md" /> Check for skill updates
              </>
            )}
          </button>
          <button
            className={`refresh-btn local-scan-${localScanState.phase}${
              localScanState.phase === "done" && localScanState.count > 0
                ? " local-scan-done-actionable"
                : ""
            }`}
            disabled={localScanState.phase === "working"}
            aria-busy={localScanState.phase === "working" || undefined}
            title={
              localScanState.phase === "working"
                ? "Scanning agent directories and registry for items needing attention"
                : localScanState.phase === "done" && localScanState.count > 0
                  ? `${localScanState.count} item${
                      localScanState.count === 1 ? "" : "s"
                    } need attention. Click to review.`
                  : "Walk your agent directories and registry for items needing attention: unregistered installs, broken symlinks, missing files. Local-only — no network."
            }
            aria-label={
              localScanState.phase === "working"
                ? "Scanning local disk"
                : localScanState.phase === "done"
                  ? localScanState.count === 0
                    ? "All clean"
                    : `${localScanState.count} item${
                        localScanState.count === 1 ? "" : "s"
                      } need attention — review on Installed tab`
                  : "Scan local disk for items needing attention"
            }
            onClick={
              localScanState.phase === "done" && localScanState.count > 0
                ? onViewLocalScan
                : onLocalScan
            }
          >
            {localScanState.phase === "working" ? (
              <>
                <span className="spinner inline" aria-hidden="true" /> Scanning…
              </>
            ) : localScanState.phase === "done" ? (
              localScanState.count === 0 ? (
                <>
                  <Icon name="check" size="md" /> All clean
                </>
              ) : (
                <>
                  <Icon name="check" size="md" />{" "}
                  {localScanState.count === 1
                    ? "1 item"
                    : `${localScanState.count} items`}
                  <span className="rescan-view-cta"> · Review</span>
                </>
              )
            ) : (
              <>
                <Icon name="search" size="md" /> Scan Local
              </>
            )}
          </button>
          <ImportIndicator
            importingManifest={importingManifest}
            onCancelImport={onCancelImport}
            progress={manifestImportProgress ?? null}
          />
          <button
            className="header-trigger account-trigger"
            type="button"
            onClick={onOpenAccount}
            title={`Account · ${sourceChipText}`}
            aria-label={`Open Account (${sourceChipText})`}
          >
            {authStatus?.user?.avatarUrl ? (
              <img
                src={`${authStatus.user.avatarUrl}${authStatus.user.avatarUrl.includes("?") ? "&" : "?"}s=64`}
                alt=""
                width={18}
                height={18}
                className="header-trigger-avatar"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span className="header-trigger-label">Account</span>
            <span className="header-trigger-source-chip">{sourceChipText}</span>
          </button>
          <button
            className="icon-btn"
            type="button"
            onClick={onOpenSettings}
            title="Settings"
            aria-label="Open Settings"
          >
            <Icon name="settings" size="md" />
          </button>
        </div>
      </div>
    </header>
  );
}

// ─── ImportIndicator (internal) ──────────────────────────────────────
// Folded in from its own file: header-only status chip, single parent.

interface ImportIndicatorProps {
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
function ImportIndicator({
  importingManifest,
  onCancelImport,
  progress,
}: ImportIndicatorProps): React.ReactElement | null {
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
