import React, { useMemo, useState } from "react";
import type {
  AgentId,
  ConflictResolveAction,
  ConflictResolveDecision,
  InstalledSkill,
} from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import {
  ConflictResolver,
  type BulkAction,
  type PickerOption,
} from "./ConflictResolver.js";

const KIND_LABEL: Record<InstalledSkill["kind"], string> = {
  ours: "registered",
  "foreign-symlink": "external symlink",
  "real-directory": "duplicate directory",
  "broken-symlink": "broken symlink",
};

interface Props {
  name: string;
  conflicts: InstalledSkill[];
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
  /**
   * When false, hide the "Replace with symlink to registry" action.
   * Used for the unregistered-conflicts flow where there is no
   * registry copy yet to symlink to — the user resolves which copy to
   * keep (delete the others), then registers in a separate step from
   * the Unregistered section. Default `true` preserves the original
   * registered-conflicts behavior.
   */
  allowReplaceWithSymlink?: boolean;
}

const ALL_ACTIONS: PickerOption<ConflictResolveAction>[] = [
  {
    value: "replace-with-symlink",
    label: "Replace with symlink to registry",
    description:
      "Wipe the duplicate, recreate the agent dir as a symlink to the registry copy. Recommended.",
  },
  {
    value: "delete",
    label: "Delete entirely",
    description:
      "Remove the duplicate without creating a symlink. The agent will no longer have this skill.",
    selectedTone: "danger",
  },
  {
    value: "keep",
    label: "Keep as-is",
    description: "Leave the entry alone. The conflict will resurface later.",
  },
];

const BULK_ACTIONS_FULL: BulkAction<ConflictResolveAction>[] = [
  { value: "replace-with-symlink", label: "Replace" },
  { value: "keep", label: "Keep" },
  { value: "delete", label: "Delete", danger: true },
];

const BULK_ACTIONS_NO_REPLACE: BulkAction<ConflictResolveAction>[] = [
  { value: "keep", label: "Keep" },
  { value: "delete", label: "Delete", danger: true },
];

/**
 * Per-conflict resolver for registered skills that have stragglers
 * elsewhere — e.g. find-skills is symlinked from ~/.claude to the
 * registry copy, but a leftover real directory at ~/.agents/skills/
 * keeps surfacing the skill in "Not registered" until cleaned up.
 *
 * Scope is "registered + has duplicates"; broken symlinks have their
 * own dedicated repair flow (Fix broken link(s) button). Thin domain
 * wrapper over the shared `ConflictResolver` — owns the picks state,
 * the per-agent error surface, and the IPC apply.
 */
