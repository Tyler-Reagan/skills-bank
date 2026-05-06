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
  /** Agents that already have this skill linked. Excluded from the propagate picker. */
  installedAgents?: AgentId[];
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type Phase =
  | { kind: "plan" }
  | { kind: "applying" }
  | { kind: "result"; result: MigrationResult };

export function SingleMigrateModal({
  entry,
  installedAgents = [],
  onClose,
  onFlash,
}: Props): React.ReactElement {
  useFocusReturn();
  const [actionType, setActionType] = useState<MigrationAction["type"]>(() =>
    defaultActionType(entry),
  );
  // Agents available as propagation targets — every known agent that
  // doesn't already have this skill linked. Initial state: all checked
  // (broadcast) so the common case is one click.
  const propagateCandidates = useMemo(
    () => ALL_AGENTS.filter((id) => !installedAgents.includes(id)),
    [installedAgents],
  );
  const [propagateTargets, setPropagateTargets] = useState<AgentId[]>(
    propagateCandidates,
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
      case "propagate":
        if (propagateTargets.length === 0) {
          onFlash("Pick at least one agent to link to.");
          return;
        }
        action = {
          type: "propagate",
          name: entry.name,
          toAgents: propagateTargets,
        };
        break;
    }
    setPhase({ kind: "applying" });
    const results = await window.skillsBank.migrate([
      { name: entry.name, action },
    ]);
    const result = results[0]!;
    if (result.ok && result.action.type === "adopt") {
      // Refresh the index so the freshly adopted skill is recognised.
      void window.skillsBank.rebuildIndex();
    }
    setPhase({ kind: "result", result });
  };

  const togglePropagate = (id: AgentId) => {
    setPropagateTargets((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  if (phase.kind === "applying") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Migrating {entry.name}…</h2>
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
            {phase.result.ok ? "Migration complete" : "Migration failed"}
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

                {o.value === "propagate" && selected && (
                  <div style={{ margin: "10px 0 0 24px" }}>
                    {propagateCandidates.length === 0 ? (
                      <p
                        style={{
                          fontSize: 12,
                          color: "var(--text-3)",
                          margin: 0,
                        }}
                      >
                        Already linked in every known agent directory.
                      </p>
                    ) : (
                      propagateCandidates.map((id) => (
                        <label
                          key={id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "4px 0",
                            fontSize: 12,
                            color: "var(--text)",
                            cursor: "pointer",
                          }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="checkbox"
                            checked={propagateTargets.includes(id)}
                            onChange={() => togglePropagate(id)}
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
                        </label>
                      ))
                    )}
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

// Default to "propagate" for the most common user intent: a skill exists
// in some agent dir(s) and the user wants to expose it to others
// (e.g. a CLI install in ~/.agents/skills that should also be linked
// from ~/.claude/skills so Claude Code can use it). Adopt remains
// available for users who want to bring the skill under registry mgmt.
function defaultActionType(e: InstalledSkill): MigrationAction["type"] {
  switch (e.kind) {
    case "ours":
      return "skip";
    case "broken-symlink":
      return "remove";
    case "foreign-symlink":
      return "propagate";
    case "real-directory":
      return "propagate";
  }
}

interface ActionOption {
  value: MigrationAction["type"];
  label: string;
  description: string;
}

function optionsFor(e: InstalledSkill): ActionOption[] {
  switch (e.kind) {
    case "ours":
      return [
        {
          value: "skip",
          label: "Skip",
          description: "Already integrated. No action needed.",
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
        {
          value: "propagate",
          label: "Link to other agents…",
          description:
            "Add a symlink in additional agent directories so the skill is available wherever you run an AI tool. Source content is untouched.",
        },
        {
          value: "adopt",
          label: "Adopt into registry",
          description:
            "Copy the target folder into skills/<name>/ and re-point the symlink at the registry. Brings the skill under registry management.",
        },
        {
          value: "register-external",
          label: "Register as external",
          description:
            "Track the symlink in .skills-bank/external.json without touching the source.",
        },
        { value: "skip", label: "Skip", description: "Leave it as-is." },
        {
          value: "remove",
          label: "Remove symlink",
          description:
            "Delete the symlink (leaves the target folder untouched).",
        },
      ];
    case "real-directory":
      return [
        {
          value: "propagate",
          label: "Link to other agents…",
          description:
            "Add a symlink in additional agent directories pointing at this folder. Source content stays where it is.",
        },
        {
          value: "adopt",
          label: "Adopt into registry",
          description:
            "Move the directory into skills/<name>/ and replace it with a symlink. Brings the skill under registry management.",
        },
        { value: "skip", label: "Skip", description: "Leave it as-is." },
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
