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
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">
        <Icon name="alert-triangle" size="sm" /> Install conflict — {name}
      </h2>
      <p className="text-muted text-13 mt-4">
        Something already exists at{" "}
        {errors.length === 1 ? "this path" : "these paths"}. Forcing replaces
        existing symlinks with one pointing at the Skills Bank copy. Resolving
        lets you pick per-agent (replace, delete, or keep).
      </p>

      <ul className="install-conflict-list">
        {errors.map((e) => (
          <li key={e.agent} className="install-conflict-list-item">
            <strong className="install-conflict-list-agent">
              {AGENT_LABELS[e.agent]}
            </strong>
            <div>{e.message}</div>
          </li>
        ))}
      </ul>

      <div className="row-end mt-12">
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
