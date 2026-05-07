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
  /**
   * Group-level status: "ours" if ANY installation is properly linked
   * to the registry; otherwise the most actionable straggler kind in
   * source-priority order (real-directory > foreign-symlink > broken).
   * Was previously "first-encountered, only downgrades from ours" which
   * stranded find-skills-style skills (registered + leftover real-dir
   * elsewhere) in the Not-Registered section.
   */
  kind: InstalledSkill["kind"];
  /**
   * Non-ours installations of the same skill name in agent dirs other
   * than the registry-symlink ones. Surfaced to the drawer as
   * resolvable conflicts (duplicate real-dir, stale symlink, etc.).
   */
  conflicts: InstalledSkill[];
}

function aggregateByName(installed: InstalledSkill[]): InstalledGroup[] {
  const map = new Map<string, InstalledGroup>();
  for (const i of installed) {
    const existing = map.get(i.name);
    if (!existing) {
      map.set(i.name, {
        name: i.name,
        agents: [i.agent],
        representative: i,
        kind: i.kind,
        conflicts: i.kind === "ours" ? [] : [i],
      });
      continue;
    }
    if (!existing.agents.includes(i.agent)) existing.agents.push(i.agent);

    // Upgrade group to "ours" if any entry is registry-managed —
    // surfaces the skill in the Registered section even when stragglers
    // exist elsewhere.
    if (i.kind === "ours") {
      if (existing.kind !== "ours") {
        existing.kind = "ours";
        existing.representative = i;
      }
    } else {
      existing.conflicts.push(i);
      // No upgrade. If existing already "ours", keep it. Otherwise pick
      // the more actionable kind (real-directory beats foreign-symlink
      // beats broken-symlink) so the card status reads usefully.
      if (
        existing.kind !== "ours" &&
        kindRank(i.kind) > kindRank(existing.kind)
      ) {
        existing.kind = i.kind;
        existing.representative = i;
      }
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function kindRank(k: InstalledSkill["kind"]): number {
  switch (k) {
    case "real-directory":
      return 3;
    case "foreign-symlink":
      return 2;
    case "broken-symlink":
      return 1;
    default:
      return 0;
  }
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
  const groups = aggregateByName(installed);
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
              const registryHit = registryByName.get(g.name);
              const entry: RegistryEntry = registryHit ?? {
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
                  isRegistered={registryHit !== undefined}
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
