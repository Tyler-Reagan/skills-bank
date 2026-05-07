import React from "react";

export type TabId = "browse" | "installed" | "discover";

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
  const tabs: Array<{ id: TabId; label: string; count?: number }> = [
    { id: "browse", label: "Registry", count: registryCount },
    { id: "installed", label: "Installed", count: installedCount },
    { id: "discover", label: "Discover" },
  ];

  const onTabKeyDown = (e: React.KeyboardEvent, currentIdx: number) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const dir = e.key === "ArrowRight" ? 1 : -1;
      const next = (currentIdx + dir + tabs.length) % tabs.length;
      onChange(tabs[next]!.id);
      // Move keyboard focus to the new tab.
      const buttons = (e.currentTarget.parentElement?.querySelectorAll(
        "[role=tab]",
      ) ?? []) as NodeListOf<HTMLButtonElement>;
      buttons[next]?.focus();
    }
  };

  return (
    <div className="tabs-row" role="tablist" aria-label="Skills views">
      {tabs.map((t, idx) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`tabpanel-${t.id}`}
            id={`tab-${t.id}`}
            tabIndex={isActive ? 0 : -1}
            className={`tab ${isActive ? "active" : ""}`}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onTabKeyDown(e, idx)}
          >
            {t.label}
            {typeof t.count === "number" && (
              <>
                {" "}
                <span className="count tabular-nums">({t.count})</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
