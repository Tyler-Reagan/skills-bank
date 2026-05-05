import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { SkillCard, type CardStatus } from "./SkillCard.js";

interface Props {
  installed: InstalledSkill[];
  registry: RegistryEntry[];
  onSwitchToBrowse: () => void;
  onScanForExisting: () => void;
  onSelect: (entry: RegistryEntry) => void;
}

export function InstalledTab({
  installed,
  registry,
  onSwitchToBrowse,
  onScanForExisting,
  onSelect,
}: Props): React.ReactElement {
  if (installed.length === 0) {
    return (
      <div className="empty-state">
        <strong>Nothing installed yet.</strong>
        <p>Install skills from the Browse tab, or scan for pre-existing entries.</p>
        <div style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16 }}>
          <button className="btn primary" onClick={onSwitchToBrowse}>
            Browse registry
          </button>
          <button className="btn" onClick={onScanForExisting}>
            Scan for existing skills
          </button>
        </div>
      </div>
    );
  }

  const registryByName = new Map(registry.map((e) => [e.name, e] as const));
  const integrated: InstalledSkill[] = installed.filter((s) => s.kind === "ours");
  const unintegrated: InstalledSkill[] = installed.filter((s) => s.kind !== "ours");

  return (
    <div>
      {unintegrated.length > 0 && (
        <section>
          <header className="section-header">
            <div>
              <h2>
                Not yet integrated <span className="count">({unintegrated.length})</span>
              </h2>
              <p>
                Live under <code>~/.claude/skills</code> but aren't managed by skills-bank.
              </p>
            </div>
            <button className="btn primary" onClick={onScanForExisting}>
              Migrate all…
            </button>
          </header>
          <div className="skills-grid">
            {unintegrated.map((s, i) => {
              const entry: RegistryEntry = registryByName.get(s.name) ?? {
                name: s.name,
                description: s.target ?? s.linkPath,
                category: "—",
                path: s.linkPath,
              };
              const status: CardStatus =
                s.kind === "foreign-symlink"
                  ? { kind: "external", targetLabel: s.target ?? "" }
                  : s.kind === "real-directory"
                    ? { kind: "real-directory" }
                    : { kind: "broken-symlink" };
              return (
                <SkillCard
                  key={s.name}
                  entry={entry}
                  status={status}
                  onSelect={onScanForExisting}
                  index={i}
                />
              );
            })}
          </div>
        </section>
      )}

      {integrated.length > 0 && (
        <section>
          <header className="section-header">
            <div>
              <h2>
                Integrated <span className="count">({integrated.length})</span>
              </h2>
              <p>Symlinked into the skills-bank registry.</p>
            </div>
          </header>
          <div className="skills-grid">
            {integrated.map((s, i) => {
              const entry = registryByName.get(s.name);
              if (!entry) return null;
              return (
                <SkillCard
                  key={s.name}
                  entry={entry}
                  status={{ kind: "installed" }}
                  onSelect={() => onSelect(entry)}
                  index={i}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
