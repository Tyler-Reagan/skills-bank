import React from "react";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { InfoTooltip } from "./InfoTooltip.js";
import { SkillCard, type CardStatus } from "./SkillCard.js";
import { Icon } from "./Icon.js";
import { useRegistrySource } from "../RegistrySourceContext.js";
import { classifyDrawerState } from "./skillState.js";

const INSTALLED_TOOLTIP =
  "Every skill linked into any agent directory on this machine — registered " +
  "in the registry or installed elsewhere.";

const REGISTER_TOOLTIP_LOCAL =
  "Moves files into the app's local registry. The skill becomes cross-agent " +
  "linkable and is never overwritten by Sync skills. Lives on this machine only — " +
  "use Export registry to back it up or move it to another machine.";

const REGISTER_TOOLTIP_GITHUB =
  "Moves files into your GitHub repo's skills/ directory. Commit and push " +
  "to persist across machines and share with others.";

export interface InstalledGroup {
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
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  /**
   * User-defined custom skills directories that the Installed tab
   * scans alongside the known agent dirs. Surfaced inline (not in
   * Settings) since the feature is scoped to this tab.
   */
  customSkillsDirs: string[];
  /** Open the directory picker; on confirm, append to customSkillsDirs. */
  onAddCustomSkillsDir: () => void;
  /** Remove a custom dir from the persisted list. */
  onRemoveCustomSkillsDir: (path: string) => void;
  onSwitchToBrowse: () => void;
  onRegisterAll: () => void;
  onRegisterOne: (entry: InstalledSkill) => void;
  onSelectIntegrated: (entry: RegistryEntry) => void;
  /**
   * Open the conflict-resolve modal for a group whose registered skill
   * has non-ours stragglers (real-dir duplicate, foreign symlink). Lets
   * the user resolve without drilling into the drawer first.
   */
  onResolveConflicts?: (group: InstalledGroup) => void;
  /**
   * Trigger the two-step repair-or-delete flow for broken symlinks
   * inline from the Needs-attention section.
   */
  onRepairBroken?: (group: InstalledGroup) => void;
  /**
   * Bulk-resolve every conflict group in Needs-attention by replacing
   * stragglers with symlinks to the registry copy. Broken-symlink
   * groups are skipped (they need source decisions). Host shows a
   * confirm modal listing the skills before applying.
   */
  onResolveAllConflicts?: (groups: InstalledGroup[]) => void;
  /**
   * Bulk-repair broken symlinks across multiple registered skills.
   * Receives every group whose primary action is `repair-broken`.
   * Host iterates the list, calls repairBrokenLinks per skill,
   * surfaces a progress toast, and routes any failures through
   * ErrorPanel.
   */
  onRepairAllBroken?: (groups: InstalledGroup[]) => void;
  /**
   * Inline shortcut for the Unregistered section's per-card primary
   * action. Adopts the single non-ours installation into the registry
   * (the common path). Foreign-symlink alternatives like Register-as-
   * external remain reachable via the drawer's secondary button.
   */
  onInlineRegister?: (group: InstalledGroup) => void;
  /**
   * M9b: inline Delete on Unregistered cards. Host opens a
   * confirmation modal that previews which files would be removed
   * (real-dirs deleted, symlinks unlinked, external targets left
   * alone) before calling the underlying delete IPC.
   */
  onInlineDelete?: (group: InstalledGroup) => void;
}

