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
  syncing: boolean;
  onSync: () => void;
  /** When false (power persona), the canonical-sync button is hidden. */
  showSync: boolean;
  authStatus: AuthStatus | null;
  onSignOut: () => Promise<void> | void;
}

export function Header({
  refreshing,
  onRefresh,
  theme,
  onToggleTheme,
  density,
  onToggleDensity,
  onChangeRegistry,
  syncing,
  onSync,
  showSync,
  authStatus,
  onSignOut,
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
              title="Pull the latest canonical skills from this repo"
              aria-label={
                syncing
                  ? "Syncing canonical skills"
                  : "Sync canonical skills from skills-bank repository"
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
            title="Re-read the registry and ~/.claude/skills from disk"
            aria-label={
              refreshing
                ? "Refreshing registry and installed skills"
                : "Refresh registry and installed skills"
            }
            onClick={onRefresh}
          >
            {refreshing ? (
              <>
                <span className="spinner inline" aria-hidden="true" />{" "}
                Refreshing…
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
            onSignOut={onSignOut}
          />
        </div>
      </div>
    </header>
  );
}
