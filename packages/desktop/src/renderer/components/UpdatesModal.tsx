import React, { useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { Icon } from "./Icon.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";

interface Props {
  entries: RegistryEntry[];
  onClose: () => void;
  onUpdate: (name: string) => Promise<{ ok: boolean; message: string }>;
  onView: (entry: RegistryEntry) => void;
  /**
   * Trigger a fresh upstream probe (e.g. after the user resolved an
   * outdated entry externally). Refresh button invokes this; the
   * modal then closes so the host re-renders with fresh data.
   */
  onRefresh: () => Promise<void>;
}

type RowState = "idle" | "updating" | "ok" | "err";

/**
 * Aggregate updates modal — one row per skill with an available
 * upstream update. Per-row Update (applies in place) and View
 * (opens the drawer). Update-all sequences the per-row Update
 * action with a small delay between rows so a failing row doesn't
 * block the queue.
 */
export function UpdatesModal({
  entries,
  onClose,
  onUpdate,
  onView,
  onRefresh,
}: Props): React.ReactElement {
  const [states, setStates] = useState<Record<string, RowState>>({});
  const [running, setRunning] = useState(false);

  const updateOne = async (name: string) => {
    setStates((s) => ({ ...s, [name]: "updating" }));
    const r = await onUpdate(name);
    setStates((s) => ({ ...s, [name]: r.ok ? "ok" : "err" }));
  };

  const updateAll = async () => {
    setRunning(true);
    try {
      // No within-loop skip on `states` — `setStates` inside `updateOne`
      // queues an update React applies asynchronously, so any read of
      // `states` later in this loop would see the closure-captured
      // pre-loop snapshot, not in-flight results. Re-running an
      // already-updated `npx skills update <name>` is a backend no-op
      // anyway; harmless to iterate every entry.
      for (const e of entries) {
        await updateOne(e.name);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <Modal
      label="Skill updates"
      onClose={onClose}
      width={640}
      bodyStyle={{
        maxWidth: "92vw",
        display: "flex",
        flexDirection: "column",
        overflowY: undefined,
      }}
      trapFocus
    >
      <div style={modalHeader}>
        <h2 style={{ margin: 0 }}>
          Skill updates <span style={countBadge}>{entries.length}</span>
        </h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      <p style={hint}>
        These skills have a newer version available from their{" "}
        <strong>Origin</strong>. Updating fetches the latest content directly
        from each skill's Origin and mirrors it into your registry — local edits
        are not preserved, so skills you've edited surface via the Drift heal
        flow (Reset to origin / Unlink origin) instead.
      </p>

      <div style={list}>
        {entries.length === 0 && (
          <div style={emptyState}>
            <Icon name="check" size="md" />
            <span>Every skill is up to date with its Origin.</span>
          </div>
        )}
        {entries.map((e) => {
          const state = states[e.name] ?? "idle";
          return (
            <div key={e.name} style={row}>
              <div style={rowMain}>
                <strong style={rowName}>{e.name}</strong>
                {e.source.origin?.repo && (
                  <span style={rowRepo}>{e.source.origin.repo}</span>
                )}
              </div>
              <div style={rowActions}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => onView(e)}
                  disabled={running}
                >
                  View
                </button>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => void updateOne(e.name)}
                  disabled={running || state === "ok" || state === "updating"}
                >
                  {state === "updating" && (
                    <>
                      <span className="spinner inline" /> Updating…
                    </>
                  )}
                  {state === "ok" && "✓ Updated"}
                  {state === "err" && "Retry"}
                  {state === "idle" && "Update"}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={footer}>
        <button
          className="btn"
          type="button"
          onClick={() => void onRefresh()}
          disabled={running}
          title="Probe Origins now (resets known updates against the latest tree hashes)."
        >
          <Icon name="refresh" size="sm" /> Refresh
        </button>
        <div style={{ flexGrow: 1 }} />
        <button
          className="btn primary"
          type="button"
          onClick={() => void updateAll()}
          disabled={running || entries.length === 0}
        >
          {running ? (
            <>
              <span className="spinner inline" /> Updating all…
            </>
          ) : (
            `Update all (${entries.length})`
          )}
        </button>
      </div>
    </Modal>
  );
}

const countBadge: React.CSSProperties = {
  display: "inline-block",
  marginLeft: 6,
  padding: "1px 8px",
  borderRadius: 12,
  background: "var(--accent-dim, rgba(59, 130, 246, 0.18))",
  color: "var(--accent)",
  fontSize: 12,
  fontWeight: 700,
  verticalAlign: "middle",
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-3)",
  margin: "8px 0 12px",
  lineHeight: 1.5,
};

const list: React.CSSProperties = {
  flexGrow: 1,
  overflowY: "auto",
  borderTop: "1px solid var(--border)",
  marginTop: 4,
  paddingTop: 12,
};

const row: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "8px 0",
  borderBottom: "1px solid var(--border)",
};

const rowMain: React.CSSProperties = {
  flexGrow: 1,
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 0,
};

const rowName: React.CSSProperties = {
  fontSize: 13,
  fontFamily: "var(--font-mono)",
};

const rowRepo: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-3)",
};

const rowActions: React.CSSProperties = {
  display: "flex",
  gap: 6,
};

const emptyState: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: 24,
  color: "var(--text-3)",
  fontSize: 13,
};

const footer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  paddingTop: 12,
  borderTop: "1px solid var(--border)",
};
