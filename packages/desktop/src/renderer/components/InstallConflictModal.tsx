import React, { useState } from "react";
import type { AgentId } from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import { Icon } from "./Icon.js";
import { ConflictModal } from "./ConflictModal.js";
import type { ConflictAdapter } from "./ConflictModal.js";

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
 * InstallCollisionModal — that one handles stragglers AFTER a successful
 * install. This one is the gate: agents currently block the install
 * because something is already at the link path.
 *
 * Thin adapter-builder over ConflictModal.
 */
export function InstallConflictModal({
  name,
  errors,
  onForce,
  onResolve,
  onClose,
}: Props): React.ReactElement {
  const [forcing, setForcing] = useState(false);

  const sidesContent = (
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
  );

  const adapter: ConflictAdapter = {
    title: `Install conflict — ${name}`,
    description: (
      <>
        <Icon name="alert-triangle" size="sm" /> Something already exists at{" "}
        {errors.length === 1 ? "this path" : "these paths"}. Forcing replaces
        existing symlinks with one pointing at the Skills Bank copy. Resolving
        lets you pick per-agent (replace, delete, or keep).
      </>
    ),
    sides: [{ label: "errors", content: sidesContent }],
    options: [
      {
        label: "Resolve per-agent",
        value: "resolve",
        disabled: forcing,
      },
      {
        label: forcing ? (
          <>
            <span className="spinner inline" /> Forcing
          </>
        ) : (
          "Force overwrite all"
        ),
        value: "force",
        disabled: forcing,
      },
    ],
    onResolve: (choice) => {
      if (choice === "resolve") {
        onResolve();
        return;
      }
      if (choice === "force") {
        setForcing(true);
        void (async () => {
          try {
            await onForce();
          } finally {
            setForcing(false);
          }
        })();
      }
    },
  };

  return (
    <ConflictModal
      adapter={adapter}
      onClose={onClose}
      width={600}
      closeDisabled={forcing}
    />
  );
}
