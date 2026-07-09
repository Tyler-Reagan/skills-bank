import React from "react";
import { InfoTooltip } from "./primitives.js";
import type {
  DiagnosticCategory,
  DiagnosticItem,
  DiagnosticReport,
  InstalledSkill,
  RegistryEntry,
} from "@skills-bank/core";
import { useRegistry } from "../RegistryContext.js";
import { SkillCard, type CardStatus } from "./SkillCard.js";
import { Icon } from "./Icon.js";
import { classifyDrawerState } from "./skillState.js";
import {
  aggregateByName,
  type ClassifiedGroup,
  type InstalledGroup,
} from "./installedGrouping.js";
import { NeedsAttentionSection } from "./NeedsAttentionSection.js";

const INSTALLED_TOOLTIP =
  "Every skill linked into any agent directory on this machine — registered " +
  "in the registry or installed elsewhere.";

const REGISTER_TOOLTIP =
  "Registering moves the skill's files into your registry so the app can " +
  "manage it — cross-agent linking and labels. Its content lives under the " +
  "registry from then on; each agent directory points at the registry copy " +
  "by symlink.";

interface Props {
  onSwitchToBrowse: () => void;
  /**
   * "Register All": opens the RegistrationPlanModal — the per-row
   * disambiguation/preview surface whose own scan walks every agent dir.
   * Shown in both the empty state and the Unregistered section header;
   * when nothing is on disk the modal renders an empty list and points the
   * user at the header's Scan Local. Bulk registration always flows through
   * the modal (review-then-apply); the inline per-card Register button stays
   * the one-off path.
   */
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
   * action. Registers the single non-ours installation (the common
   * path). Foreign-symlink alternatives like Register-as-external
   * remain reachable via the drawer's secondary button.
   */
  onInlineRegister?: (group: InstalledGroup) => void;
  /**
   * M9b: inline Delete on Unregistered cards. Host opens a
   * confirmation modal that previews which files would be removed
   * (real-dirs deleted, symlinks unlinked, external targets left
   * alone) before calling the underlying delete IPC.
   */
  onInlineDelete?: (group: InstalledGroup) => void;
  /**
   * v1.9 Button C: latest local-diagnostics scan report. When non-null
   * and `items.length > 0`, renders a "From last local scan" section
   * at the top of the tab grouping items by category with per-item
   * fix actions. Parallel to the existing classifier-driven
   * Needs-attention section — both stay rendered. Null suppresses
   * the section.
   */
  diagnostics?: import("@skills-bank/core").DiagnosticReport | null;
  /**
   * Dispatch a fix action for a diagnostic item. Routing per category
   * is handled by the host (open register flow for unregistered, call
   * removeBrokenLinks for broken-symlink, call forgetMissing for
   * external/registry-missing). Host refreshes the diagnostic report
   * after the action completes.
   */
  onFixDiagnosticItem?: (
    item: import("@skills-bank/core").DiagnosticItem,
  ) => void;
}

