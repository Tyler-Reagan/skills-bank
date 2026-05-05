import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

interface Props {
  registry: RegistryEntry[];
  installed: InstalledSkill[];
}

export function Header({ registry, installed }: Props): React.ReactElement {
  const integratedCount = installed.filter((i) => i.kind === "ours").length;
  const warningCount = registry.reduce(
    (acc, e) => acc + (e.warnings?.length ?? 0),
    0,
  );
  return (
    <div className="header">
      <div className="header-inner">
        <div className="header-brand">
          skills<span>-</span>bank
        </div>
        <div className="header-stats">
          <div className="stat-pill">
            <strong>{registry.length}</strong> skills
          </div>
          <div className="stat-pill">
            <strong>{integratedCount}</strong> installed
          </div>
          {warningCount > 0 && (
            <div className="stat-pill" title="Skills with metadata issues">
              <strong>{warningCount}</strong> warnings
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
