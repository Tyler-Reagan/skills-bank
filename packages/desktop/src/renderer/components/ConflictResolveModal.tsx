import React, { useMemo, useState } from "react";
import type {
  AgentId,
  ConflictResolveAction,
  ConflictResolveDecision,
  InstalledSkill,
} from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { Icon } from "./Icon.js";

const AGENT_LABELS: Record<AgentId, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  gemini: "Gemini",
  copilot: "GitHub Copilot",
  continue: "Continue",
  cline: "Cline",
  codex: "OpenAI Codex",
  agents: "Agents (shared)",
};

const KIND_LABEL: Record<InstalledSkill["kind"], string> = {
  ours: "registered",
  "foreign-symlink": "external symlink",
  "real-directory": "duplicate directory",
  "broken-symlink": "broken symlink",
};

interface Props {
  name: string;
  conflicts: InstalledSkill[];
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

const ACTIONS: {
  value: ConflictResolveAction;
  label: string;
  description: string;
}[] = [
  {
    value: "replace-with-symlink",
    label: "Replace with symlink to registry",
    description:
      "Wipe the duplicate, recreate the agent dir as a symlink to the registry copy. Recommended.",
  },
  {
    value: "delete",
    label: "Delete entirely",
    description:
      "Remove the duplicate without creating a symlink. The agent will no longer have this skill.",
  },
  {
    value: "keep",
    label: "Keep as-is",
    description: "Leave the entry alone. The conflict will resurface later.",
  },
];

/**
 * Per-conflict resolver for registered skills that have stragglers
 * elsewhere — e.g. find-skills is symlinked from ~/.claude to the
 * registry copy, but a leftover real directory at ~/.agents/skills/
 * keeps surfacing the skill in "Not registered" until cleaned up.
 *
 * Scope is "registered + has duplicates"; broken symlinks have their
 * own dedicated repair flow (Fix broken link(s) button).
 */
export function ConflictResolveModal({
  name,
  conflicts,
  onClose,
  onFlash,
}: Props): React.ReactElement {
  useFocusReturn();
  const [picks, setPicks] = useState<Record<AgentId, ConflictResolveAction>>(
    () => {
      const initial: Partial<Record<AgentId, ConflictResolveAction>> = {};
      for (const c of conflicts) initial[c.agent] = "replace-with-symlink";
      return initial as Record<AgentId, ConflictResolveAction>;
    },
  );
  const [submitting, setSubmitting] = useState(false);

  const decisions = useMemo<ConflictResolveDecision[]>(
    () =>
      conflicts.map((c) => ({
        agent: c.agent,
        action: picks[c.agent] ?? "keep",
      })),
    [conflicts, picks],
  );

  const setAll = (action: ConflictResolveAction) => {
    const next: Record<AgentId, ConflictResolveAction> = { ...picks };
    for (const c of conflicts) next[c.agent] = action;
    setPicks(next);
  };

  const apply = async () => {
    setSubmitting(true);
    try {
      const r = await window.skillsBank.resolveSkillConflicts(name, decisions);
      const okCount = r.applied.length;
      const failCount = r.errors.length;
      onFlash(
        failCount === 0
          ? `Resolved ${okCount} conflict${okCount === 1 ? "" : "s"} for ${name}`
          : `Resolved ${okCount}; ${failCount} failed`,
      );
      await onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Resolve conflicts — {name}</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          {name} is registered, but some agent directories have stragglers
          that aren't symlinks to the registry copy. Pick how to handle each.
        </p>

        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 12,
            marginBottom: 12,
          }}
        >
          <button onClick={() => setAll("replace-with-symlink")}>
            Replace all with symlinks
          </button>
          <button onClick={() => setAll("delete")}>Delete all</button>
          <button onClick={() => setAll("keep")}>Keep all</button>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {conflicts.map((c) => (
            <div
              key={c.agent}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 6,
                }}
              >
                <strong>{AGENT_LABELS[c.agent]}</strong>
                <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                  {KIND_LABEL[c.kind]}
                </span>
              </div>
              <code
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--text-3)",
                  marginBottom: 8,
                }}
              >
                {c.linkPath}
              </code>
              {ACTIONS.map((a) => (
                <label
                  key={a.value}
                  style={{
                    display: "block",
                    padding: 6,
                    marginBottom: 4,
                    cursor: "pointer",
                    background:
                      picks[c.agent] === a.value
                        ? "var(--accent-dim)"
                        : "transparent",
                    borderRadius: 4,
                  }}
                >
                  <input
                    type="radio"
                    name={`conflict-${c.agent}`}
                    checked={picks[c.agent] === a.value}
                    onChange={() =>
                      setPicks((prev) => ({ ...prev, [c.agent]: a.value }))
                    }
                    style={{ marginRight: 8 }}
                  />
                  <strong style={{ fontSize: 13 }}>{a.label}</strong>
                  <p
                    style={{
                      margin: "2px 0 0 24px",
                      fontSize: 11,
                      color: "var(--text-2)",
                    }}
                  >
                    {a.description}
                  </p>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button onClick={() => void onClose()} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void apply()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Icon name="check" size="sm" /> Applying…
              </>
            ) : (
              "Apply"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "var(--scrim)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};
const modal: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border-hi)",
  borderRadius: 8,
  padding: 24,
  width: 600,
  maxWidth: "90vw",
};
