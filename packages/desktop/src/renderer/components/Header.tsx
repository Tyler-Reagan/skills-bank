import React from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";

/**
 * Three-phase state of the Rescan affordance. Drives a single button
 * through both the synchronous rebuild and the async upstream probe
 * so the user has unbroken feedback for the entire "did anything
 * change?" cycle.
 *
 *   - `idle`     ↻ Rescan
 *   - `working`  ◐ Checking upstream…
 *   - `done`     ✓ Up to date  /  ✓ N updates found
 *
 * Boot probes and the 6h periodic probe never set this — the renderer
 * gates with a local `userTriggeredProbe` flag so background syncs
 * stay silent.
 */
export type RescanState =
  | { phase: "idle" }
  | { phase: "working" }
  | { phase: "done"; updates: number };

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
   * Count of skills with `upstreamUpdateAvailable === true` from the
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
  const syncTarget = isBundledDefault ? BUNDLED_REPO : linkedRepo!.fullName;
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
          <button
            className="refresh-btn"
            disabled={syncing}
            title={`Refresh registry contents from ${syncTarget}. Your local edits and added skills are preserved through the diff-before-apply flow.`}
            aria-label={
              syncing
                ? `Refreshing from ${syncTarget}`
                : `Refresh from ${syncTarget}`
            }
            onClick={onSync}
          >
            {syncing ? (
              <>
                <span className="spinner inline" aria-hidden="true" />{" "}
                Refreshing
              </>
            ) : (
              <>
                <Icon name="download" size="md" /> Refresh from{" "}
                {isBundledDefault ? "bank" : linkedRepo!.fullName}
              </>
            )}
          </button>
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
                ? "Checking Origins for updates"
                : rescanState.phase === "done" && rescanState.updates > 0
                  ? `${rescanState.updates} update${
                      rescanState.updates === 1 ? "" : "s"
                    } found. Click to view in the registry.`
                  : "Re-scan the registry, agent directories, and probe Origins for updates"
            }
            aria-label={
              rescanState.phase === "working"
                ? "Checking Origins for updates"
                : rescanState.phase === "done"
                  ? rescanState.updates === 0
                    ? "Up to date"
                    : `${rescanState.updates} update${rescanState.updates === 1 ? "" : "s"} found — view in registry`
                  : "Rescan registry and check for Origin updates"
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
                Checking Origins…
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
                    ? "1 update found"
                    : `${rescanState.updates} updates found`}
                  <span className="rescan-view-cta"> · View</span>
                </>
              )
            ) : (
              <>
                <Icon name="refresh" size="md" /> Rescan
              </>
            )}
          </button>
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
