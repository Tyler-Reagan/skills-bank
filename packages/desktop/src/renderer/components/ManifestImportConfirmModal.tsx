import React, { useMemo, useState } from "react";
import type { AgentId, ImportRegistryManifestResult } from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import { Icon } from "./Icon.js";
import { overlay, modal as sharedModal, modalFooter } from "./modalStyles.js";

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
    <div style={overlay} onClick={onClose} role="presentation">
      <div
        style={sharedModal(480)}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm install from manifest"
      >
        <div style={header}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Install restored skills?</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            style={closeBtn}
          >
            <Icon name="x" size="md" />
          </button>
        </div>
        <p style={{ ...hint, marginTop: 8 }}>
          {registeredCount} skill{registeredCount === 1 ? "" : "s"} restored.{" "}
          {names.length} of them {names.length === 1 ? "was" : "were"}{" "}
          previously installed in <strong>{agentLabels}</strong>. Install in
          your agents now? Your registry is already restored either way.
        </p>
        {error && (
          <pre
            style={{
              margin: "8px 0 0",
              fontSize: 11,
              color: "var(--danger)",
              whiteSpace: "pre-wrap",
            }}
          >
            {error}
          </pre>
        )}
        <div style={modalFooter}>
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
      </div>
    </div>
  );
}

const header: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
};

const closeBtn: React.CSSProperties = {
  background: "transparent",
  border: "none",
  cursor: "pointer",
  color: "var(--text-3)",
  padding: 4,
  borderRadius: 4,
  display: "inline-flex",
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-2)",
  margin: "4px 0",
};
