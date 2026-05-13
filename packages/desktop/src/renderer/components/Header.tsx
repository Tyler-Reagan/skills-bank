import React from "react";
import type { AuthStatus } from "../../shared/ipc.js";
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
  syncing: boolean;
  onSync: () => void;
  /** When false (github-linked), the bundled-sync button is hidden. */
  showSync: boolean;
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
  showSync,
  authStatus,
  onOpenAccount,
  onOpenSettings,
  pendingUpdateVersion,
  onShowUpdate,
}: Props): React.ReactElement {
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const nextDensity: Density =
    density === "comfortable" ? "compact" : "comfortable";
  const isGithub = authStatus?.registrySource === "github";
  const accountChipLabel = isGithub
    ? `@${authStatus?.user?.login ?? "you"}`
    : "Local bundled";
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
          {showSync && (
            <button
              className="refresh-btn"
              disabled={syncing}
              title="Sync bundled skills from upstream into the registry. Skills you added are not touched. (App updates are separate — they're handled automatically and surfaced as a badge next to the logo when one is ready.)"
              aria-label={
                syncing
                  ? "Syncing bundled skills"
                  : "Sync bundled skills from upstream"
              }
              onClick={onSync}
            >
              {syncing ? (
                <>
                  <span className="spinner inline" aria-hidden="true" />{" "}
                  Syncing…
                </>
              ) : (
                <>
                  <Icon name="download" size="md" /> Sync skills
                </>
              )}
            </button>
          )}
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
                Re-scanning…
              </>
            ) : (
              <>
                <Icon name="refresh" size="md" /> Refresh
              </>
            )}
          </button>
          <button
            className="header-trigger account-trigger"
            type="button"
            onClick={onOpenAccount}
            title="Account & registry source"
            aria-label="Open Account"
          >
            {isGithub && authStatus?.user?.avatarUrl ? (
              <img
                src={authStatus.user.avatarUrl}
                alt=""
                className="header-trigger-avatar"
                referrerPolicy="no-referrer"
              />
            ) : null}
            <span className="header-trigger-label">{accountChipLabel}</span>
            <Icon name="chevron-down" size="sm" />
          </button>
          <button
            className="header-trigger settings-trigger icon-btn"
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
