import React, { useState } from "react";
import type {
  ManifestConflict,
  ManifestDecisions,
  ManifestResolution,
  ManifestSkill,
} from "@skills-bank/core";
import { BulkSelectToolbar, type BulkAction } from "./BulkSelectToolbar.js";
import {
  ConflictActionPicker,
  type PickerOption,
} from "./ConflictActionPicker.js";
import { Modal } from "./modalStyles.js";

interface Props {
  conflicts: ManifestConflict[];
  onClose: () => void;
  onResolve: (decisions: ManifestDecisions) => Promise<void> | void;
}

const ACTIONS: PickerOption<ManifestResolution>[] = [
  {
    value: "keep-mine",
    label: "Keep mine",
    description:
      "Your local entry stays. The incoming change for this skill is dropped.",
  },
  {
    value: "use-theirs",
    label: "Use theirs (replaces mine)",
    description:
      "The incoming entry replaces yours. A remote deletion removes the skill locally.",
  },
  {
    value: "keep-both",
    label: "Keep both (fork mine to <name>-local)",
    description:
      "The incoming version keeps the name; your version forks to <name>-local. Both are kept.",
  },
];

const BULK_ACTIONS: BulkAction<ManifestResolution>[] = [
  { value: "keep-mine", label: "Keep mine" },
  { value: "use-theirs", label: "Use theirs" },
  {
    value: "keep-both",
    label: (
      <>
        Keep both (<code>&lt;name&gt;-local</code>)
      </>
    ),
  },
];

const KIND_LABEL: Record<ManifestConflict["kind"], string> = {
  "both-modified": "changed on both sides",
  "both-added": "added on both sides",
  "ours-modified-theirs-deleted": "you changed it; it was deleted upstream",
  "theirs-modified-ours-deleted": "you deleted it; it changed upstream",
};

/** One-line summary of a manifest entry's shared-intent fields. */
function summarize(skill: ManifestSkill | null): string {
  if (!skill) return "(deleted)";
  const parts: string[] = [skill.source];
  if (skill.category) parts.push(`category: ${skill.category}`);
  if (skill.tags.length > 0) parts.push(`tags: ${skill.tags.join(", ")}`);
  if (skill.origin.kind === "github" && skill.origin.repo) {
    parts.push(`origin: ${skill.origin.repo}`);
  }
  return parts.join(" · ");
}

/**
 * Resolver for three-way manifest-merge conflicts. The metadata sibling
 * of `SyncConflictModal` (which resolves file-content sync
 * collisions): here each row compares the base/ours/theirs *intent*
 * fields rather than a file diff, and the arms are keep-mine /
 * use-theirs / keep-both. Reuses the shared `Modal`,
 * `ConflictActionPicker`, and `BulkSelectToolbar` building blocks.
 */
export function ManifestConflictModal({
  conflicts,
  onClose,
  onResolve,
}: Props): React.ReactElement {
  // Default to keep-mine — the non-destructive choice (no overwrite, no
  // surprise deletion). The user opts into anything riskier.
  const [picks, setPicks] = useState<Record<string, ManifestResolution>>(() => {
    const out: Record<string, ManifestResolution> = {};
    for (const c of conflicts) out[c.name] = "keep-mine";
    return out;
  });
  const [submitting, setSubmitting] = useState(false);

  const setAll = (action: ManifestResolution) => {
    setPicks((prev) => {
      const next = { ...prev };
      for (const c of conflicts) next[c.name] = action;
      return next;
    });
  };

  const apply = async () => {
    setSubmitting(true);
    const decisions: ManifestDecisions = {};
    for (const c of conflicts) {
      const action = picks[c.name];
      if (action) decisions[c.name] = action;
    }
    try {
      await onResolve(decisions);
    } finally {
      setSubmitting(false);
    }
  };

  const counts = (() => {
    let keep = 0;
    let use = 0;
    let both = 0;
    for (const c of conflicts) {
      const a = picks[c.name];
      if (a === "keep-mine") keep += 1;
      else if (a === "use-theirs") use += 1;
      else if (a === "keep-both") both += 1;
    }
    return { keep, use, both };
  })();

  return (
    <Modal
      label="Registry merge conflicts"
      onClose={onClose}
      width={640}
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">Registry merge conflicts</h2>
      <p className="text-muted text-13 mt-4">
        {conflicts.length} skill{conflicts.length === 1 ? "" : "s"} changed in
        both your local registry and the linked repo. Choose what to keep for
        each.
      </p>

      <BulkSelectToolbar
        actions={BULK_ACTIONS}
        onSelectAll={setAll}
        disabled={submitting}
        tally={
          [
            counts.keep > 0 ? `Keep ${counts.keep}` : null,
            counts.use > 0 ? `Use theirs ${counts.use}` : null,
            counts.both > 0 ? `Keep both ${counts.both}` : null,
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
              <span className="text-muted text-12">{KIND_LABEL[c.kind]}</span>
            </div>
            <div className="manifest-conflict-compare text-12">
              <div>
                <span className="text-muted">Yours:</span> {summarize(c.ours)}
              </div>
              <div>
                <span className="text-muted">Theirs:</span>{" "}
                {summarize(c.theirs)}
              </div>
              <div className="text-muted">Base: {summarize(c.base)}</div>
            </div>
            <ConflictActionPicker
              name={`manifest-conflict-${c.name}`}
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
