import React from "react";
import type {
  AgentId,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { SkillCard, type CardStatus } from "./SkillCard.js";

interface InstalledGroup {
  name: string;
  agents: AgentId[];
  representative: InstalledSkill;
  /** Worst kind across the group; used to drive the card status. */
  kind: InstalledSkill["kind"];
}

function groupByName(installed: InstalledSkill[]): InstalledGroup[] {
  const map = new Map<string, InstalledGroup>();
  for (const i of installed) {
    const existing = map.get(i.name);
    if (existing) {
      if (!existing.agents.includes(i.agent)) existing.agents.push(i.agent);
      // Prefer "ours" → "foreign-symlink" → "real-directory" → "broken-symlink"
      // when surfacing a single status. Real-dirs and broken links are the
      // most attention-grabbing for the migration flow.
      if (existing.kind === "ours" && i.kind !== "ours") existing.kind = i.kind;
    } else {
      map.set(i.name, {
        name: i.name,
        agents: [i.agent],
        representative: i,
        kind: i.kind,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

interface Props {
  installed: InstalledSkill[];
  registry: RegistryEntry[];
  onSwitchToBrowse: () => void;
  onMigrateAll: () => void;
  onMigrateOne: (entry: InstalledSkill) => void;
  onSelectIntegrated: (entry: RegistryEntry) => void;
}

export function InstalledTab({
  installed,
  registry,
  onSwitchToBrowse,
  onMigrateAll,
  onMigrateOne,
  onSelectIntegrated,
}: Props): React.ReactElement {
  if (installed.length === 0) {
    return (
      <div className="empty-state">
        <strong>Nothing installed yet.</strong>
        <p>
          Install skills from the Browse tab, or scan for pre-existing entries.
        </p>
        <div
          style={{
            display: "flex",
            gap: 8,
            justifyContent: "center",
            marginTop: 16,
          }}
        >
          <button className="btn primary" onClick={onSwitchToBrowse}>
            Browse registry
          </button>
          <button className="btn" onClick={onMigrateAll}>
            Scan for existing skills
          </button>
        </div>
      </div>
    );
  }

  const registryByName = new Map(registry.map((e) => [e.name, e] as const));
  // Dedupe across agent dirs: a skill linked from both .claude and .cursor
  // shows once with two agent chips, not twice.
  const groups = groupByName(installed);
  const integrated = groups.filter((g) => g.kind === "ours");
  const unintegrated = groups.filter((g) => g.kind !== "ours");

  return (
    <div>
      <div className="tab-intro">
        <strong>Installed.</strong> Every entry currently under any agent's{" "}
        <code>~/.&lt;agent&gt;/skills</code> directory — including ones added by
        skills-bank and ones that came from elsewhere (manual installs, the
        skills.sh CLI, etc). Skills-bank can manage the unintegrated ones if
        you choose to migrate them. Chips on each card show which agents have
        the skill linked.
        <span className="meta-counts">
          <span>{groups.length} skill{groups.length === 1 ? "" : "s"}</span>
          <span>·</span>
          <span>{integrated.length} from registry</span>
          {unintegrated.length > 0 && (
            <>
              <span>·</span>
              <span>{unintegrated.length} not yet integrated</span>
            </>
          )}
        </span>
      </div>
      {unintegrated.length > 0 && (
        <section>
          <header className="section-header">
            <div>
              <h2>
                Not yet integrated{" "}
                <span className="count">({unintegrated.length})</span>
              </h2>
              <p>
                Live under <code>~/.claude/skills</code> but aren't managed by
                skills-bank. Click any card to migrate just that one.
              </p>
            </div>
            <button className="btn primary" onClick={onMigrateAll}>
              Migrate All
            </button>
          </header>
          <div className="skills-grid">
            {unintegrated.map((g, i) => {
              const s = g.representative;
              const entry: RegistryEntry = registryByName.get(g.name) ?? {
                name: g.name,
                description: s.target ?? s.linkPath,
                path: s.linkPath,
                source: { source: "user" },
              };
              const status: CardStatus =
                g.kind === "foreign-symlink"
                  ? { kind: "external", targetLabel: s.target ?? "" }
                  : g.kind === "real-directory"
                    ? { kind: "real-directory" }
                    : { kind: "broken-symlink" };
              return (
                <SkillCard
                  key={g.name}
                  entry={entry}
                  status={status}
                  onSelect={() => onMigrateOne(s)}
                  index={i}
                  agents={g.agents}
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
            {integrated.map((g, i) => {
              const entry = registryByName.get(g.name);
              if (!entry) return null;
              return (
                <SkillCard
                  key={g.name}
                  entry={entry}
                  status={{ kind: "installed" }}
                  onSelect={() => onSelectIntegrated(entry)}
                  index={i}
                  agents={g.agents}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
