import React, { useMemo, useState } from "react";
import type {
  AgentId,
  ConflictResolveAction,
  ConflictResolveDecision,
  InstalledSkill,
} from "@skills-bank/core";
import { AGENT_LABELS } from "../agentDisplay.js";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

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

const ALL_ACTIONS: {
  value: ConflictResolveAction;
  label: string;
  description: string;
}[] = [
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
  },
  {
    value: "keep",
    label: "Keep as-is",
    description: "Leave the entry alone. The conflict will resurface later.",
  },
];

/**
 * Per-conflict resolver for registered skills that have stragglers
 * elsewhere — e.g. find-skills is symlinked from ~/.claude to the
 * registry copy, but a leftover real directory at ~/.agents/skills/
 * keeps surfacing the skill in "Not registered" until cleaned up.
 *
 * Scope is "registered + has duplicates"; broken symlinks have their
 * own dedicated repair flow (Fix broken link(s) button).
 */
export function ConflictResolveModal({
  name,
  conflicts,
  onClose,
  onFlash,
  allowReplaceWithSymlink = true,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(() => void onClose());
  // Default per-installation action:
  //   - Registered case → replace-with-symlink (recommended outcome:
  //     converge agent dirs onto the registry copy).
  //   - Unregistered case → keep (non-destructive default; deletion
  //     must be an explicit per-row choice or the bulk "Delete all"
  //     button, both of which trigger the orphan-warning path).
  // The previous unregistered default was delete, which contradicted
  // the modal's intro copy and silently primed every row for removal.
  const defaultAction: ConflictResolveAction = allowReplaceWithSymlink
    ? "replace-with-symlink"
    : "keep";
  const ACTIONS = allowReplaceWithSymlink
    ? ALL_ACTIONS
    : ALL_ACTIONS.filter((a) => a.value !== "replace-with-symlink");
  const [picks, setPicks] = useState<Record<AgentId, ConflictResolveAction>>(
    () => {
      const initial: Partial<Record<AgentId, ConflictResolveAction>> = {};
      for (const c of conflicts) initial[c.agent] = defaultAction;
      return initial as Record<AgentId, ConflictResolveAction>;
    },
  );
  const [submitting, setSubmitting] = useState(false);
  // Per-agent error messages surfaced from the most recent Apply.
  // Keyed by AgentId so each row can show its own failure inline. The
  // modal stays open after a partial/total failure so the user sees
  // *why* — closing on failure was the previous behavior and gave the
  // user a generic "Resolved 0; N failed" toast with no remediation.
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

  // Action tallies for the live summary line under the picker. The
  // counts update as the user toggles individual rows.
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

  const setAll = (action: ConflictResolveAction) => {
    const next: Record<AgentId, ConflictResolveAction> = { ...picks };
    for (const c of conflicts) next[c.agent] = action;
    setPicks(next);
  };

  const apply = async () => {
    setSubmitting(true);
    setErrorMessages({});
    try {
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
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={overlay}
      onClick={() => void onClose()}
      role="presentation"
    >
      <div
        style={modal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 style={{ marginTop: 0 }}>
          {allowReplaceWithSymlink
            ? `Resolve install collision — ${name}`
            : `Resolve tracking ambiguity — ${name}`}
        </h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          {allowReplaceWithSymlink
            ? `Install collision: ${name} is registered, but some agent directories have stragglers that aren't symlinks to the registry copy. Pick how to handle each.`
            : `Tracking ambiguity: multiple copies of ${name} exist across agent directories — Skills Bank can't tell which one is the real one. All copies are kept by default. Mark individual copies for deletion to remove them; the rest stay where they are. After resolving, you can register this skill from the Unregistered section.`}
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 12,
            marginBottom: 12,
            padding: "6px 10px",
            background: "var(--surface-2, rgba(0,0,0,0.03))",
            border: "1px solid var(--border)",
            borderRadius: 6,
          }}
        >
          <span
            style={{
              fontSize: 11,
              color: "var(--text-3)",
              marginRight: 2,
              flexShrink: 0,
            }}
          >
            Select all:
          </span>
          {allowReplaceWithSymlink && (
            <button
              onClick={() => setAll("replace-with-symlink")}
              style={{ fontSize: 12, padding: "2px 8px" }}
            >
              Replace
            </button>
          )}
          <button
            onClick={() => setAll("keep")}
            style={{ fontSize: 12, padding: "2px 8px" }}
          >
            Keep
          </button>
          <button
            onClick={() => setAll("delete")}
            style={{
              fontSize: 12,
              padding: "2px 8px",
              color: "var(--danger, #d04444)",
            }}
          >
            Delete
          </button>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {conflicts.map((c) => (
            <div
              key={c.agent}
              style={{
                border: `1px solid ${errorMessages[c.agent] ? "var(--danger, #d04444)" : "var(--border)"}`,
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
                  marginBottom: 6,
                }}
              >
                <strong>{AGENT_LABELS[c.agent]}</strong>
                <span style={{ color: "var(--text-3)", fontSize: 11 }}>
                  {KIND_LABEL[c.kind]}
                </span>
              </div>
              <code
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "var(--text-3)",
                  marginBottom: 8,
                }}
              >
                {c.linkPath}
              </code>
              {errorMessages[c.agent] && (
                <div
                  role="alert"
                  style={{
                    background: "var(--danger-dim, rgba(208, 68, 68, 0.12))",
                    color: "var(--danger, #d04444)",
                    border: "1px solid var(--danger, #d04444)",
                    borderRadius: 4,
                    padding: "6px 8px",
                    fontSize: 11,
                    marginBottom: 8,
                    fontFamily: "var(--font-mono)",
                  }}
                >
                  {errorMessages[c.agent]}
                </div>
              )}
              {ACTIONS.map((a) => (
                <label
                  key={a.value}
                  style={{
                    display: "block",
                    padding: 6,
                    marginBottom: 4,
                    cursor: "pointer",
                    // Selected-row background distinguishes safe picks
                    // (keep / replace) from risky picks (delete) so the
                    // user can scan the selection state at a glance.
                    background:
                      picks[c.agent] === a.value
                        ? a.value === "delete"
                          ? "var(--danger-dim, rgba(208, 68, 68, 0.18))"
                          : "var(--accent-dim)"
                        : "transparent",
                    borderRadius: 4,
                  }}
                >
                  <input
                    type="radio"
                    name={`conflict-${c.agent}`}
                    checked={picks[c.agent] === a.value}
                    onChange={() =>
                      setPicks((prev) => ({ ...prev, [c.agent]: a.value }))
                    }
                    style={{ marginRight: 8 }}
                  />
                  <strong style={{ fontSize: 13 }}>{a.label}</strong>
                  <p
                    style={{
                      margin: "2px 0 0 24px",
                      fontSize: 11,
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

        {/* Live tally — gives the user a single-glance read on what
            Apply will actually do, complementing the per-row colors. */}
        <p
          style={{
            margin: "8px 0 0",
            fontSize: 12,
            color: counts.del > 0 ? "var(--text-2)" : "var(--text-3)",
          }}
        >
          {[
            counts.keep > 0 ? `Keep ${counts.keep}` : null,
            counts.del > 0 ? `Delete ${counts.del}` : null,
            counts.replace > 0 ? `Replace ${counts.replace}` : null,
          ]
            .filter(Boolean)
            .join(" · ") || "Nothing selected"}
        </p>

        {wouldDeleteAll && (
          <div
            role="alert"
            style={{
              marginTop: 10,
              padding: "10px 12px",
              background: "var(--danger-dim, rgba(208, 68, 68, 0.12))",
              border: "1px solid var(--danger, #d04444)",
              borderRadius: 4,
              color: "var(--danger, #d04444)",
              fontSize: 12,
            }}
          >
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
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            marginTop: 12,
          }}
        >
          <button onClick={() => void onClose()} disabled={submitting}>
            Cancel
          </button>
          <button
            className={wouldDeleteAll ? "btn danger" : "primary"}
            onClick={() => void apply()}
            disabled={submitting}
          >
            {submitting ? (
              <>
                <Icon name="check" size="sm" /> Applying
              </>
            ) : Object.keys(errorMessages).length > 0 ? (
              "Retry"
            ) : wouldDeleteAll ? (
              "Confirm delete all"
            ) : (
              "Apply"
            )}
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
  width: 600,
  maxWidth: "90vw",
};
