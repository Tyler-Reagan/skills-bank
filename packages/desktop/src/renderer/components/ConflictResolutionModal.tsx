import React, { useState } from "react";
import type {
  ConflictAction,
  ConflictEntry,
  SyncDecisions,
} from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";

interface Props {
  conflicts: ConflictEntry[];
  onClose: () => void;
  onResolve: (decisions: SyncDecisions) => Promise<void> | void;
}

const ACTIONS: { value: ConflictAction; label: string; description: string }[] =
  [
    {
      value: "keep-mine",
      label: "Keep mine",
      description:
        "Skip the canonical version. Your skill stays; it won't be re-prompted.",
    },
    {
      value: "use-canonical",
      label: "Use canonical (replaces mine)",
      description:
        "Overwrite your version with the canonical one. Your changes are lost.",
    },
    {
      value: "rename-mine",
      label: "Rename mine to <name>-local",
      description:
        "Move your version to a new name and accept canonical at the original. Both survive.",
    },
  ];

export function ConflictResolutionModal({
  conflicts,
  onClose,
  onResolve,
}: Props): React.ReactElement {
  useFocusReturn();
  // Default each conflict to keep-mine (the safest action — no destructive
  // overwrite, no rename surprises). User must actively change it.
  const [picks, setPicks] = useState<Record<string, ConflictAction>>(() => {
    const out: Record<string, ConflictAction> = {};
    for (const c of conflicts) out[c.name] = "keep-mine";
    return out;
  });
  const [submitting, setSubmitting] = useState(false);

  const apply = async () => {
    setSubmitting(true);
    const decisions: SyncDecisions = {};
    const decidedAt = new Date().toISOString();
    for (const c of conflicts) {
      const action = picks[c.name];
      if (action) decisions[c.name] = { action, decidedAt };
    }
    try {
      await onResolve(decisions);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true" aria-label="Resolve sync conflicts">
        <h2 style={{ marginTop: 0 }}>Resolve sync conflicts</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          {conflicts.length} skill{conflicts.length === 1 ? "" : "s"} have
          name collisions between your local registry and canonical. Pick an
          action for each. Your choice is remembered for future syncs.
        </p>

        <div style={{ marginTop: 16, maxHeight: "60vh", overflowY: "auto" }}>
          {conflicts.map((c) => (
            <div
              key={c.name}
              style={{
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: 12,
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  marginBottom: 8,
                }}
              >
                <strong style={{ fontFamily: "var(--font-mono)" }}>
                  {c.name}
                </strong>
                <span
                  style={{ color: "var(--text-3)", fontSize: 11 }}
                >
                  yours: {c.localSource.source}
                </span>
              </div>
              {ACTIONS.map((a) => (
                <label
                  key={a.value}
                  style={{
                    display: "block",
                    padding: 8,
                    marginBottom: 4,
                    borderRadius: 4,
                    cursor: "pointer",
                    background:
                      picks[c.name] === a.value
                        ? "var(--accent-dim)"
                        : "transparent",
                  }}
                >
                  <input
                    type="radio"
                    name={`conflict-${c.name}`}
                    value={a.value}
                    checked={picks[c.name] === a.value}
                    onChange={() =>
                      setPicks((p) => ({ ...p, [c.name]: a.value }))
                    }
                    style={{ marginRight: 8 }}
                  />
                  <span style={{ fontWeight: 500 }}>{a.label}</span>
                  <p
                    style={{
                      margin: "2px 0 0 24px",
                      fontSize: 12,
                      color: "var(--text-2)",
                    }}
                  >
                    {a.description}
                  </p>
                </label>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
          <button onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void apply()}
            disabled={submitting}
          >
            {submitting ? "Applying…" : "Apply & re-sync"}
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
  width: 640,
  maxWidth: "90vw",
};
