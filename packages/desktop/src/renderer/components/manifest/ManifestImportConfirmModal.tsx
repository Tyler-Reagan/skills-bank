import React, { useMemo, useState } from "react";
import type { AgentId, ImportRegistryManifestResult } from "@skills-bank/core";
import { AGENT_LABELS } from "../../agentDisplay.js";
import {
  Modal,
  ModalCloseButton,
  modalHeader,
  modalFooter,
} from "../modalStyles.js";

/**
 * After a successful manifest import, surfaces the install-hint
 * follow-up: the manifest carries per-skill `lastInstalledOn` lists,
 * and this modal lets the user re-link them into the agent dirs
 * the source machine had wired up. Skipping is fine — the registry
 * is already restored either way.
 *
 * Lives at App-level (hoisted out of SettingsModal as part of the
 * v1.6 Account-vs-Settings seam cleanup) so the import flow can
 * trigger both the registry refresh and this confirm step from one
 * caller.
 */
interface Props {
  result: ImportRegistryManifestResult;
  onClose: () => void;
  onDone: (statusMessage: string | null) => void;
}

export function ManifestImportConfirmModal({
  result,
  onClose,
  onDone,
}: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { names, agents, agentLabels } = useMemo(() => {
    const nameSet = new Set<string>();
    const agentSet = new Set<AgentId>();
    for (const h of result.installHints) {
      nameSet.add(h.name);
      for (const a of h.agents) agentSet.add(a);
    }
    const agentArr = Array.from(agentSet);
    return {
      names: Array.from(nameSet),
      agents: agentArr,
      agentLabels: agentArr.map((id) => AGENT_LABELS[id]).join(", "),
    };
  }, [result]);

  const runInstall = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await window.skillsBank.installFromManifestHint({
        names,
        agents,
      });
      if (r.ok) {
        onDone(r.message);
      } else {
        setError(
          r.errors.length > 0
            ? r.errors.join("\n")
            : (r.message ?? "install failed"),
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const registeredCount = result.outcomes.filter(
    (o) => o.result === "registered",
  ).length;

  return (
    <Modal label="Confirm install from manifest" onClose={onClose} width={480}>
      <div className={modalHeader}>
        <h2 className="mt-0 mb-0 text-13">Install restored skills?</h2>
        <ModalCloseButton onClose={onClose} />
      </div>
      <p className="manifest-confirm-hint mt-8">
        {registeredCount} skill{registeredCount === 1 ? "" : "s"} restored.{" "}
        {names.length} of them {names.length === 1 ? "was" : "were"} previously
        installed in <strong>{agentLabels}</strong>. Install in your agents now?
        Your registry is already restored either way.
      </p>
      {error && <pre className="manifest-confirm-error">{error}</pre>}
      <div className={modalFooter}>
        <button onClick={onClose} disabled={busy}>
          Skip
        </button>
        <button
          className="primary"
          onClick={() => void runInstall()}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinner inline" /> Installing
            </>
          ) : (
            "Install"
          )}
        </button>
      </div>
    </Modal>
  );
}
