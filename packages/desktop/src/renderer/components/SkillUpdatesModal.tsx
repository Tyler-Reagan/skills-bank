import React, { useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { parseOwnerRepo } from "@skills-bank/core/origin-url";
import { Icon } from "./Icon.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";

interface Props {
  entries: RegistryEntry[];
  onClose: () => void;
  onUpdate: (name: string) => Promise<{ ok: boolean; message: string }>;
  onView: (entry: RegistryEntry) => void;
  /**
   * Trigger a fresh origin probe (e.g. after the user resolved an
   * outdated entry externally). "Check for updates" button invokes
   * this; the modal then closes so the host re-renders with fresh
   * data.
   */
  onCheckSkillUpdates: () => Promise<void>;
}

type RowState = "idle" | "updating" | "ok" | "err";

/**
 * Aggregate updates modal — one row per skill with an available
 * upstream update. Per-row Update (applies in place) and View
 * (opens the drawer). Update-all sequences the per-row Update
 * action with a small delay between rows so a failing row doesn't
 * block the queue.
 */
export function SkillUpdatesModal({
  entries,
  onClose,
  onUpdate,
  onView,
  onCheckSkillUpdates,
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
      bodyClass="modal-body--w92vw modal-body--flex-col"
      trapFocus
    >
      <div className={modalHeader}>
        <h2 className="mt-0 mb-0">
          Skill updates{" "}
          <span className="updates-modal-count-badge">{entries.length}</span>
        </h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      <p className="updates-modal-hint">
        These skills have a newer version available from their{" "}
        <strong>Origin</strong>. Updating fetches the latest content directly
        from each skill's Origin and mirrors it into your registry — local edits
        are not preserved, so skills you've edited are held out of one-click
        updates.
      </p>

      <div className="updates-modal-list">
        {entries.length === 0 && (
          <div className="updates-modal-empty">
            <Icon name="check" size="md" />
            <span>Every skill is up to date with its Origin.</span>
          </div>
        )}
        {entries.map((e) => {
          const state = states[e.name] ?? "idle";
          const repo = parseOwnerRepo(e.origin.url);
          return (
            <div key={e.name} className="updates-modal-row">
              <div className="updates-modal-row-main">
                <strong className="updates-modal-row-name">{e.name}</strong>
                {repo && <span className="updates-modal-row-repo">{repo}</span>}
              </div>
              <div className="updates-modal-row-actions">
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

      <div className="updates-modal-footer">
        <button
          className="btn"
          type="button"
          onClick={() => void onCheckSkillUpdates()}
          disabled={running}
          title="Probe Origins now (resets known updates against the latest tree hashes)."
        >
          <Icon name="refresh" size="sm" /> Check for updates
        </button>
        <div className="updates-modal-footer-spacer" />
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
