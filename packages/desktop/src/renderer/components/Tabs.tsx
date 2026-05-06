import React from "react";

export type TabId = "browse" | "installed";

interface Props {
  active: TabId;
  onChange: (tab: TabId) => void;
  registryCount: number;
  installedCount: number;
}

export function Tabs({
  active,
  onChange,
  registryCount,
  installedCount,
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
    </div>
  );
}
