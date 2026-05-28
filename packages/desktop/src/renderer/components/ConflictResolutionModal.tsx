import React, { useState } from "react";
import type {
  ConflictAction,
  ConflictEntry,
  SyncDecisions,
} from "@skills-bank/core";
import type { SkillDiffResult } from "../../shared/ipc.js";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { BulkSelectToolbar, type BulkAction } from "./BulkSelectToolbar.js";
import {
  ConflictActionPicker,
  type PickerOption,
} from "./ConflictActionPicker.js";
import { DiffViewer } from "./DiffViewer.js";
import { Modal } from "./modalStyles.js";

interface Props {
  conflicts: ConflictEntry[];
  onClose: () => void;
  onResolve: (decisions: SyncDecisions) => Promise<void> | void;
}

const ACTIONS: PickerOption<ConflictAction>[] = [
  {
    value: "keep-mine",
    label: "Keep mine",
    description:
      "Your local version stays. The incoming update for this skill is skipped.",
  },
  {
    value: "use-canonical",
    label: "Use incoming (replaces mine)",
    description:
      "The incoming version replaces yours. Your local changes are lost.",
  },
  {
    value: "rename-mine",
    label: "Rename mine to <name>-local",
    description:
      "Your version moves to <name>-local and the incoming version takes the original name. Both are kept.",
  },
];

const BULK_ACTIONS: BulkAction<ConflictAction>[] = [
  { value: "keep-mine", label: "Keep mine" },
  { value: "use-canonical", label: "Use incoming" },
  {
    value: "rename-mine",
    label: (
      <>
        Rename to <code>&lt;name&gt;-local</code>
      </>
    ),
  },
];

export function ConflictResolutionModal({
  conflicts,
  onClose,
  onResolve,
}: Props): React.ReactElement {
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
    Record<
      string,
      { result: SkillDiffResult | null; loading: boolean; error: string | null }
    >
  >({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const { data: config } = useIpcQuery(() => window.skillsBank.getConfig(), []);
  const registryRoot = config?.registryRoot ?? null;

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
        rightLabel: "Incoming",
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
    <Modal
      label="Incoming update conflicts"
      onClose={onClose}
      width={640}
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">Incoming update conflicts</h2>
      <p className="text-muted text-13 mt-4">
        {conflicts.length} skill{conflicts.length === 1 ? "" : "s"} changed in
        both your local registry and the incoming update. Choose what to keep
        for each — your decision is saved and won't be asked again unless the
        upstream changes.
      </p>

      <BulkSelectToolbar
        actions={BULK_ACTIONS}
        onSelectAll={setAll}
        disabled={submitting}
        tally={
          [
            counts.keep > 0 ? `Keep ${counts.keep}` : null,
            counts.use > 0 ? `Use incoming ${counts.use}` : null,
            counts.rename > 0 ? `Rename ${counts.rename}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing selected"
        }
      />

      <div className="conflict-res-scroll">
        {conflicts.map((c) => (
          <div key={c.name} className="conflict-res-row">
            <div className="conflict-res-row-header">
              <strong className="conflict-res-row-name">{c.name}</strong>
              <button
                type="button"
                className="link-btn conflict-res-compare-btn"
                onClick={() => toggleDiff(c)}
                aria-expanded={!!expanded[c.name]}
              >
                {expanded[c.name] ? "Hide diff" : "Compare changes"}
              </button>
            </div>
            {expanded[c.name] && (
              <div className="conflict-res-diff-wrap">
                <DiffViewer
                  result={diffs[c.name]?.result ?? null}
                  loading={diffs[c.name]?.loading ?? true}
                  error={diffs[c.name]?.error ?? null}
                />
              </div>
            )}
            <ConflictActionPicker
              name={`conflict-${c.name}`}
              options={ACTIONS}
              value={picks[c.name] ?? "keep-mine"}
              onChange={(next) => setPicks((p) => ({ ...p, [c.name]: next }))}
            />
          </div>
        ))}
      </div>

      <div className="row-end mt-12">
        <button onClick={onClose} disabled={submitting}>
          Cancel
        </button>
        <button
          className="primary"
          onClick={() => void apply()}
          disabled={submitting}
        >
          {submitting ? "Applying…" : "Apply"}
        </button>
      </div>
    </Modal>
  );
}
