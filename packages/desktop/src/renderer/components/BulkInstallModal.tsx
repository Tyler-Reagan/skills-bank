import React, { useMemo, useRef, useState } from "react";
import { SearchBar } from "./primitives.js";
import type { RegistryEntry } from "@skills-bank/core";
import { categoryDisplayName } from "@skills-bank/core/labels";
import { Modal, ModalCloseButton, modalFooter } from "./modalStyles.js";
import { Icon } from "./Icon.js";
import { useRegistry } from "../RegistryContext.js";
import { useLabels } from "../LabelsContext.js";
import { useSettings } from "../SettingsContext.js";

// ── Types ─────────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "not-installed" | "installed";
type RowStatus = "pending" | "installing" | "done" | "failed";

type Phase =
  | { kind: "select" }
  | {
      kind: "installing";
      rowStatus: Map<string, RowStatus>;
      failReasons: Map<string, string>;
      cancelled: boolean;
    }
  | { kind: "done"; succeeded: number; failed: Map<string, string> };

interface Props {
  onClose: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function BulkInstallModal({ onClose }: Props): React.ReactElement {
  const { visibleRegistry: registry, installed, refresh } = useRegistry();
  const { labelsMap } = useLabels();
  const { settings } = useSettings();

  const installedNames = useMemo(
    () =>
      new Set(installed.filter((i) => i.kind === "ours").map((i) => i.name)),
    [installed],
  );

  const [phase, setPhase] = useState<Phase>({ kind: "select" });
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("not-installed");
  const [selectedNames, setSelectedNames] = useState<Set<string>>(new Set());
  const cancelRef = useRef(false);

  const filteredSkills = useMemo(() => {
    const q = search.toLowerCase();
    return registry
      .filter((e) => {
        if (q && !e.name.toLowerCase().includes(q)) return false;
        if (statusFilter === "not-installed")
          return !installedNames.has(e.name);
        if (statusFilter === "installed") return installedNames.has(e.name);
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [registry, installedNames, search, statusFilter]);

  const installableFiltered = filteredSkills.filter(
    (e) => !installedNames.has(e.name),
  );
  const allFilteredInstallableSelected =
    installableFiltered.length > 0 &&
    installableFiltered.every((e) => selectedNames.has(e.name));

  function toggleSelectAll() {
    if (allFilteredInstallableSelected) {
      const next = new Set(selectedNames);
      for (const e of installableFiltered) next.delete(e.name);
      setSelectedNames(next);
    } else {
      const next = new Set(selectedNames);
      for (const e of installableFiltered) next.add(e.name);
      setSelectedNames(next);
    }
  }

  const installableSelected = Array.from(selectedNames).filter(
    (n) => !installedNames.has(n),
  );

  async function runInstall() {
    if (installableSelected.length === 0) return;
    const names = installableSelected;
    const agents =
      settings.defaultInstallAgents.length > 0
        ? settings.defaultInstallAgents
        : undefined;

    cancelRef.current = false;
    const rowStatus = new Map<string, RowStatus>(
      names.map((n) => [n, "pending"]),
    );
    const failReasons = new Map<string, string>();
    setPhase({
      kind: "installing",
      rowStatus: new Map(rowStatus),
      failReasons: new Map(failReasons),
      cancelled: false,
    });

    for (const name of names) {
      if (cancelRef.current) break;

      rowStatus.set(name, "installing");
      setPhase({
        kind: "installing",
        rowStatus: new Map(rowStatus),
        failReasons: new Map(failReasons),
        cancelled: false,
      });

      try {
        const r = await window.skillsBank.install(name, false, agents);
        if (r.ok) {
          rowStatus.set(name, "done");
        } else {
          rowStatus.set(name, "failed");
          failReasons.set(
            name,
            r.errors?.[0]?.message ?? r.message ?? "install failed",
          );
        }
      } catch (err) {
        rowStatus.set(name, "failed");
        failReasons.set(name, err instanceof Error ? err.message : String(err));
      }
      setPhase({
        kind: "installing",
        rowStatus: new Map(rowStatus),
        failReasons: new Map(failReasons),
        cancelled: cancelRef.current,
      });
    }

    await refresh();
    const succeeded = Array.from(rowStatus.values()).filter(
      (s) => s === "done",
    ).length;
    setPhase({ kind: "done", succeeded, failed: new Map(failReasons) });
  }

  // ── Select phase ──────────────────────────────────────────────────────────

  if (phase.kind === "select") {
    return (
      <Modal label="Install Skills" width={640} onClose={onClose} trapFocus>
        <div className="modal-header">
          <h2 className="mt-0 mb-0">Install Skills</h2>
          <ModalCloseButton onClose={onClose} />
        </div>

        <div className="bulk-install-modal-filters">
          <div className="bulk-install-modal-search">
            <SearchBar
              value={search}
              onChange={setSearch}
              placeholder="Filter skills…"
            />
          </div>
          <select
            className="manage-labels-select"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="not-installed">Not installed</option>
            <option value="installed">Installed</option>
          </select>
        </div>

        <div className="manage-labels-table-header">
          <label className="manage-labels-select-all-label">
            <input
              type="checkbox"
              checked={
                allFilteredInstallableSelected && installableFiltered.length > 0
              }
              onChange={toggleSelectAll}
              disabled={installableFiltered.length === 0}
              aria-label="Select all visible installable skills"
            />
            <span>Select all</span>
          </label>
          <span className="manage-labels-count text-muted text-13">
            {filteredSkills.length} skill
            {filteredSkills.length === 1 ? "" : "s"}
            {selectedNames.size > 0 &&
              ` · ${installableSelected.length} selected`}
          </span>
        </div>

        <div className="manage-labels-list bulk-install-modal-list">
          {filteredSkills.map((entry) => {
            const isInstalled = installedNames.has(entry.name);
            const isChecked = selectedNames.has(entry.name);
            const override = labelsMap[entry.name];
            const category = override?.category ?? null;
            const tags = override?.tags ?? [];

            return (
              <div
                key={entry.name}
                className={`manage-labels-row${isChecked ? " manage-labels-row--selected" : ""}`}
              >
                <input
                  type="checkbox"
                  className="manage-labels-row-check"
                  checked={isChecked}
                  disabled={isInstalled}
                  onChange={() => {
                    if (isInstalled) return;
                    const next = new Set(selectedNames);
                    if (next.has(entry.name)) next.delete(entry.name);
                    else next.add(entry.name);
                    setSelectedNames(next);
                  }}
                  aria-label={`Select ${entry.name}`}
                />
                <span className="manage-labels-row-name">{entry.name}</span>
                <span className="manage-labels-row-category">
                  {category ? (
                    <span className="manage-labels-cat-badge">
                      {categoryDisplayName(category)}
                    </span>
                  ) : (
                    <span className="manage-labels-row-none">—</span>
                  )}
                </span>
                <span className="manage-labels-row-tags">
                  {tags.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="label-chip label-chip--added manage-labels-chip"
                    >
                      {t}
                    </span>
                  ))}
                  {tags.length > 3 && (
                    <span className="manage-labels-row-none">
                      +{tags.length - 3}
                    </span>
                  )}
                  {tags.length === 0 && (
                    <span className="manage-labels-row-none">—</span>
                  )}
                </span>
                <span className="bulk-install-row-status">
                  {isInstalled ? (
                    <span className="bulk-install-status-installed">
                      <Icon name="check" size="sm" /> installed
                    </span>
                  ) : (
                    <span className="manage-labels-row-none">—</span>
                  )}
                </span>
              </div>
            );
          })}
          {filteredSkills.length === 0 && (
            <div className="manage-labels-empty text-muted text-13">
              No skills match the current filters.
            </div>
          )}
        </div>

        <div className={modalFooter}>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={installableSelected.length === 0}
            onClick={() => void runInstall()}
          >
            Install{" "}
            {installableSelected.length > 0 ? installableSelected.length : ""}{" "}
            selected
          </button>
        </div>
      </Modal>
    );
  }

  // ── Installing phase ──────────────────────────────────────────────────────

  if (phase.kind === "installing") {
    const { rowStatus, failReasons, cancelled } = phase;
    const names = Array.from(rowStatus.keys());
    const doneCount = Array.from(rowStatus.values()).filter(
      (s) => s === "done" || s === "failed",
    ).length;
    const currentName = names.find((n) => rowStatus.get(n) === "installing");

    return (
      <Modal label="Installing…" width={640}>
        <div className="modal-header">
          <h2 className="mt-0 mb-0">
            {cancelled
              ? "Cancelled"
              : `Installing ${doneCount + (currentName ? 1 : 0)} of ${names.length}…`}
          </h2>
        </div>

        <div className="manage-labels-list bulk-install-modal-list">
          {names.map((name) => {
            const status = rowStatus.get(name) ?? "pending";
            return (
              <div
                key={name}
                className={`manage-labels-row bulk-install-progress-row bulk-install-progress-row--${status}`}
              >
                <span className="bulk-install-progress-icon">
                  {status === "installing" && (
                    <span className="spinner inline" aria-hidden />
                  )}
                  {status === "done" && <Icon name="check" size="sm" />}
                  {status === "failed" && (
                    <Icon name="alert-triangle" size="sm" />
                  )}
                  {status === "pending" && (
                    <span className="bulk-install-pending-dot" aria-hidden />
                  )}
                </span>
                <span className="manage-labels-row-name">{name}</span>
                <span className="text-13 text-muted bulk-install-progress-label">
                  {status === "installing" && "Installing…"}
                  {status === "done" && "Done"}
                  {status === "failed" && (failReasons.get(name) ?? "Failed")}
                  {status === "pending" && "Pending"}
                </span>
              </div>
            );
          })}
        </div>

        <div className={modalFooter}>
          {!cancelled && (
            <button
              type="button"
              className="btn"
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              Cancel remaining
            </button>
          )}
        </div>
      </Modal>
    );
  }

  // ── Done phase ────────────────────────────────────────────────────────────

  const { succeeded, failed } = phase;
  return (
    <Modal label="Install complete" width={640} onClose={onClose}>
      <div className="modal-header">
        <h2 className="mt-0 mb-0">Install complete</h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      <div className="bulk-install-done-summary">
        <span className="bulk-install-done-stat">
          <Icon name="check" size="md" />
          {succeeded} installed
        </span>
        {failed.size > 0 && (
          <span className="bulk-install-done-stat bulk-install-done-stat--failed">
            <Icon name="alert-triangle" size="md" />
            {failed.size} failed
          </span>
        )}
      </div>

      {failed.size > 0 && (
        <div className="manage-labels-list bulk-install-modal-list">
          {Array.from(failed.entries()).map(([name, reason]) => (
            <div
              key={name}
              className="manage-labels-row bulk-install-progress-row bulk-install-progress-row--failed"
            >
              <Icon name="alert-triangle" size="sm" />
              <span className="manage-labels-row-name">{name}</span>
              <span className="text-13 text-muted">{reason}</span>
            </div>
          ))}
        </div>
      )}

      <div className={modalFooter}>
        <button type="button" className="btn primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
