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
import { Icon } from "./Icon.js";
import { Modal } from "./modalStyles.js";

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
    // Undismissable while the IPC is in flight — Modal handles
    // `onClose={undefined}` by suppressing scrim + Esc.
    return (
      <Modal label={`Updating links for ${name}`} width={540}>
        <h2 className="mt-0">Updating links for {name}</h2>
        <div className="manage-links-applying">
          <div className="spinner" />
        </div>
      </Modal>
    );
  }

  if (phase.kind === "result") {
    const dismiss = () => {
      onFlash(phase.result.message);
      void onClose();
    };
    return (
      <Modal
        label={phase.result.ok ? "Links updated" : "Update failed"}
        onClose={dismiss}
        width={540}
      >
        <h2 className="mt-0">
          {phase.result.ok ? "Links updated" : "Update failed"}
        </h2>
        <p
          className={`manage-links-result-row${phase.result.ok ? " manage-links-result-row--ok" : " manage-links-result-row--err"}`}
        >
          <Icon name={phase.result.ok ? "check" : "x"} size="sm" />{" "}
          {phase.result.message}
        </p>
        <div className="row-end">
          <button className="primary" onClick={dismiss}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      label={`Manage agent links — ${name}`}
      onClose={() => void onClose()}
      width={540}
    >
      <h2 className="mt-0">Manage agent links — {name}</h2>
      <p className="text-muted text-13 mt-4">
        Pick which agent directories the skill is linked from. Already-checked
        agents reflect the current state — uncheck to remove a link, check to
        add one. Source directories that hold the actual content are locked;
        unlinking them would delete the skill.
      </p>

      <div className="mt-16 mb-16">
        {ALL_AGENTS.map((id) => {
          const isSource = sourceAgents.has(id);
          const isChecked = isSource || desiredAgents.has(id);
          return (
            <label
              key={id}
              className={`manage-links-agent-label${isSource ? " manage-links-agent-label--source" : " manage-links-agent-label--active"}`}
            >
              <input
                type="checkbox"
                checked={isChecked}
                disabled={isSource}
                onChange={() => toggle(id)}
              />
              <strong className="min-w-130">{AGENT_LABELS[id]}</strong>
              <code className="text-subtle text-11 flex-1">
                {AGENT_PATHS[id]}/skills/
              </code>
              {isSource && <span className="repo-item-badge">source</span>}
            </label>
          );
        })}
      </div>

      <div className="row-end">
        <button onClick={() => void onClose()}>Cancel</button>
        <button className="primary" onClick={() => void apply()}>
          Apply
        </button>
      </div>
    </Modal>
  );
}
