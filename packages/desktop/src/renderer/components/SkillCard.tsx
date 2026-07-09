import React, { useState } from "react";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { isGithubUrl, parseOwnerRepo } from "@skills-bank/core/origin-url";
import { AGENT_LABELS, AGENT_PATHS } from "../agentDisplay.js";
import { Icon } from "./Icon.js";

function freshness(lastCommit: RegistryEntry["lastCommit"]): {
  label: string;
  color: string;
} {
  if (!lastCommit?.date) return { label: "no history", color: "var(--stale)" };
  const days = (Date.now() - new Date(lastCommit.date).getTime()) / 86_400_000;
  const label = days < 1 ? "today" : `${Math.floor(days)}d ago`;
  if (days < 30) return { label, color: "var(--fresh)" };
  if (days < 90) return { label, color: "var(--aging)" };
  return { label, color: "var(--stale)" };
}

export type CardStatus =
  | { kind: "uninstalled" }
  | { kind: "installed" }
  | { kind: "external"; targetLabel: string }
  | { kind: "real-directory" }
  | { kind: "broken-symlink" };

interface Props {
  entry: RegistryEntry;
  status: CardStatus;
  onSelect: () => void;
  index?: number;
  /** Agents this skill is currently installed for. Used to render chips. */
  agents?: AgentId[];
  /**
   * Save a tag list directly from the card (quick X + quick add).
   * When omitted, tags render as plain chips with no inline edit
   * affordance — caller can still edit via the detail drawer.
   */
  onSaveTags?: (next: string[]) => Promise<void> | void;
  /**
   * Bulk-install mode props. When `selectMode` is true the card
   * renders a leading checkbox and a click on the card body toggles
   * selection instead of opening the detail drawer. `disableSelect`
   * is set for skills that are already installed for every
   * applicable agent — the checkbox renders but is non-interactive
   * so the user can see which cards bulk-install would skip.
   * `bulkInstallStatus` annotates the card during a bulk-install
   * run (pending → installing → installed/failed); presentation is
   * a thin chip beside the status chip.
   */
  selectMode?: boolean;
  selected?: boolean;
  disableSelect?: boolean;
  onToggleSelect?: () => void;
  bulkInstallStatus?: "pending" | "installing" | "installed" | "failed";
}

