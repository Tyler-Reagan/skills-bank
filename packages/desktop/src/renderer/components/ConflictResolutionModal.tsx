import React, { useEffect, useState } from "react";
import type {
  ConflictAction,
  ConflictEntry,
  SyncDecisions,
} from "@skills-bank/core";
import type { SkillDiffResult } from "../../shared/ipc.js";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { DiffViewer } from "./DiffViewer.js";

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
        "Skip the bundled version. Your skill stays; it won't be re-prompted.",
    },
    {
      value: "use-canonical",
      label: "Use bundled (replaces mine)",
      description:
        "Overwrite your version with the bundled one. Your changes are lost.",
    },
    {
      value: "rename-mine",
      label: "Rename mine to <name>-local",
      description:
        "Move your version to a new name and accept bundled at the original. Both survive.",
    },
  ];

export function ConflictResolutionModal({
  conflicts,
  onClose,
  onResolve,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  // Default each conflict to keep-mine (the safest action — no destructive
  // overwrite, no rename surprises). User must actively change it.
  const [picks, setPicks] = useState<Record<string, ConflictAction>>(() => {
    const out: Record<string, ConflictAction> = {};
    for (const c of conflicts) out[c.name] = "keep-mine";
    return out;
  });
  const [submitting, setSubmitting] = useState(false);
  // Per-skill diff state. Loaded lazily on first expand and cached so
  // re-opening a row doesn't refetch. Failures cache too so we don't
  // hammer the IPC if the source path went away.
  const [diffs, setDiffs] = useState<
    Record<string, { result: SkillDiffResult | null; loading: boolean; error: string | null }>
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [registryRoot, setRegistryRoot] = useState<string | null>(null);

  useEffect(() => {
    void window.skillsBank.getConfig().then((c) => setRegistryRoot(c.registryRoot));
  }, []);

  const toggleDiff = (c: ConflictEntry) => {
    const open = !expanded[c.name];
    setExpanded((prev) => ({ ...prev, [c.name]: open }));
    if (!open) return;
    if (diffs[c.name]) return; // cached
    if (!registryRoot) return;
    setDiffs((prev) => ({
      ...prev,
      [c.name]: { result: null, loading: true, error: null },
    }));
    void window.skillsBank
      .getSkillDiff({
        leftPath: `${registryRoot}/skills/${c.name}`,
        rightPath: c.canonicalPath,
        leftLabel: "Yours",
        rightLabel: "Bundled",
      })
      .then((result) => {
        setDiffs((prev) => ({
          ...prev,
          [c.name]: { result, loading: false, error: null },
        }));
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setDiffs((prev) => ({
          ...prev,
          [c.name]: { result: null, loading: false, error: msg },
        }));
      });
  };

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

  // Bulk-action helpers. Sync collisions following a fresh clone or a
  // major upstream rewrite can affect every skill at once; per-row
  // clicking gets hostile fast without these.
  const setAll = (action: ConflictAction) => {
    setPicks((prev) => {
      const next = { ...prev };
      for (const c of conflicts) next[c.name] = action;
      return next;
    });
  };

  // Live tally of pending actions, so the user can see at a glance what
  // Apply will actually do without scrolling the list.
  const counts = (() => {
    let keep = 0;
    let use = 0;
    let rename = 0;
    for (const c of conflicts) {
      const a = picks[c.name];
      if (a === "keep-mine") keep += 1;
      else if (a === "use-canonical") use += 1;
      else if (a === "rename-mine") rename += 1;
    }
    return { keep, use, rename };
  })();

  return (
    <div style={overlay}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Resolve sync collisions"
      >
        <h2 style={{ marginTop: 0 }}>Resolve sync collisions</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          Sync collision: {conflicts.length} skill
          {conflicts.length === 1 ? "" : "s"} have name conflicts between your
          local registry and the upstream bundled set. Pick an action for each.
          Your choice is remembered for future syncs.
        </p>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginTop: 12,
          }}
        >
          <button
            type="button"
            onClick={() => setAll("keep-mine")}
            disabled={submitting}
          >
            Keep all mine
          </button>
          <button
            type="button"
            onClick={() => setAll("use-canonical")}
            disabled={submitting}
          >
            Use all bundled
          </button>
          <button
            type="button"
            onClick={() => setAll("rename-mine")}
            disabled={submitting}
          >
            Rename all to <code>&lt;name&gt;-local</code>
          </button>
          <span
            style={{
              flex: 1,
              textAlign: "right",
              alignSelf: "center",
              fontSize: 12,
              color: "var(--text-3)",
            }}
            aria-live="polite"
          >
            {[
              counts.keep > 0 ? `Keep ${counts.keep}` : null,
              counts.use > 0 ? `Use bundled ${counts.use}` : null,
              counts.rename > 0 ? `Rename ${counts.rename}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "Nothing selected"}
          </span>
        </div>

        <div style={{ marginTop: 12, maxHeight: "60vh", overflowY: "auto" }}>
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
                  gap: 8,
                }}
              >
                <strong style={{ fontFamily: "var(--font-mono)" }}>
                  {c.name}
                </strong>
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => toggleDiff(c)}
                  style={{ fontSize: 11 }}
                  aria-expanded={!!expanded[c.name]}
                >
                  {expanded[c.name] ? "Hide diff" : "Show diff (yours → bundled)"}
                </button>
              </div>
              {expanded[c.name] && (
                <div style={{ marginBottom: 10 }}>
                  <DiffViewer
                    result={diffs[c.name]?.result ?? null}
                    loading={diffs[c.name]?.loading ?? true}
                    error={diffs[c.name]?.error ?? null}
                  />
                </div>
              )}
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

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void apply()}
            disabled={submitting}
          >
            {submitting ? "Applying" : "Apply & re-sync"}
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
