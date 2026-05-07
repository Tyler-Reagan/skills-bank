import React from "react";
import type { AuthStatus } from "../../shared/ipc.js";
import { HeaderMenu } from "./HeaderMenu.js";
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
  onChangeRegistry: () => void;
  onExportRegistry?: () => void;
  syncing: boolean;
  onSync: () => void;
  /** When false (power persona), the canonical-sync button is hidden. */
  showSync: boolean;
  authStatus: AuthStatus | null;
  onSignOut: () => Promise<void> | void;
  onOpenSettings: () => void;
  onOpenKeyboardShortcuts?: () => void;
}

export function Header({
  refreshing,
  onRefresh,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  onChangeRegistry,
  onExportRegistry,
  syncing,
  onSync,
  showSync,
  authStatus,
  onSignOut,
  onOpenSettings,
  onOpenKeyboardShortcuts,
}: Props): React.ReactElement {
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
  const nextDensity: Density =
    density === "comfortable" ? "compact" : "comfortable";
  return (
    <header className="header">
      <h1 className="visually-hidden">skills-bank</h1>
      <div className="header-inner">
        <div className="header-brand" aria-hidden="true">
          skills<span>-</span>bank
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
              title="Pull canonical updates from upstream into the registry. User-authored skills are not touched."
              aria-label={
                syncing
                  ? "Pulling canonical updates"
                  : "Pull canonical updates from upstream"
              }
              onClick={onSync}
            >
              {syncing ? (
                <>
                  <span className="spinner inline" aria-hidden="true" />{" "}
                  Pulling…
                </>
              ) : (
                <>
                  <Icon name="download" size="md" /> Pull updates
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
          <HeaderMenu
            authStatus={authStatus}
            onChangeRegistry={onChangeRegistry}
            onExportRegistry={onExportRegistry}
            onSignOut={onSignOut}
            onOpenSettings={onOpenSettings}
            {...(onOpenKeyboardShortcuts ? { onOpenKeyboardShortcuts } : {})}
          />
        </div>
      </div>
    </header>
  );
}
