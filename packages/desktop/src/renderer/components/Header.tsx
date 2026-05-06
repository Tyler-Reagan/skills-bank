import React from "react";
import { Icon } from "./Icon.js";

export type Theme = "dark" | "light";

interface Props {
  refreshing: boolean;
  onRefresh: () => void;
  theme: Theme;
  onToggleTheme: () => void;
}

export function Header({
  refreshing,
  onRefresh,
  theme,
  onToggleTheme,
}: Props): React.ReactElement {
  const nextTheme: Theme = theme === "dark" ? "light" : "dark";
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
            onClick={onToggleTheme}
            aria-label={`Switch to ${nextTheme} mode`}
            title={`Switch to ${nextTheme} mode`}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size="md" />
          </button>
          <button
            className="refresh-btn"
            disabled={refreshing}
            title="Re-read registry and ~/.claude/skills"
            aria-label={
              refreshing
                ? "Refreshing registry and installed skills"
                : "Refresh registry and installed skills"
            }
            onClick={onRefresh}
          >
            {refreshing ? (
              <>
                <span className="spinner inline" aria-hidden="true" /> Refreshing…
              </>
            ) : (
              <>
                <Icon name="refresh" size="md" /> Refresh
              </>
            )}
          </button>
        </div>
      </div>
    </header>
  );
}
