import React, { useMemo, useState } from "react";
import type {
  AgentId,
  InstalledSkill,
  RegistrationResult,
} from "@skills-bank/core";
import {
  AGENT_LABELS,
  AGENT_PATHS,
  ALL_AGENT_IDS as ALL_AGENTS,
} from "../agentDisplay.js";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

interface Props {
  /** Display name and the source for the link operation. */
  name: string;
  /** All current installations of this skill across agent dirs. */
  installations: InstalledSkill[];
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type Phase =
  | { kind: "plan" }
  | { kind: "applying" }
  | { kind: "result"; result: RegistrationResult };

/**
 * Standalone modal: pick which agent directories the skill is linked
 * from. Distinct from "Register" — this only adjusts symlinks across
 * agent dirs and never moves the source content into the registry.
 *
 * Agents currently linked are pre-checked. Source agents (entries with
 * kind=real-directory — they hold the actual content) are checked AND
 * disabled, since unlinking them would delete the skill itself.
 */
export function ManageLinksModal({
  name,
  installations,
  onClose,
  onFlash,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(() => void onClose());

  const currentAgents = useMemo(
    () => new Set<AgentId>(installations.map((i) => i.agent)),
    [installations],
  );
  const sourceAgents = useMemo(
    () =>
      new Set<AgentId>(
        installations
          .filter((i) => i.kind === "real-directory")
          .map((i) => i.agent),
      ),
    [installations],
  );

  const [desiredAgents, setDesiredAgents] = useState<Set<AgentId>>(
    new Set(currentAgents),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "plan" });

  const apply = async () => {
    const agents = Array.from(
      new Set<AgentId>([...desiredAgents, ...sourceAgents]),
    );
    setPhase({ kind: "applying" });
    const results = await window.skillsBank.register([
      { name, action: { type: "setAgents", name, agents } },
    ]);
    setPhase({ kind: "result", result: results[0]! });
  };

  const toggle = (id: AgentId) => {
    if (sourceAgents.has(id)) return;
    setDesiredAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (phase.kind === "applying") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Updating links for {name}</h2>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "32px 0",
            }}
          >
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  if (phase.kind === "result") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>
            {phase.result.ok ? "Links updated" : "Update failed"}
          </h2>
          <p
            style={{
              color: phase.result.ok ? "var(--success)" : "var(--danger)",
              fontSize: 13,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <Icon name={phase.result.ok ? "check" : "x"} size="sm" />{" "}
            {phase.result.message}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              className="primary"
              onClick={() => {
                onFlash(phase.result.message);
                void onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Manage agent links"
      >
        <h2 style={{ marginTop: 0 }}>Manage agent links — {name}</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          Pick which agent directories the skill is linked from. Already-checked
          agents reflect the current state — uncheck to remove a link, check to
          add one. Source directories that hold the actual content are locked;
          unlinking them would delete the skill.
        </p>

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          {ALL_AGENTS.map((id) => {
            const isSource = sourceAgents.has(id);
            const isChecked = isSource || desiredAgents.has(id);
            return (
              <label
                key={id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "8px 4px",
                  fontSize: 13,
                  color: isSource ? "var(--text-2)" : "var(--text)",
                  cursor: isSource ? "default" : "pointer",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  disabled={isSource}
                  onChange={() => toggle(id)}
                />
                <strong style={{ minWidth: 130 }}>{AGENT_LABELS[id]}</strong>
                <code style={{ color: "var(--text-3)", fontSize: 11, flex: 1 }}>
                  {AGENT_PATHS[id]}/skills/
                </code>
                {isSource && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--text-3)",
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    source
                  </span>
                )}
              </label>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => void onClose()}>Cancel</button>
          <button className="primary" onClick={() => void apply()}>
            Apply
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
  width: 540,
  maxWidth: "90vw",
};
