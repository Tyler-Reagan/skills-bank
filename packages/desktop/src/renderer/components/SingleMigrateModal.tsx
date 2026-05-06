import React, { useMemo, useState } from "react";
import type {
  AgentId,
  InstalledSkill,
  MigrationAction,
  MigrationResult,
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
const AGENT_PATHS: Record<AgentId, string> = {
  claude: "~/.claude",
  cursor: "~/.cursor",
  gemini: "~/.gemini",
  copilot: "~/.copilot",
  continue: "~/.continue",
  cline: "~/.cline",
  codex: "~/.codex",
  agents: "~/.agents",
};

const ALL_AGENTS: AgentId[] = [
  "claude",
  "cursor",
  "gemini",
  "copilot",
  "continue",
  "cline",
  "codex",
  "agents",
];

interface Props {
  entry: InstalledSkill;
  /**
   * All installations of this skill name across agent dirs. Used to
   * derive which agents currently have the skill linked and which one
   * (if any) is the source-of-truth real directory that can't be
   * unlinked safely.
   */
  installations?: InstalledSkill[];
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type Phase =
  | { kind: "plan" }
  | { kind: "applying" }
  | { kind: "result"; result: MigrationResult };

export function SingleMigrateModal({
  entry,
  installations,
  onClose,
  onFlash,
}: Props): React.ReactElement {
  useFocusReturn();

  const allInstalls = installations ?? [entry];
  // Agents that currently have the skill linked.
  const currentAgents = useMemo(
    () => new Set<AgentId>(allInstalls.map((i) => i.agent)),
    [allInstalls],
  );
  // Source agents: ones holding the actual content (real directory). The
  // checkbox stays checked + disabled because deleting a real dir would
  // delete the skill itself.
  const sourceAgents = useMemo(
    () =>
      new Set<AgentId>(
        allInstalls.filter((i) => i.kind === "real-directory").map((i) => i.agent),
      ),
    [allInstalls],
  );

  const [actionType, setActionType] = useState<MigrationAction["type"]>(() =>
    defaultActionType(entry),
  );
  // Initial desired set mirrors the current state — toggling reflects
  // the user's intent to either preserve, remove, or add per agent.
  const [desiredAgents, setDesiredAgents] = useState<Set<AgentId>>(
    new Set(currentAgents),
  );
  const [phase, setPhase] = useState<Phase>({ kind: "plan" });

  const apply = async () => {
    let action: MigrationAction;
    switch (actionType) {
      case "adopt":
        action = { type: "adopt", name: entry.name };
        break;
      case "register-external":
        action = { type: "register-external", name: entry.name };
        break;
      case "remove":
        action = { type: "remove", name: entry.name };
        break;
      case "skip":
        action = { type: "skip", name: entry.name };
        break;
      case "setAgents":
        action = {
          type: "setAgents",
          name: entry.name,
          // Always include source agents so the diff doesn't try to
          // remove their real-dir entries (the core layer guards too,
          // but keeping intent explicit is clearer).
          agents: Array.from(
            new Set<AgentId>([...desiredAgents, ...sourceAgents]),
          ),
        };
        break;
    }
    setPhase({ kind: "applying" });
    const results = await window.skillsBank.migrate([
      { name: entry.name, action },
    ]);
    const result = results[0]!;
    if (result.ok && result.action.type === "adopt") {
      void window.skillsBank.rebuildIndex();
    }
    setPhase({ kind: "result", result });
  };

  const toggleAgent = (id: AgentId) => {
    if (sourceAgents.has(id)) return; // source is locked
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
          <h2 style={{ marginTop: 0 }}>Updating {entry.name}…</h2>
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
            {phase.result.ok ? "Update complete" : "Update failed"}
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

  const options = optionsFor(entry);

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Manage {entry.name}</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13 }}>
          <span className="tag">{entry.kind}</span>
        </p>
        <p style={{ color: "var(--text-3)", fontSize: 12, marginTop: 4 }}>
          {entry.target ?? entry.linkPath}
        </p>

        <div style={{ marginTop: 16, marginBottom: 16 }}>
          {options.map((o) => {
            const selected = actionType === o.value;
            return (
              <label
                key={o.value}
                style={{
                  display: "block",
                  padding: 10,
                  marginBottom: 6,
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  cursor: "pointer",
                  background: selected ? "var(--accent-dim)" : "transparent",
                  borderColor: selected ? "var(--accent)" : "var(--border)",
                }}
              >
                <input
                  type="radio"
                  name="action"
                  value={o.value}
                  checked={selected}
                  onChange={() => setActionType(o.value)}
                  style={{ marginRight: 8 }}
                />
                <strong style={{ color: "var(--text)" }}>{o.label}</strong>
                <p
                  style={{
                    margin: "4px 0 0 24px",
                    fontSize: 12,
                    color: "var(--text-2)",
                  }}
                >
                  {o.description}
                </p>

                {o.value === "setAgents" && selected && (
                  <div style={{ margin: "10px 0 0 24px" }}>
                    {ALL_AGENTS.map((id) => {
                      const isSource = sourceAgents.has(id);
                      const isChecked =
                        isSource || desiredAgents.has(id);
                      return (
                        <label
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            fontSize: 12,
                            color: isSource ? "var(--text-2)" : "var(--text)",
                            cursor: isSource ? "default" : "pointer",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            disabled={isSource}
                            onChange={() => toggleAgent(id)}
                          />
                          <span>{AGENT_LABELS[id]}</span>
                          <code
                            style={{
                              color: "var(--text-3)",
                              fontSize: 11,
                            }}
                          >
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

// Default to "setAgents" for almost every kind — managing agent links is
// the most common reason a user opens this modal. broken-symlink defaults
// to remove (the dead link is the actionable thing).
function defaultActionType(e: InstalledSkill): MigrationAction["type"] {
  switch (e.kind) {
    case "broken-symlink":
      return "remove";
    case "ours":
    case "foreign-symlink":
    case "real-directory":
      return "setAgents";
  }
}

interface ActionOption {
  value: MigrationAction["type"];
  label: string;
  description: string;
}

function optionsFor(e: InstalledSkill): ActionOption[] {
  // Manage-agent-links is offered for every kind (including ours) so a
  // user can broaden or narrow which agents have a skill at any time.
  const setAgentsOption: ActionOption = {
    value: "setAgents",
    label: "Manage agent links",
    description:
      "Pick which agent directories have this skill linked. Already-checked agents reflect current state; unchecking removes the link, checking adds it. Source directories that hold the actual content are locked.",
  };

  switch (e.kind) {
    case "ours":
      return [
        setAgentsOption,
        {
          value: "skip",
          label: "Skip",
          description: "No changes.",
        },
      ];
    case "broken-symlink":
      return [
        {
          value: "remove",
          label: "Remove broken symlink",
          description: "Delete the dead link.",
        },
        {
          value: "skip",
          label: "Skip",
          description: "Leave it in place.",
        },
      ];
    case "foreign-symlink":
      return [
        setAgentsOption,
        {
          value: "adopt",
          label: "Register in registry",
          description:
            "Copy the target folder into skills/<name>/ and re-point the symlink at the registry. Brings the skill under registry management.",
        },
        {
          value: "register-external",
          label: "Track as external",
          description:
            "Track the symlink in .skills-bank/external.json without touching the source.",
        },
        { value: "skip", label: "Skip", description: "No changes." },
        {
          value: "remove",
          label: "Remove symlink",
          description:
            "Delete this agent's symlink (leaves the source target untouched).",
        },
      ];
    case "real-directory":
      return [
        setAgentsOption,
        {
          value: "adopt",
          label: "Register in registry",
          description:
            "Move the directory into skills/<name>/ and replace it with a symlink. Brings the skill under registry management.",
        },
        { value: "skip", label: "Skip", description: "No changes." },
      ];
  }
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
  width: 520,
  maxWidth: "90vw",
};
