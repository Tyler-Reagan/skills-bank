import React, { useState } from "react";
import type { AgentId, InstalledSkill, RegistryEntry } from "@skills-bank/core";
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
   * True when the entry corresponds to a real registry skill (the skill
   * has a folder under `<repo>/skills/<name>/`). Drives the publish
   * badge: not-in-registry skills always render YOURS, in-registry
   * skills render DRAFT only when locally modified or unpushed.
   */
  isRegistered?: boolean;
  /**
   * Save a tag list directly from the card (quick X + quick add).
   * When omitted, tags render as plain chips with no inline edit
   * affordance — caller can still edit via the detail drawer.
   */
  onSaveTags?: (next: string[]) => Promise<void> | void;
}

export function SkillCard({
  entry,
  status,
  onSelect,
  index = 0,
  agents,
  isRegistered = true,
  onSaveTags,
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

  return (
    <div
      className={`skill-card${entry.upstreamUpdateAvailable ? " skill-card--update-available" : ""}`}
      style={{ animationDelay: `${index * 30}ms` } as React.CSSProperties}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={ariaLabelFor(entry, status)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="skill-card-top">
        <p
          className="skill-name"
          style={{ flex: 1, minWidth: 0, marginBottom: 0 }}
        >
          {entry.name}
        </p>
        <PublishBadge entry={entry} isRegistered={isRegistered} />
        <StatusChip status={status} warnings={entry.warnings?.length ?? 0} />
      </div>

      {entry.description ? (
        <p className="skill-description">{entry.description}</p>
      ) : (
        <p
          className="skill-description"
          style={{ color: "var(--text-3)", fontStyle: "italic" }}
        >
          (no description)
        </p>
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
                >
                  <Icon name="x" size="sm" />
                </button>
              )}
            </span>
          ))}
          {hidden > 0 && <span className="skill-tag-more">+{hidden}</span>}
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
          style={{ background: fresh.color }}
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
 * Single badge per card. Provenance is the primary signal (bundled vs
 * yours); actionable state badges (drift, missing, update) override
 * when present. Priority order, highest wins:
 *
 *   1. MISSING  — entry.missing: files gone. Open drawer to forget.
 *   2. EDITED   — entry.drift: you've edited a bundled-or-upstream skill.
 *   3. UPDATE   — entry.upstreamUpdateAvailable: upstream changed, local
 *                 content is clean. Open drawer to apply.
 *   4. BUNDLED  — source: bundled. Sync owns this; destructive verbs
 *                 are gated.
 *   5. YOURS    — source: yours (everything else — authored locally,
 *                 merged in from another bank, etc.). Safe from Sync.
 */
function PublishBadge({
  entry,
  isRegistered,
}: {
  entry: RegistryEntry;
  isRegistered: boolean;
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
  if (entry.drift) {
    return (
      <span
        className="skill-state-badge drift"
        title={
          entry.source.upstream?.kind === "github"
            ? "You've edited this skill since the last Origin fetch. Open to unlink the Origin (keep edits) or reset to Origin (discard edits)."
            : "You've edited this bundled skill. Open to re-baseline or accept the drift."
        }
      >
        EDITED
      </span>
    );
  }
  if (entry.upstreamUpdateAvailable) {
    return (
      <span
        className="skill-state-badge update"
        title={`An update is available from ${
          entry.source.upstream?.repo ?? "Origin"
        }. Open to apply.`}
      >
        UPDATE
      </span>
    );
  }
  if (!isRegistered) {
    return (
      <span
        className="skill-origin-badge yours"
        title="Exists in an agent dir but isn't in the registry. Register from the Installed tab."
      >
        YOURS
      </span>
    );
  }
  if (entry.source.source === "bundled") {
    return (
      <span
        className="skill-origin-badge bundled"
        title="Part of the curated set this app ships with. Sync keeps it current."
      >
        BUNDLED
      </span>
    );
  }
  return (
    <span
      className="skill-origin-badge yours"
      title="You added this. Sync will never touch it."
    >
      YOURS
    </span>
  );
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