export function InstalledTab({
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
  diagnostics,
  onFixDiagnosticItem,
}: Props): React.ReactElement {
  const { installed, registry } = useRegistry();
  const registerTooltip = REGISTER_TOOLTIP;
  if (installed.length === 0) {
    return (
      <div>
        <div className="empty-state">
          <strong>Nothing installed yet.</strong>
          <p>
            Install skills from the Registry tab, or scan for pre-existing
            entries.
          </p>
          <div className="row-wrap-center mt-16">
            <button className="btn primary" onClick={onSwitchToBrowse}>
              Browse registry
            </button>
            <button className="btn" onClick={onRegisterAll}>
              Register All
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
  const classified: ClassifiedGroup[] = groups.map((g) => {
    const registryHit = registryByName.get(g.name);
    const entry: RegistryEntry = registryHit ?? {
      name: g.name,
      description: g.representative.target ?? g.representative.linkPath,
      path: g.representative.linkPath,
      origin: { url: null },
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
              <span className="text-warn">
                {needsAttention.length} need
                {needsAttention.length === 1 ? "s" : ""} attention
              </span>
            </>
          )}
        </span>
      </div>
      {diagnostics && diagnostics.items.length > 0 && onFixDiagnosticItem && (
        <LocalScanResultsSection
          diagnostics={diagnostics}
          onFix={onFixDiagnosticItem}
        />
      )}
      {needsAttention.length > 0 && (
        <NeedsAttentionSection
          groups={needsAttention}
          onSelectIntegrated={onSelectIntegrated}
          onRegisterOne={onRegisterOne}
          onResolveConflicts={onResolveConflicts}
          onRepairBroken={onRepairBroken}
          onResolveAllConflicts={onResolveAllConflicts}
          onRepairAllBroken={onRepairAllBroken}
        />
      )}
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
                    <div className="row-center-6">
                      {onInlineRegister && (
                        <button
                          className="btn primary flex-1 inline-center-6 fw-600"
                          onClick={() => onInlineRegister(g)}
                          title="Register this skill so the app can manage it — cross-agent links and labels. Its files move into your registry; each agent directory then points at the registry copy by symlink."
                        >
                          Register
                        </button>
                      )}
                      {onInlineDelete && (
                        <button
                          className="btn danger flex-1 inline-center-6 fw-600"
                          onClick={() => onInlineDelete(g)}
                          title="Permanently delete this skill's files from this machine. Real-directory copies are removed; foreign symlinks are unlinked but their targets are left alone. Prompts for confirmation."
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

const CATEGORY_LABELS: Record<DiagnosticCategory, string> = {
  "unregistered-installs": "Unregistered installs",
  "broken-symlinks": "Broken symlinks",
  "registry-folder-missing": "Registry folder missing",
};

const CATEGORY_FIX_LABELS: Record<DiagnosticCategory, string> = {
  "unregistered-installs": "Register",
  "broken-symlinks": "Remove broken link",
  "registry-folder-missing": "Forget",
};

const CATEGORY_ORDER: DiagnosticCategory[] = [
  "unregistered-installs",
  "broken-symlinks",
  "registry-folder-missing",
];

/**
 * v1.9 Button C: surface for the latest local-diagnostics scan result.
 * Groups items by category with per-item fix actions. Parallel to the
 * existing classifier-driven Needs-attention section — both stay
 * rendered so items can appear in both without functional impact.
 */
function LocalScanResultsSection({
  diagnostics,
  onFix,
}: {
  diagnostics: DiagnosticReport;
  onFix: (item: DiagnosticItem) => void;
}): React.ReactElement {
  const grouped = new Map<DiagnosticCategory, DiagnosticItem[]>();
  for (const cat of CATEGORY_ORDER) grouped.set(cat, []);
  for (const item of diagnostics.items) {
    grouped.get(item.category)!.push(item);
  }
  const scannedAt = new Date(diagnostics.scannedAt).toLocaleTimeString();
  return (
    <section className="local-scan-results">
      <header className="section-header">
        <div>
          <h2 className="row-center-8">
            <Icon name="alert-triangle" size="sm" /> From last local scan{" "}
            <span className="count">({diagnostics.items.length})</span>
          </h2>
          <p className="text-11 text-subtle mt-4 mb-0">
            Scanned at {scannedAt}. Local-only — no network. Items grouped by
            category. Fix one at a time; the report refreshes after each action.
          </p>
        </div>
      </header>
      {CATEGORY_ORDER.filter((cat) => grouped.get(cat)!.length > 0).map(
        (cat) => {
          const items = grouped.get(cat)!;
          // Unregistered installs already get a dedicated section with
          // per-card Register/Delete actions below. Collapse this category
          // to a single summary line so the scan results stay informative
          // without duplicating every name twice on the same screen.
          if (cat === "unregistered-installs") {
            return (
              <div key={cat} className="local-scan-category">
                <h3 className="local-scan-category-title">
                  {CATEGORY_LABELS[cat]}{" "}
                  <span className="text-subtle">({items.length})</span>
                </h3>
                <p className="text-12 text-subtle mt-4 mb-0">
                  Listed individually in the Unregistered section below —
                  register or delete each from there.
                </p>
              </div>
            );
          }
          return (
            <div key={cat} className="local-scan-category">
              <h3 className="local-scan-category-title">
                {CATEGORY_LABELS[cat]}{" "}
                <span className="text-subtle">({items.length})</span>
              </h3>
              <ul className="local-scan-item-list">
                {items.map((item) => (
                  <li key={item.itemId} className="local-scan-item">
                    <span className="local-scan-item-name">
                      <strong>{item.name}</strong>{" "}
                      <span className="text-subtle">— {item.detail}</span>
                    </span>
                    <button
                      className="btn small flex-shrink-0"
                      type="button"
                      onClick={() => onFix(item)}
                    >
                      {CATEGORY_FIX_LABELS[cat]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        },
      )}
    </section>
  );
}
