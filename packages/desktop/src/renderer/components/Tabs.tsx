import React from "react";

export type TabId = "browse" | "installed";

interface Props {
  active: TabId;
  onChange: (tab: TabId) => void;
  registryCount: number;
  installedCount: number;
  refreshing: boolean;
  onRefresh: () => void;
}

export function Tabs({
  active,
  onChange,
  registryCount,
  installedCount,
  refreshing,
  onRefresh,
}: Props): React.ReactElement {
  return (
    <div className="tabs-row">
      <div
        className={`tab ${active === "browse" ? "active" : ""}`}
        onClick={() => onChange("browse")}
      >
        Browse <span className="count">({registryCount})</span>
      </div>
      <div
        className={`tab ${active === "installed" ? "active" : ""}`}
        onClick={() => onChange("installed")}
      >
        Installed <span className="count">({installedCount})</span>
      </div>
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
  );
}
