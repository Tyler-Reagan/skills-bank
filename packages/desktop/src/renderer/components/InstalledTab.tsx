import React from "react";
import type {
  AgentId,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { InfoTooltip } from "./InfoTooltip.js";
import { SkillCard, type CardStatus } from "./SkillCard.js";

const INSTALLED_TOOLTIP =
  "Every skill linked into any agent directory on this machine — registered " +
  "in the registry or installed elsewhere.";

const REGISTER_TOOLTIP =
  "Register a skill in the registry: files move under <repo>/skills/<name>/, " +
  "the agent symlink is rewritten to the registry copy, and registry " +
  "metadata is applied.";

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
          Install skills from the Registry tab, or scan for pre-existing
          entries.
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
        <span className="tab-intro-heading">
          <strong>Installed</strong>
          <InfoTooltip
            text={INSTALLED_TOOLTIP}
            label="What does Installed mean?"
          />
        </span>{" "}
        Every skill currently linked into any agent directory on this
        machine — registered by this app or installed elsewhere (e.g. the
        skills.sh CLI). Chips show which agent dirs have each skill linked.
        <span className="meta-counts">
          <span>
            {groups.length} skill{groups.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>{integrated.length} registered</span>
          {unintegrated.length > 0 && (
            <>
              <span>·</span>
              <span>{unintegrated.length} not registered</span>
            </>
          )}
        </span>
      </div>
      {unintegrated.length > 0 && (
        <section>
          <header className="section-header">
            <div>
              <h2 className="section-heading-with-info">
                <span>
                  Not registered{" "}
                  <span className="count">({unintegrated.length})</span>
                </span>
                <InfoTooltip
                  text={REGISTER_TOOLTIP}
                  label="What does registering do?"
                />
              </h2>
              <p>
                Linked into an agent directory but not yet registered. Each
                chip shows where the skill lives on disk. Click any card to
                manage just that one.
              </p>
            </div>
            <button className="btn primary" onClick={onMigrateAll}>
              Register All
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
                Registered <span className="count">({integrated.length})</span>
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
