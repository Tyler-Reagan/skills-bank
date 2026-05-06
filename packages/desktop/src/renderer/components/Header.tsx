import React from "react";

interface Props {
  refreshing: boolean;
  onRefresh: () => void;
}

export function Header({ refreshing, onRefresh }: Props): React.ReactElement {
  return (
    <div className="header">
      <div className="header-inner">
        <div className="header-brand">
          skills<span>-</span>bank
        </div>
        <div className="header-stats">
          <button
            className="refresh-btn"
            disabled={refreshing}
            title="Re-read registry and ~/.claude/skills"
            onClick={onRefresh}
          >
            {refreshing ? (
              <>
                <span className="spinner inline" /> Refreshing…
              </>
            ) : (
              "↻ Refresh"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
