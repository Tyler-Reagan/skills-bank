import React from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

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
}

export function SkillCard({
  entry,
  status,
  onSelect,
  index = 0,
}: Props): React.ReactElement {
  const fresh = freshness(entry.lastCommit);
  const visibleTags = (entry.tags ?? []).slice(0, 3);
  const hidden = (entry.tags?.length ?? 0) - visibleTags.length;

  return (
    <div
      className="skill-card"
      style={{ animationDelay: `${index * 30}ms` } as React.CSSProperties}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="skill-card-top">
        <p className="skill-name" style={{ flex: 1, minWidth: 0, marginBottom: 0 }}>
          {entry.name}
        </p>
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

      {visibleTags.length > 0 && (
        <div className="skill-tags">
          {visibleTags.map((t) => (
            <span key={t} className="skill-tag">
              #{t}
            </span>
          ))}
          {hidden > 0 && <span className="skill-tag-more">+{hidden}</span>}
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
    </div>
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
    return <span className="skill-status-chip ours">✓ Installed</span>;
  }
  if (status.kind === "external") {
    return <span className="skill-status-chip neutral">External</span>;
  }
  if (status.kind === "real-directory") {
    return <span className="skill-status-chip warn">Real-dir</span>;
  }
  if (status.kind === "broken-symlink") {
    return <span className="skill-status-chip danger">Broken</span>;
  }
  if (warnings > 0) {
    return (
      <span className="skill-status-chip warn">
        ⚠ {warnings} {warnings === 1 ? "warning" : "warnings"}
      </span>
    );
  }
  return null;
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
