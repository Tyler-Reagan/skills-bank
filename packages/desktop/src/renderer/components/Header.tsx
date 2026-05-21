import React from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";
import { ImportIndicator } from "./ImportIndicator.js";

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
export type RescanState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; updates: number };

/**
 * Three-phase state of the "Scan local" affordance. Mirrors the
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
  rescanState: RescanState;
  onRefresh: () => void;
  theme: Theme;
  onToggleTheme: () => void;
  density: Density;
  onToggleDensity: () => void;
  /**
   * Universal upstream-refresh action. The separate "Sync skills"
   * affordance retired — bundled-default and custom-repo users both
   * refresh against a GitHub tarball via the same diff-before-apply
   * path, falling back to `BUNDLED_REPO` when no repo is linked.
   */
  syncing: boolean;
  onSync: () => void;
  authStatus: AuthStatus | null;
  onOpenAccount: () => void;
  onOpenSettings: () => void;
  /**
   * Version string of an app update that's been detected. When non-null,
   * the badge renders next to the brand. Click invokes `onShowUpdate`.
   * The host decides what "detected" means (typically: latest update
   * status is `available` or `downloaded`, and not in the dismissed set).
   */
  pendingUpdateVersion: string | null;
  onShowUpdate: () => void;
  /**
   * Count of skills with `originUpdateAvailable === true` from the
   * latest probe. When non-zero, the header renders an aggregate
   * badge that opens the UpdatesModal. Click invokes `onShowUpdates`.
   */
  pendingSkillUpdates: number;
  onShowUpdates: () => void;
  /**
   * Invoked when the user clicks "View" in the Rescan done-state
   * after a probe surfaces N>0 updates. The host is expected to
   * switch to the Browse tab, flip the Updates chip on, and scroll
   * the grid to the top. The button stays in done-state until this
   * fires (or the user clicks Rescan again) — no auto-fade.
   */
  onViewRescanUpdates: () => void;
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
   * Three-phase state for the `Scan local` button. Click target runs
   * the local-diagnostics IPC; on done with N>0 the user clicks
   * Review to bounce to the Installed-tab "Needs attention" section.
   */
  localScanState: LocalScanState;
  onLocalScan: () => void;
  /**
   * Invoked when the user clicks "Review" on the Scan-local done-state.
   * Host bounces to Installed tab and scrolls to the diagnostics
   * section. Button stays in done-state until this fires (or the user
   * clicks Scan local again) — no auto-fade.
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
  rescanState,
  onRefresh,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  syncing,
  onSync,
  authStatus,
  onOpenAccount,
  onOpenSettings,
  pendingUpdateVersion,
  onShowUpdate,
  pendingSkillUpdates,
  onShowUpdates,
  onViewRescanUpdates,
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
  const isBundledDefault =
    !linkedRepo || linkedRepo.fullName === BUNDLED_REPO;
  const sourceChipText = isBundledDefault
    ? "Bundled"
    : linkedRepo!.fullName;

  // Brief "Pulled" done-state on syncing→idle transition. Auto-fades
  // after 1.5s so a successful pull with zero content delta still has
  // a visible "operation completed" signal — without it, the spinner
  // stops and the grid looks unchanged.
  const [pullDoneAt, setPullDoneAt] = React.useState<number | null>(null);
  const prevSyncingRef = React.useRef(syncing);
  React.useEffect(() => {
    const wasSyncing = prevSyncingRef.current;
    prevSyncingRef.current = syncing;
    if (wasSyncing && !syncing) {
      setPullDoneAt(Date.now());
      const t = setTimeout(() => setPullDoneAt(null), 1500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [syncing]);
  return (
    <header className="header">
      <h1 className="visually-hidden">skills-bank</h1>
      <div className="header-inner">
        <div className="header-left">
          <div className="header-brand" aria-hidden="true">
            skills<span>-</span>bank
          </div>
          {pendingUpdateVersion && (
            <button
              type="button"
              className="update-badge"
              onClick={onShowUpdate}
              title={`Skills Bank ${pendingUpdateVersion} is ready. Click to review and install.`}
              aria-label={`App update ${pendingUpdateVersion} available — open install dialog`}
            >
              <Icon name="download" size="sm" />
              <span>Update {pendingUpdateVersion}</span>
            </button>
          )}
          {pendingSkillUpdates > 0 && (
            <button
              type="button"
              className="updates-badge"
              onClick={onShowUpdates}
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
          {!isBundledDefault && (
            <button
              className="refresh-btn"
              disabled={syncing}
              title={`Pull the latest content from ${linkedRepo!.fullName} into your local bank. Local edits, added skills, and provenance markers are preserved via the diff-before-apply flow.`}
              aria-label={
                syncing
                  ? `Pulling from ${linkedRepo!.fullName}`
                  : pullDoneAt !== null
                    ? `Pulled from ${linkedRepo!.fullName}`
                    : `Pull from ${linkedRepo!.fullName}`
              }
              onClick={onSync}
            >
              {syncing ? (
                <>
                  <span className="spinner inline" aria-hidden="true" />{" "}
                  Pulling…
                </>
              ) : pullDoneAt !== null ? (
                <>
                  <Icon name="check" size="md" /> Pulled
                </>
              ) : (
                <>
                  <Icon name="download" size="md" /> Pull from{" "}
                  {linkedRepo!.fullName}
                </>
              )}
            </button>
          )}
          <button
            className={`refresh-btn rescan-${rescanState.phase}${
              rescanState.phase === "done" && rescanState.updates > 0
                ? " rescan-done-actionable"
                : ""
            }`}
            disabled={rescanState.phase === "working"}
            aria-busy={rescanState.phase === "working" || undefined}
            title={
              rescanState.phase === "working"
                ? "Checking each skill's authoritative GitHub Origin for newer content"
                : rescanState.phase === "done" && rescanState.updates > 0
                  ? `${rescanState.updates} update${
                      rescanState.updates === 1 ? "" : "s"
                    } available. Click to view in the registry.`
                  : "Check each skill's authoritative GitHub Origin for newer content. Surfaces available updates as chips on the cards — does not download anything. To apply an update, click the chip on the card itself."
            }
            aria-label={
              rescanState.phase === "working"
                ? "Checking for updates"
                : rescanState.phase === "done"
                  ? rescanState.updates === 0
                    ? "Up to date"
                    : `${rescanState.updates} update${rescanState.updates === 1 ? "" : "s"} available — view in registry`
                  : "Check for updates"
            }
            onClick={
              rescanState.phase === "done" && rescanState.updates > 0
                ? onViewRescanUpdates
                : onRefresh
            }
          >
            {rescanState.phase === "working" ? (
              <>
                <span className="spinner inline" aria-hidden="true" />{" "}
                Checking for updates…
              </>
            ) : rescanState.phase === "done" ? (
              rescanState.updates === 0 ? (
                <>
                  <Icon name="check" size="md" /> Up to date
                </>
              ) : (
                <>
                  <Icon name="check" size="md" />{" "}
                  {rescanState.updates === 1
                    ? "1 update"
                    : `${rescanState.updates} updates`}
                  <span className="rescan-view-cta"> · View</span>
                </>
              )
            ) : (
              <>
                <Icon name="refresh" size="md" /> Check for updates
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
                <span className="spinner inline" aria-hidden="true" />{" "}
                Scanning…
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
                <Icon name="search" size="md" /> Scan local
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