export function InstalledTab({
  installed,
  registry,
  customSkillsDirs,
  onAddCustomSkillsDir,
  onRemoveCustomSkillsDir,
  onSwitchToBrowse,
  onRegisterAll,
  onRegisterOne,
  onSelectIntegrated,
  onResolveConflicts,
  onRepairBroken,
  onResolveAllConflicts,
  onRepairAllBroken,
  onInlineRegister,
  onInlineDelete,
}: Props): React.ReactElement {
  const registrySource = useRegistrySource();
  const registerTooltip =
    registrySource === "github"
      ? REGISTER_TOOLTIP_GITHUB
      : REGISTER_TOOLTIP_LOCAL;
  if (installed.length === 0) {
    return (
      <div>
        <CustomSkillsDirs
          dirs={customSkillsDirs}
          onAdd={onAddCustomSkillsDir}
          onRemove={onRemoveCustomSkillsDir}
        />
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
              flexWrap: "wrap",
            }}
          >
            <button className="btn primary" onClick={onSwitchToBrowse}>
              Browse registry
            </button>
            <button className="btn" onClick={onRegisterAll}>
              Scan for existing skills
            </button>
            <button className="btn" onClick={onAddCustomSkillsDir}>
              Add a skills directory
            </button>
          </div>
        </div>
      </div>
    );
  }

  const registryByName = new Map(registry.map((e) => [e.name, e] as const));
  // Dedupe across agent dirs: a skill linked from both .claude and .cursor
  // shows once with two agent chips, not twice.
  const groups = aggregateByName(installed);
  // Drive section membership from the same classifier the cards and
  // drawer use. This guarantees that every Needs-attention card has a
  // matching inline-button case (no card can land here with a primary
  // we don't render), and the boundary between "needs attention" and
  // "not registered" matches the classifier's notion of which actions
  // resolve the issue.
  const NEEDS_ATTENTION_PRIMARIES = new Set([
    "repair-broken",
    "resolve-conflicts",
    "resolve-registration-conflicts",
  ]);
  const classified = groups.map((g) => {
    const registryHit = registryByName.get(g.name);
    const entry: RegistryEntry = registryHit ?? {
      name: g.name,
      description: g.representative.target ?? g.representative.linkPath,
      path: g.representative.linkPath,
      source: { source: "yours" },
    };
    return {
      g,
      classification: classifyDrawerState(entry, installed, !!registryHit),
      entry,
      registryHit,
    };
  });
  const needsAttention = classified.filter((c) =>
    NEEDS_ATTENTION_PRIMARIES.has(c.classification.capabilities.primary),
  );
  const integrated = classified.filter(
    (c) =>
      c.g.kind === "ours" &&
      !NEEDS_ATTENTION_PRIMARIES.has(c.classification.capabilities.primary),
  );
  const unintegrated = classified.filter(
    (c) =>
      c.g.kind !== "ours" &&
      !NEEDS_ATTENTION_PRIMARIES.has(c.classification.capabilities.primary),
  );

  return (
    <div>
      <CustomSkillsDirs
        dirs={customSkillsDirs}
        onAdd={onAddCustomSkillsDir}
        onRemove={onRemoveCustomSkillsDir}
      />
      <div className="tab-intro">
        <span className="tab-intro-heading">
          <strong>Installed</strong>
          <InfoTooltip
            text={INSTALLED_TOOLTIP}
            label="What does Installed mean?"
          />
        </span>{" "}
        Every skill currently linked into any agent directory on this machine —
        registered by this app or installed elsewhere (e.g. the skills.sh CLI).
        Chips show which agent dirs have each skill linked.
        <span className="meta-counts">
          <span>
            {groups.length} skill{groups.length === 1 ? "" : "s"}
          </span>
          <span>·</span>
          <span>{integrated.length} registered</span>
          {unintegrated.length > 0 && (
            <>
              <span>·</span>
              <span>{unintegrated.length} unregistered</span>
            </>
          )}
          {needsAttention.length > 0 && (
            <>
              <span>·</span>
              <span style={{ color: "var(--warn, var(--text-2))" }}>
                {needsAttention.length} need
                {needsAttention.length === 1 ? "s" : ""} attention
              </span>
            </>
          )}
        </span>
      </div>
      {needsAttention.length > 0 &&
        (() => {
          // Bulk-resolve only applies to registered conflicts (the
          // primary the existing ConflictResolveModal can handle). It
          // skips broken-symlink groups (need source decisions) and
          // unregistered-conflicts groups (need per-installation
          // registration choices, not per-agent replace/delete/keep).
          const bulkResolvable = needsAttention
            .filter(
              (c) =>
                c.classification.capabilities.primary === "resolve-conflicts",
            )
            .map((c) => c.g);
          const bulkRepairable = needsAttention
            .filter(
              (c) =>
                c.classification.capabilities.primary === "repair-broken",
            )
            .map((c) => c.g);
          return (
            <section>
              <header className="section-header">
                <div>
                  <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span
                      style={{
                        color: "var(--warn, #f59e0b)",
                        display: "inline-flex",
                      }}
                      aria-hidden="true"
                    >
                      <Icon name="alert-triangle" size="sm" />
                    </span>
                    Needs attention{" "}
                    <span className="count">({needsAttention.length})</span>
                  </h2>
                  <p>
                    Conflicts or broken links that block the skill from working
                    cleanly. The action button on each card resolves it inline —
                    no drawer detour.
                  </p>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  {bulkRepairable.length > 1 && onRepairAllBroken && (
                    <button
                      className="btn"
                      onClick={() => onRepairAllBroken(bulkRepairable)}
                      title={`Re-link the broken symlinks for ${bulkRepairable.length} skills in one step. If a link can't be repaired (the registry copy is gone) you'll be prompted to remove the dead links.`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Icon name="broken-link" size="sm" />
                      Fix broken link(s) ({bulkRepairable.length})
                    </button>
                  )}
                  {bulkResolvable.length > 1 && onResolveAllConflicts && (
                    <button
                      className="btn warn"
                      onClick={() => onResolveAllConflicts(bulkResolvable)}
                      title={`Replace duplicates with symlinks to Skills Bank for ${bulkResolvable.length} skills in one step.`}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Icon name="alert-triangle" size="sm" />
                      Resolve all ({bulkResolvable.length})
                    </button>
                  )}
                </div>
              </header>
              <div className="skills-grid">
                {needsAttention.map((c, i) => {
                  const { g, classification, entry, registryHit } = c;
                  const s = g.representative;
                  const status: CardStatus =
                    g.kind === "foreign-symlink"
                      ? { kind: "external", targetLabel: s.target ?? "" }
                      : g.kind === "real-directory"
                        ? { kind: "real-directory" }
                        : g.kind === "broken-symlink"
                          ? { kind: "broken-symlink" }
                          : { kind: "installed" };
                  const onCardClick = () => {
                    if (registryHit) onSelectIntegrated(registryHit);
                    else onRegisterOne(s);
                  };
                  const prim = classification.capabilities.primary;
                  let inlineLabel: string | null = null;
                  let inlineHandler: (() => void) | null = null;
                  if (prim === "repair-broken" && onRepairBroken) {
                    const n = classification.brokenCount;
                    inlineLabel = `Fix broken link${n === 1 ? "" : "s"} (${n})`;
                    inlineHandler = () => onRepairBroken(g);
                  } else if (
                    prim === "resolve-conflicts" &&
                    onResolveConflicts
                  ) {
                    const n = classification.conflictCount;
                    inlineLabel = `Resolve ${n} conflict${n === 1 ? "" : "s"}`;
                    inlineHandler = () => onResolveConflicts(g);
                  } else if (
                    prim === "resolve-registration-conflicts" &&
                    onResolveConflicts
                  ) {
                    // Multi-install unregistered: route to ConflictResolveModal
                    // in its level-pure mode (delete/keep only, no
                    // replace-with-symlink, no adopt). After resolving,
                    // the card lands in Unregistered where the separate
                    // Register step lives. App.tsx's onResolveConflicts
                    // derives the modal mode from registry membership.
                    const totalInstalls =
                      classification.conflictCount + classification.brokenCount;
                    inlineLabel = `Resolve ${totalInstalls} conflict${totalInstalls === 1 ? "" : "s"}`;
                    inlineHandler = () => onResolveConflicts(g);
                  }
                  const inlineEnabled =
                    inlineLabel !== null && inlineHandler !== null;
                  const isBroken = prim === "repair-broken";
                  return (
                    <div key={g.name} className="action-cell">
                      {inlineEnabled && inlineHandler && (
                        <button
                          className="btn warn"
                          onClick={inlineHandler}
                          title={
                            isBroken
                              ? "Try to find a usable source elsewhere; otherwise prompt to delete."
                              : `${classification.conflictCount} agent dir(s) have duplicate or stale entries — pick how to handle each.`
                          }
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            fontWeight: 600,
                          }}
                        >
                          <Icon name="alert-triangle" size="sm" />
                          {inlineLabel}
                        </button>
                      )}
                      <SkillCard
                        entry={entry}
                        status={status}
                        onSelect={onCardClick}
                        index={i}
                        agents={g.agents}
                        isRegistered={registryHit !== undefined}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })()}
      {unintegrated.length > 0 && (
        <section>
          <header className="section-header">
            <div>
              <h2 className="section-heading-with-info">
                <span>
                  Unregistered{" "}
                  <span className="count">({unintegrated.length})</span>
                </span>
                <InfoTooltip
                  text={registerTooltip}
                  label="What does registering do?"
                />
              </h2>
              <p>
                Linked into an agent directory but not yet registered. Each chip
                shows where the skill lives on disk. Click any card to manage
                just that one.
              </p>
            </div>
            <button className="btn primary" onClick={onRegisterAll}>
              Register All
            </button>
          </header>
          <div className="skills-grid">
            {unintegrated.map((c, i) => {
              const { g, entry, registryHit } = c;
              const s = g.representative;
              const status: CardStatus =
                g.kind === "foreign-symlink"
                  ? { kind: "external", targetLabel: s.target ?? "" }
                  : g.kind === "real-directory"
                    ? { kind: "real-directory" }
                    : { kind: "broken-symlink" };
              return (
                <div key={g.name} className="action-cell">
                  {(onInlineRegister || onInlineDelete) && (
                    <div
                      style={{
                        display: "flex",
                        gap: 6,
                      }}
                    >
                      {onInlineRegister && (
                        <button
                          className="btn primary"
                          onClick={() => onInlineRegister(g)}
                          title="Adopt this skill into Skills Bank. To register as external (foreign symlinks only), open the card and use the drawer."
                          style={{
                            flex: 1,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            fontWeight: 600,
                          }}
                        >
                          Register
                        </button>
                      )}
                      {onInlineDelete && (
                        <button
                          className="btn danger"
                          onClick={() => onInlineDelete(g)}
                          title="Permanently delete this skill's files from this machine. Real-directory copies are removed; foreign symlinks are unlinked but their targets are left alone. Prompts for confirmation."
                          style={{
                            flex: 1,
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: 6,
                            fontWeight: 600,
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  )}
                  <SkillCard
                    entry={entry}
                    status={status}
                    onSelect={() => onRegisterOne(s)}
                    index={i}
                    agents={g.agents}
                    isRegistered={registryHit !== undefined}
                  />
                </div>
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
            {integrated.map((c, i) => {
              const { g } = c;
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

interface CustomSkillsDirsProps {
  dirs: string[];
  onAdd: () => void;
  onRemove: (path: string) => void;
}

function CustomSkillsDirs({
  dirs,
  onAdd,
  onRemove,
}: CustomSkillsDirsProps): React.ReactElement {
  return (
    <section className="custom-skills-dirs">
      <header className="custom-skills-dirs-header">
        <span className="custom-skills-dirs-title">
          <strong>Custom directories</strong>
          <InfoTooltip
            text="Scan any folder of skill subfolders alongside the known agent dirs."
            label="What are custom directories?"
          />
        </span>
        <button className="btn" onClick={onAdd}>
          Add a skills directory
        </button>
      </header>
      {dirs.length > 0 && (
        <ul className="custom-skills-dirs-list">
          {dirs.map((dir) => (
            <li key={dir} className="custom-skills-dir-chip">
              <code title={dir}>{dir}</code>
              <button
                className="btn-icon"
                aria-label={`Remove ${dir}`}
                title={`Remove ${dir} from the scan list`}
                onClick={() => onRemove(dir)}
              >
                <Icon name="x" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
