import React from "react";
import { Icon } from "./Icon.js";

interface Props {
  refreshing: boolean;
  onRefresh: () => void;
}

export function Header({ refreshing, onRefresh }: Props): React.ReactElement {
  return (
    <header className="header">
      <h1 className="visually-hidden">skills-bank</h1>
      <div className="header-inner">
        <div className="header-brand" aria-hidden="true">
          skills<span>-</span>bank
        </div>
        <div className="header-stats">
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
