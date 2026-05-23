import React, { useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import { Icon } from "./Icon.js";
import { Modal } from "./modalStyles.js";

export interface InstallConflictError {
  agent: AgentId;
  message: string;
}

interface Props {
  name: string;
  errors: InstallConflictError[];
  onForce: () => Promise<void> | void;
  onResolve: () => void;
  onClose: () => void;
}

/**
 * Surfaced when installSkill returns a "refusing to overwrite without
 * force" error from at least one agent. Distinct from the post-install
 * ConflictResolveModal — that one handles stragglers AFTER a successful
 * install. This one is the gate: agents currently block the install
 * because something is already at the link path.
 */
export function InstallConflictModal({
  name,
  errors,
  onForce,
  onResolve,
  onClose,
}: Props): React.ReactElement {
  const [forcing, setForcing] = useState(false);

  const handleForce = async () => {
    setForcing(true);
    try {
      await onForce();
    } finally {
      setForcing(false);
    }
  };

  return (
    <Modal
      label={`Install conflict — ${name}`}
      onClose={onClose}
      width={600}
      bodyStyle={{ maxHeight: undefined, overflowY: undefined }}
    >
      <h2 style={{ marginTop: 0 }}>
        <Icon name="alert-triangle" size="sm" /> Install conflict — {name}
      </h2>
      <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
        Something already exists at{" "}
        {errors.length === 1 ? "this path" : "these paths"}. Forcing replaces
        existing symlinks with one pointing at the Skills Bank copy. Resolving
        lets you pick per-agent (replace, delete, or keep).
      </p>

      <ul
        style={{
          margin: "12px 0",
          padding: "8px 12px",
          background: "var(--surface-hi)",
          borderRadius: 4,
          fontSize: 11,
          fontFamily: "var(--font-mono)",
          color: "var(--text-3)",
          listStyle: "none",
          maxHeight: 200,
          overflowY: "auto",
        }}
      >
        {errors.map((e) => (
          <li key={e.agent} style={{ padding: "4px 0" }}>
            <strong style={{ color: "var(--text-2)" }}>
              {AGENT_LABELS[e.agent]}
            </strong>
            <div>{e.message}</div>
          </li>
        ))}
      </ul>

      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          marginTop: 12,
        }}
      >
        <button className="btn" onClick={onClose} disabled={forcing}>
          Cancel
        </button>
        <button className="btn" onClick={onResolve} disabled={forcing}>
          Resolve per-agent
        </button>
        <button
          className="btn primary"
          onClick={() => void handleForce()}
          disabled={forcing}
        >
          {forcing ? (
            <>
              <span className="spinner inline" /> Forcing
            </>
          ) : (
            "Force overwrite all"
          )}
        </button>
      </div>
    </Modal>
  );
}