export function SkillCard({
  entry,
  status,
  onSelect,
  index = 0,
  agents,
  onSaveTags,
  selectMode = false,
  selected = false,
  disableSelect = false,
  onToggleSelect,
  bulkInstallStatus,
}: Props): React.ReactElement {
  const fresh = freshness(entry.lastCommit);
  const visibleTags = (entry.tags ?? []).slice(0, 3);
  const hidden = (entry.tags?.length ?? 0) - visibleTags.length;
  const [adding, setAdding] = useState(false);
  const [addInput, setAddInput] = useState("");

  const removeTag = async (tag: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!onSaveTags) return;
    const current = entry.tags ?? [];
    await onSaveTags(current.filter((t) => t !== tag));
  };

  const submitAdd = async (e: React.FormEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onSaveTags) return;
    const t = addInput.trim();
    if (!t || t.length > 64) {
      setAdding(false);
      setAddInput("");
      return;
    }
    const current = entry.tags ?? [];
    if (current.includes(t)) {
      setAdding(false);
      setAddInput("");
      return;
    }
    await onSaveTags([...current, t]);
    setAdding(false);
    setAddInput("");
  };

  const handleCardClick = () => {
    if (selectMode) {
      if (!disableSelect && onToggleSelect) onToggleSelect();
      return;
    }
    onSelect();
  };
  return (
    <div
      className={`skill-card${entry.skillUpdateAvailable ? " skill-card--update-available" : ""}${selectMode && selected ? " skill-card--selected" : ""}`}
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      aria-label={ariaLabelFor(entry, status)}
      aria-pressed={selectMode ? selected : undefined}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleCardClick();
        }
      }}
    >
      <div className="skill-card-top">
        {selectMode && (
          <input
            type="checkbox"
            checked={selected}
            disabled={disableSelect}
            onChange={onToggleSelect}
            onClick={(e) => e.stopPropagation()}
            aria-label={
              disableSelect
                ? `${entry.name} (already installed)`
                : selected
                  ? `Deselect ${entry.name}`
                  : `Select ${entry.name} for bulk install`
            }
            className="mr-8"
          />
        )}
        <p className="skill-name flex-1-min0 mb-0">{entry.name}</p>
        {bulkInstallStatus && (
          <span
            className={`skill-status-chip text-11${bulkInstallStatus === "failed" ? " text-danger" : bulkInstallStatus === "installed" ? " text-accent" : " text-muted"}`}
            title={`Bulk install: ${bulkInstallStatus}`}
          >
            {bulkInstallStatus === "installing"
              ? "▸"
              : bulkInstallStatus === "installed"
                ? "✓"
                : bulkInstallStatus === "failed"
                  ? "✕"
                  : "•"}
          </span>
        )}
        <StateBadge entry={entry} />
        <StatusChip status={status} warnings={entry.warnings?.length ?? 0} />
      </div>

      {entry.description ? (
        <p className="skill-description">{entry.description}</p>
      ) : (
        <p className="skill-description text-subtle italic">(no description)</p>
      )}

      {(visibleTags.length > 0 || onSaveTags) && (
        <div className="skill-tags">
          {visibleTags.map((t) => (
            <span
              key={t}
              className={`skill-tag${onSaveTags ? " interactive" : ""}`}
            >
              #{t}
              {onSaveTags && (
                <button
                  type="button"
                  className="skill-tag-x"
                  aria-label={`Remove tag ${t}`}
                  onClick={(e) => void removeTag(t, e)}
                  onKeyDown={(e) => e.stopPropagation()}
                  title={`Remove tag ${t}`}
                >
                  <Icon name="x" size="sm" />
                </button>
              )}
            </span>
          ))}
          {hidden > 0 && (
            <span
              className="skill-tag-more"
              title={`${hidden} more tag${hidden === 1 ? "" : "s"}`}
              aria-label={`${hidden} more tag${hidden === 1 ? "" : "s"}`}
            >
              +{hidden}
            </span>
          )}
          {onSaveTags && !adding && (
            <button
              type="button"
              className="skill-tag-add"
              aria-label="Add tag"
              onClick={(e) => {
                e.stopPropagation();
                setAdding(true);
              }}
              onKeyDown={(e) => e.stopPropagation()}
            >
              + tag
            </button>
          )}
          {onSaveTags && adding && (
            <form
              onSubmit={submitAdd}
              onClick={(e) => e.stopPropagation()}
              className="skill-tag-add-form"
            >
              <input
                autoFocus
                type="text"
                value={addInput}
                placeholder="tag"
                maxLength={64}
                onChange={(e) => setAddInput(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setAddInput("");
                  }
                }}
                onBlur={() => {
                  setAdding(false);
                  setAddInput("");
                }}
              />
            </form>
          )}
        </div>
      )}

      <div className="skill-meta-row">
        <span
          className="freshness-dot"
          style={{ background: fresh.color } as React.CSSProperties}
          title={`last commit: ${fresh.label}`}
        />
        <span>{fresh.label}</span>
        {entry.version && <span>· v{entry.version}</span>}
      </div>

      {agents && agents.length > 0 && (
        <div
          className="skill-agent-chips"
          aria-label={`Installed for: ${agents.map((a) => AGENT_LABELS[a]).join(", ")}`}
        >
          {agents.map((a) => (
            <span key={a} className="skill-agent-chip" title={AGENT_LABELS[a]}>
              {AGENT_PATHS[a]}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Deduplicated list of agents in which a skill named `name` is currently
 * installed. Empty when the skill isn't installed under any agent dir.
 */
export function agentsForSkill(
  installed: InstalledSkill[],
  name: string,
): AgentId[] {
  const seen = new Set<AgentId>();
  for (const i of installed) {
    if (i.name === name && i.kind === "ours") seen.add(i.agent);
  }
  return Array.from(seen);
}

/**
 * Single badge per card. Actionable state badges override provenance
 * when present. Priority order, highest wins:
 *
 *   1. MISSING     — entry.missing: files gone. Open drawer to forget.
 *   2. UNREACHABLE — origin hasn't answered the last few probes; the
 *                    local copy is intact.
 *   3. UPDATE      — entry.skillUpdateAvailable: upstream changed,
 *                    local content is clean. Open drawer to apply.
 *
 * The CURATED badge (source: curated) and the EDITED drift badge were
 * both removed — v6 (#159) dropped the `source` axis (and with it the
 * curated/canon concept) entirely; provenance is a single nullable
 * `origin.url`. Local (`url: null`) and remote skills render without a
 * provenance chip; only the actionable heal states above get a badge.
 */
function StateBadge({
  entry,
}: {
  entry: RegistryEntry;
}): React.ReactElement | null {
  if (entry.missing) {
    return (
      <span
        className="skill-state-badge missing"
        title="This skill's files are gone. Open to forget the entry or repoint it."
      >
        MISSING
      </span>
    );
  }
  if (entry.originUnreachable && isGithubUrl(entry.origin.url)) {
    return (
      <span
        className="skill-state-badge missing"
        title={`Origin ${parseOwnerRepo(entry.origin.url) ?? ""} hasn't been reachable for the last few probes. Your local copy is intact. Open to keep this skill or retry the probe.`}
      >
        UNREACHABLE
      </span>
    );
  }
  if (entry.skillUpdateAvailable) {
    return (
      <span
        className="skill-state-badge update"
        title={`An update is available from ${
          parseOwnerRepo(entry.origin.url) ?? "Origin"
        }. Open to apply.`}
      >
        UPDATE
      </span>
    );
  }
  return null;
}

function StatusChip({
  status,
  warnings,
}: {
  status: CardStatus;
  warnings: number;
}): React.ReactElement | null {
  if (status.kind === "installed") {
    return (
      <span className="skill-status-chip ours">
        <Icon name="check" size="sm" /> Installed
      </span>
    );
  }
  if (status.kind === "external") {
    return (
      <span className="skill-status-chip neutral">
        <Icon name="external-link" size="sm" /> External
      </span>
    );
  }
  if (status.kind === "real-directory") {
    return (
      <span className="skill-status-chip warn">
        <Icon name="folder" size="sm" /> Real-dir
      </span>
    );
  }
  if (status.kind === "broken-symlink") {
    return (
      <span className="skill-status-chip danger">
        <Icon name="broken-link" size="sm" /> Broken
      </span>
    );
  }
  if (warnings > 0) {
    return (
      <span className="skill-status-chip warn">
        <Icon name="alert-triangle" size="sm" /> {warnings}{" "}
        {warnings === 1 ? "warning" : "warnings"}
      </span>
    );
  }
  return null;
}

function ariaLabelFor(entry: RegistryEntry, status: CardStatus): string {
  const statusLabel: Record<CardStatus["kind"], string> = {
    uninstalled: "not installed",
    installed: "installed",
    external: "external symlink",
    "real-directory": "real directory, not yet integrated",
    "broken-symlink": "broken symlink",
  };
  const warnings = entry.warnings?.length ?? 0;
  const warningSuffix =
    warnings > 0
      ? `, ${warnings} ${warnings === 1 ? "warning" : "warnings"}`
      : "";
  return `${entry.name}, ${statusLabel[status.kind]}${warningSuffix}. Activate to view details.`;
}

/**
 * Build a CardStatus from an InstalledSkill list (used by both tabs).
 */
export function statusForEntry(
  entry: RegistryEntry,
  installed: InstalledSkill[],
): CardStatus {
  const match = installed.find(
    (i) => i.name === entry.name && i.kind === "ours",
  );
  return match ? { kind: "installed" } : { kind: "uninstalled" };
}