export function InstallCollisionModal({
  name,
  conflicts,
  onClose,
  onFlash,
  allowReplaceWithSymlink = true,
}: Props): React.ReactElement {
  // Default per-installation action:
  //   - Registered case → replace-with-symlink (recommended outcome:
  //     converge agent dirs onto the registry copy).
  //   - Unregistered case → keep (non-destructive default; deletion
  //     must be an explicit per-row choice or the bulk "Delete all"
  //     button, both of which trigger the orphan-warning path).
  const defaultAction: ConflictResolveAction = allowReplaceWithSymlink
    ? "replace-with-symlink"
    : "keep";
  const ACTIONS = allowReplaceWithSymlink
    ? ALL_ACTIONS
    : ALL_ACTIONS.filter((a) => a.value !== "replace-with-symlink");
  const [picks, setPicks] = useState<Record<string, ConflictResolveAction>>(
    () => {
      const initial: Record<string, ConflictResolveAction> = {};
      for (const c of conflicts) initial[c.agent] = defaultAction;
      return initial;
    },
  );
  // Per-agent error messages surfaced from the most recent Apply.
  // Keyed by AgentId so each row can show its own failure inline. The
  // modal stays open after a partial/total failure so the user sees
  // *why* — closing on failure gave the user a generic "Resolved 0; N
  // failed" toast with no remediation.
  const [errorMessages, setErrorMessages] = useState<
    Partial<Record<AgentId, string>>
  >({});

  const decisions = useMemo<ConflictResolveDecision[]>(
    () =>
      conflicts.map((c) => ({
        agent: c.agent,
        action: picks[c.agent] ?? "keep",
      })),
    [conflicts, picks],
  );

  const counts = useMemo(() => {
    let keep = 0;
    let del = 0;
    let replace = 0;
    for (const d of decisions) {
      if (d.action === "keep") keep += 1;
      else if (d.action === "delete") del += 1;
      else replace += 1;
    }
    return { keep, del, replace };
  }, [decisions]);

  // Two thresholds drive the confirmation gate:
  //   wouldDeleteAll — every selection is delete. Any bulk delete sweep
  //     deserves a re-affirmation regardless of orphan risk; the
  //     "Delete all" button intentionally produces this state.
  //   wouldOrphan — the stronger case: all-delete AND no registry copy
  //     survives, so the skill is removed from the machine entirely.
  // Both states promote the Apply button to a danger-styled "Confirm
  // delete all"; wouldOrphan adds a stronger warning banner.
  const wouldDeleteAll =
    decisions.length > 0 && decisions.every((d) => d.action === "delete");
  const wouldOrphan = wouldDeleteAll && !allowReplaceWithSymlink;

  const apply = async () => {
    setErrorMessages({});
    const r = await window.skillsBank.resolveSkillConflicts(name, decisions);
    const okCount = r.applied.length;
    const failCount = r.errors.length;
    if (failCount === 0) {
      onFlash(
        `Resolved ${okCount} conflict${okCount === 1 ? "" : "s"} for ${name}`,
      );
      await onClose();
      return;
    }
    // Partial or total failure — keep the modal open and surface
    // each agent's error message so the user can adjust their picks
    // and retry without losing context.
    const messages: Partial<Record<AgentId, string>> = {};
    for (const e of r.errors) messages[e.agent] = e.message;
    setErrorMessages(messages);
    onFlash(
      okCount === 0
        ? `Couldn't resolve ${failCount} conflict${failCount === 1 ? "" : "s"} for ${name}`
        : `Resolved ${okCount}; ${failCount} failed (see details)`,
    );
  };

  const title = allowReplaceWithSymlink
    ? `Resolve install collision — ${name}`
    : `Resolve tracking ambiguity — ${name}`;

  return (
    <ConflictResolver
      title={title}
      width={600}
      intro={
        allowReplaceWithSymlink
          ? `Install collision: ${name} is registered, but some agent directories have stragglers that aren't symlinks to the registry copy. Pick how to handle each.`
          : `Tracking ambiguity: multiple copies of ${name} exist across agent directories — Skills Bank can't tell which one is the real one. All copies are kept by default. Mark individual copies for deletion to remove them; the rest stay where they are. After resolving, you can register this skill from the Unregistered section.`
      }
      items={conflicts}
      itemKey={(c) => c.agent}
      options={ACTIONS}
      bulkActions={
        allowReplaceWithSymlink ? BULK_ACTIONS_FULL : BULK_ACTIONS_NO_REPLACE
      }
      picks={picks}
      defaultAction={defaultAction}
      onPickChange={(key, next) => setPicks((p) => ({ ...p, [key]: next }))}
      onSetAll={(action) => {
        setPicks((prev) => {
          const next = { ...prev };
          for (const c of conflicts) next[c.agent] = action;
          return next;
        });
      }}
      tally={
        [
          counts.keep > 0 ? `Keep ${counts.keep}` : null,
          counts.del > 0 ? `Delete ${counts.del}` : null,
          counts.replace > 0 ? `Replace ${counts.replace}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || "Nothing selected"
      }
      renderRow={(c) => (
        <>
          <div className="conflict-res-row-header">
            <strong>{AGENT_LABELS[c.agent]}</strong>
            <span className="text-subtle text-11">{KIND_LABEL[c.kind]}</span>
          </div>
          <code className="conflict-row-path">{c.linkPath}</code>
          {errorMessages[c.agent] && (
            <div role="alert" className="conflict-row-error">
              {errorMessages[c.agent]}
            </div>
          )}
        </>
      )}
      rowHasError={(c) => !!errorMessages[c.agent]}
      warning={
        wouldDeleteAll ? (
          <div role="alert" className="conflict-delete-warning">
            {wouldOrphan ? (
              <>
                <strong>All copies of {name} will be deleted.</strong> The skill
                will no longer be on this machine. Re-importing from its source
                is the only way back.
              </>
            ) : (
              <>
                <strong>
                  All {decisions.length} conflicting{" "}
                  {decisions.length === 1 ? "entry" : "entries"} will be
                  deleted.
                </strong>{" "}
                The registered installation in Skills Bank stays intact.
              </>
            )}
          </div>
        ) : undefined
      }
      applyLabel={
        Object.keys(errorMessages).length > 0
          ? "Retry"
          : wouldDeleteAll
            ? "Confirm delete all"
            : "Apply"
      }
      applyDanger={wouldDeleteAll}
      onApply={apply}
      onClose={onClose}
    />
  );
}
