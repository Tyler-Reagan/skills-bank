import React, { useState } from "react";
import type { AgentId, InstalledSkill } from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

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

interface Props {
  name: string;
  /** Agent dirs the skill is currently linked into (kind === "ours"). */
  installations: InstalledSkill[];
  /** Apply the user's selection. Empty selection is a no-op (closes). */
  onApply: (selectedAgents: AgentId[]) => void | Promise<void>;
  onClose: () => void;
}

/**
 * M7: per-agent picker for the "Remove from agents" action. Lets the
 * user remove the skill from a subset of agent dirs while retaining
 * the others. Default selection is "all" so hitting Apply without
 * touching anything matches the legacy all-agents behavior.
 *
 * Reuses the visual vocabulary of ConflictResolveModal (per-agent
 * card + path readout) but with a single boolean per row instead of
 * the three-action radio set — simpler decision, simpler UI.
 */
export function UninstallAgentPicker({
  name,
  installations,
  onApply,
  onClose,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const [selected, setSelected] = useState<Set<AgentId>>(
    () => new Set(installations.map((i) => i.agent)),
  );
  const [submitting, setSubmitting] = useState(false);

  const toggle = (id: AgentId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allChecked = selected.size === installations.length;
  const noneChecked = selected.size === 0;

  const apply = async () => {
    setSubmitting(true);
    try {
      await onApply([...selected]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Remove {name} from agents</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          Pick which agent dirs to drop. The skill stays in the others
          and remains installable any time.
        </p>

        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 12,
            marginBottom: 12,
          }}
        >
          <button
            onClick={() =>
              setSelected(new Set(installations.map((i) => i.agent)))
            }
          >
            Select all
          </button>
          <button onClick={() => setSelected(new Set())}>Select none</button>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {installations.map((i) => (
            <label
              key={i.agent}
              style={{
                display: "flex",
                gap: 10,
                padding: 12,
                marginBottom: 8,
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: "pointer",
                background: selected.has(i.agent)
                  ? "var(--accent-dim)"
                  : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(i.agent)}
                onChange={() => toggle(i.agent)}
                style={{ marginTop: 2 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong>{AGENT_LABELS[i.agent]}</strong>
                <code
                  style={{
                    display: "block",
                    fontSize: 11,
                    color: "var(--text-3)",
                    marginTop: 4,
                    overflowWrap: "anywhere",
                  }}
                >
                  {i.linkPath}
                </code>
              </div>
            </label>
          ))}
        </div>

        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: "var(--text-3)",
          }}
        >
          {noneChecked
            ? "Nothing selected"
            : allChecked
              ? `Will remove from all ${selected.size} agent(s)`
              : `Will remove from ${selected.size} of ${installations.length} agent(s)`}
        </p>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void apply()}
            disabled={submitting || noneChecked}
          >
            {submitting ? "Removing…" : "Remove"}
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
  width: 560,
  maxWidth: "90vw",
};
