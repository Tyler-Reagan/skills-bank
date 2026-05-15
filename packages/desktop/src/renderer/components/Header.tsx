import React from "react";
import { BUNDLED_REPO, type AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

export type Theme = "dark" | "light";
export type Density = "comfortable" | "compact";

interface Props {
  refreshing: boolean;
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
}

export function Header({
  refreshing,
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
            className="refresh-btn"
            disabled={refreshing}
            title="Re-scan the registry and every agent directory from disk. No network."
            aria-label={
              refreshing
                ? "Re-scanning registry and agent directories"
                : "Re-scan registry and agent directories"
            }
            onClick={onRefresh}
          >
            {refreshing ? (
              <>
                <span className="spinner inline" aria-hidden="true" />{" "}
                Re-scanning
              </>
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
                src={authStatus.user.avatarUrl}
                alt=""
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
