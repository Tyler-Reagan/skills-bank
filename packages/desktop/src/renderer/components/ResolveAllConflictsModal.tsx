import React, { useState } from "react";
import type { InstalledGroup } from "./installedGrouping.js";

interface Props {
  /** The groups to bulk-resolve — non-empty; the host gates rendering on that. */
  target: InstalledGroup[];
  onClose: () => void;
  onFlash: (msg: string) => void;
  refresh: () => Promise<unknown>;
}

/**
 * Bulk "Resolve all conflicts" confirm + sweep, reached from the
 * Installed tab's Needs-attention bulk action. Replaces every duplicate
 * or stale agent-dir entry across the target groups with a symlink to
 * the Skills Bank copy — the same effect as picking "Replace with
 * symlink" per conflict, applied to every skill in one pass.
 *
 * Extracted from ModalHost's inline render: it carries its own
 * multi-step state (`running`/`errors`) and a real async sweep-and-
 * retry loop, distinct from the thin pass-through dialogs ModalHost
 * still renders inline (overwrite, bulk-repair).
 */
export function ResolveAllConflictsModal({
  target,
  onClose,
  onFlash,
  refresh,
}: Props): React.ReactElement {
  const [running, setRunning] = useState(false);
  const [errors, setErrors] = useState<Record<string, string[]> | null>(null);

  const handleResolve = async () => {
    setRunning(true);
    setErrors(null);
    let okCount = 0;
    let failCount = 0;
    const errs: Record<string, string[]> = {};
    for (const g of target) {
      const decisions = g.conflicts.map((c) => ({
        agent: c.agent,
        action: "replace-with-symlink" as const,
      }));
      try {
        const r = await window.skillsBank.resolveSkillConflicts(
          g.name,
          decisions,
        );
        okCount += r.applied.length;
        failCount += r.errors.length;
        if (r.errors.length > 0) {
          errs[g.name] = r.errors.map((e) => `${e.agent}: ${e.message}`);
        }
      } catch (err) {
        failCount += 1;
        errs[g.name] = [(err as Error).message];
      }
    }
    setRunning(false);
    if (failCount === 0) {
      onClose();
      onFlash(
        `Resolved ${okCount} conflict${okCount === 1 ? "" : "s"} across ${target.length} skill${target.length === 1 ? "" : "s"}.`,
      );
      await refresh();
    } else {
      // Leave the dialog open so the user can see per-skill errors and
      // retry — closing here would hide the failures.
      setErrors(errs);
      onFlash(
        okCount === 0
          ? `Couldn't resolve ${failCount} conflict${failCount === 1 ? "" : "s"} (see details)`
          : `Resolved ${okCount}; ${failCount} failed (see details)`,
      );
      await refresh();
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay">
      <div className="resolve-all-body">
        <h3 className="mt-0">Resolve all conflicts ({target.length})?</h3>
        <p className="text-muted text-13">
          For each skill below, every duplicate or stale agent-dir entry will be
          replaced with a symlink to the Skills Bank copy. This is the same as
          picking "Replace with symlink" for each conflict.
        </p>
        <ul className="resolve-all-list">
          {target.map((g) => {
            const skillErrors = errors?.[g.name];
            return (
              <li key={g.name} className="resolve-all-list-item">
                <code
                  className={skillErrors ? "resolve-all-skill-error" : "mono"}
                >
                  {g.name}
                </code>{" "}
                <span className="text-subtle">
                  — {g.conflicts.length} conflict
                  {g.conflicts.length === 1 ? "" : "s"}
                </span>
                {skillErrors && (
                  <ul className="resolve-all-errors-list">
                    {skillErrors.map((m, i) => (
                      <li key={i}>· {m}</li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
        <div className="row-end">
          <button className="btn" onClick={onClose} disabled={running}>
            Cancel
          </button>
          <button
            className="btn warn"
            disabled={running}
            onClick={() => void handleResolve()}
          >
            {running ? (
              <>
                <span className="spinner inline" /> Resolving
              </>
            ) : errors ? (
              "Retry"
            ) : (
              `Resolve ${target.length} skill${target.length === 1 ? "" : "s"}`
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
