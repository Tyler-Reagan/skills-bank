import React, { useEffect, useState } from "react";
import type {
  AgentId,
  InstalledSkill,
  RegistrationAction,
  RegistrationResult,
  ScanReport,
} from "@skills-bank/core";
import { Icon } from "./Icon.js";
import {
  Modal,
  ModalCloseButton,
  modalFooter,
  modalHeader,
} from "./modalStyles.js";

interface Props {
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
  /**
   * Configured install destinations from Settings → Default install
   * agents. When non-empty, registrations fan out symlinks into exactly
   * this agent set — so Register lands a skill in the same dirs that
   * Install would. Undefined / empty preserves the legacy "only relink
   * the originating agent dir" behavior.
   */
  defaultInstallAgents?: AgentId[];
}

/**
 * Choices are keyed by `entryKey(entry)` — a composite of name + agent —
 * not by name alone. The same skill name can appear in multiple agent
 * dirs (e.g. real-directory at `~/.agents/skills/foo` plus stale
 * broken-symlinks in `~/.claude/skills/foo` and `~/.cursor/skills/foo`);
 * each row gets its own action.
 */
type ChoiceMap = Record<string, RegistrationAction>;

function entryKey(e: Pick<InstalledSkill, "name" | "agent">): string {
  return `${e.name} ${e.agent}`;
}

type Phase =
  | { kind: "scan" }
  | { kind: "plan" }
  | { kind: "applying"; total: number }
  | {
      kind: "results";
      results: RegistrationResult[];
      rebuilding: boolean;
      rebuildMessage: string | null;
    };

export function RegistrationPlanModal({
  onClose,
  onFlash,
  defaultInstallAgents,
}: Props): React.ReactElement {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [choices, setChoices] = useState<ChoiceMap>({});
  const [phase, setPhase] = useState<Phase>({ kind: "scan" });
  const [scanError, setScanError] = useState<string | null>(null);
  const [skillsDirHint, setSkillsDirHint] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Show the target path immediately so the user sees what's being scanned.
    void window.skillsBank.getRoot().then((root) => {
      if (!cancelled) setSkillsDirHint(root);
    });
    void window.skillsBank
      .scan()
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        const initial: ChoiceMap = {};
        for (const e of r.entries)
          initial[entryKey(e)] = defaultAction(e, defaultInstallAgents);
        setChoices(initial);
        setPhase({ kind: "plan" });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setScanError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (scanError) {
    return (
      <Modal
        label="Scan failed"
        onClose={() => void onClose()}
        width={720}
        bodyClass="modal-body--no-scroll"
      >
        <div className={modalHeader}>
          <h2 className="mt-0">Scan failed</h2>
          <ModalCloseButton onClose={() => void onClose()} />
        </div>
        <p className="register-modal-error-msg">{scanError}</p>
        <div className={modalFooter}>
          <button onClick={() => void onClose()}>Close</button>
        </div>
      </Modal>
    );
  }

  if (!report) {
    return (
      <Modal
        label="Scanning for existing skills"
        onClose={() => void onClose()}
        width={720}
        bodyClass="modal-body--no-scroll"
      >
        <div className={modalHeader}>
          <h2 className="mt-0">Scanning for existing skills</h2>
          <ModalCloseButton onClose={() => void onClose()} />
        </div>
        <p className="register-modal-hint">
          Inspecting every agent skills dir (Claude, Cursor, Gemini, Copilot,
          Continue, Cline, Codex, shared) and classifying each entry as
          already-integrated, foreign symlink, real directory, or broken link.
        </p>
        {skillsDirHint && (
          <p className="register-modal-registry-hint">
            registry: {skillsDirHint}
          </p>
        )}
        <div className="register-modal-spinner-center">
          <div className="spinner" />
        </div>
      </Modal>
    );
  }

  if (report.entries.length === 0) {
    return (
      <Modal
        label="Nothing to register"
        onClose={() => void onClose()}
        width={720}
        bodyClass="modal-body--no-scroll"
      >
        <div className={modalHeader}>
          <h2 className="mt-0">Nothing to register</h2>
          <ModalCloseButton onClose={() => void onClose()} />
        </div>
        <div className="register-modal-empty">
          <span className="register-modal-empty-icon">
            <Icon name="search" size={32} />
          </span>
          <p className="register-modal-hint">
            Scanned every agent directory (Claude, Cursor, Gemini, Copilot,
            Continue, Cline, Codex, shared) and found nothing to register.
            Broken links and missing files surface automatically in the
            Installed tab's <strong>Needs attention</strong> section.
          </p>
        </div>
        <div className={modalFooter}>
          <button className="primary" onClick={() => void onClose()}>
            Done
          </button>
        </div>
      </Modal>
    );
  }

  const apply = async () => {
    if (!report) return;
    const items = report.entries.map((e) => ({
      name: e.name,
      action: choices[entryKey(e)] ?? defaultAction(e, defaultInstallAgents),
    }));
    setPhase({ kind: "applying", total: items.length });
    const results = await window.skillsBank.register(items);
    // Any successful register moves files into skills/<name>, so a
    // rebuild is needed for the new folders to surface with their meta.
    const registeredCount = results.filter(
      (r) => r.ok && r.action.type === "register",
    ).length;
    setPhase({
      kind: "results",
      results,
      rebuilding: registeredCount > 0,
      rebuildMessage: null,
    });

    if (registeredCount > 0) {
      const r = await window.skillsBank.rebuildIndex();
      setPhase((prev) =>
        prev.kind === "results"
          ? { ...prev, rebuilding: false, rebuildMessage: r.message }
          : prev,
      );
    }
  };

  // Apply-in-progress view — undismissable while IPC is mid-flight.
  if (phase.kind === "applying") {
    return (
      <Modal
        label="Registering skills"
        width={720}
        bodyClass="modal-body--no-scroll"
      >
        <h2 className="mt-0">Registering skills</h2>
        <p className="register-modal-hint">
          Applying {phase.total} action{phase.total === 1 ? "" : "s"}. Files are
          being moved — this may take a moment for large skill bundles.
        </p>
        <div className="register-modal-spinner-center--tall">
          <div className="spinner" />
        </div>
      </Modal>
    );
  }

  // Results view (success/failure summary)
  if (phase.kind === "results") {
    const succeeded = phase.results.filter((r) => r.ok);
    const failed = phase.results.filter((r) => !r.ok);
    const dismiss = () => {
      onFlash(
        `registration: ${succeeded.length}/${phase.results.length} succeeded`,
      );
      void onClose();
    };
    return (
      <Modal
        label={
          failed.length === 0
            ? "Registration complete"
            : `Registration finished with ${failed.length} failure${
                failed.length === 1 ? "" : "s"
              }`
        }
        onClose={phase.rebuilding ? undefined : dismiss}
        width={720}
        bodyClass="modal-body--no-scroll"
      >
        <div className={modalHeader}>
          <h2 className="mt-0">
            {failed.length === 0
              ? "Registration complete"
              : `Registration finished with ${failed.length} failure${
                  failed.length === 1 ? "" : "s"
                }`}
          </h2>
          {!phase.rebuilding && <ModalCloseButton onClose={dismiss} />}
        </div>
        <div className="register-modal-summary">
          <span className="register-modal-summary-chip register-modal-summary-chip--ok">
            <Icon name="check" size="sm" /> {succeeded.length} succeeded
          </span>
          {failed.length > 0 && (
            <span className="register-modal-summary-chip register-modal-summary-chip--err">
              <Icon name="x" size="sm" /> {failed.length} failed
            </span>
          )}
        </div>
        {phase.rebuilding ? (
          <p className="register-modal-rebuilding">
            <span className="spinner inline" /> Rebuilding registry index
          </p>
        ) : phase.rebuildMessage ? (
          <p className="register-modal-rebuild-ok">
            <Icon name="check" size="sm" /> {phase.rebuildMessage}
          </p>
        ) : null}

        <div className="register-modal-result-scroll">
          {phase.results.map((r, i) => (
            <div
              key={`${r.action.type}-${("name" in r.action && r.action.name) || i}`}
              className="register-modal-result-row"
            >
              <span
                className={
                  r.ok
                    ? "register-modal-result-icon--ok"
                    : "register-modal-result-icon--err"
                }
              >
                <Icon name={r.ok ? "check" : "x"} size="sm" />
              </span>
              <span className="register-modal-result-main">
                <code>{describeName(r.action)}</code>
                {" — "}
                <span
                  className={
                    r.ok
                      ? "register-modal-result-msg--ok"
                      : "register-modal-result-msg--err"
                  }
                >
                  {r.message}
                </span>
              </span>
            </div>
          ))}
        </div>
        <div className={modalFooter}>
          <button
            className="primary"
            disabled={phase.rebuilding}
            onClick={dismiss}
          >
            Done
          </button>
        </div>
      </Modal>
    );
  }

  // Plan phase. Only rows with at least one non-skip action are actionable;
  // `ours` entries (skip-only) are filtered out entirely.
  const planEntries = report.entries.filter(
    (e) => actionsFor(e).filter((opt) => opt.value !== "skip").length > 0,
  );
  const currentType = (e: InstalledSkill): RegistrationAction["type"] =>
    choices[entryKey(e)]?.type ?? defaultAction(e, defaultInstallAgents).type;
  // "Apply (N)" counts every row that will actually do something
  // (register or remove) — i.e. anything but skip.
  const actionableCount = planEntries.filter(
    (e) => currentType(e) !== "skip",
  ).length;
  const agentDirCount = Object.values(report.agentDirs).length;
  // Bulk "Set all": apply `type` to every eligible row, leaving rows whose
  // action set doesn't include it untouched.
  const setAll = (type: RegistrationAction["type"]) =>
    setChoices((prev) => {
      const next = { ...prev };
      for (const e of planEntries) {
        if (actionsFor(e).some((opt) => opt.value === type)) {
          next[entryKey(e)] = actionFor(type, e, defaultInstallAgents);
        }
      }
      return next;
    });

  return (
    <Modal
      label="Register existing skills"
      onClose={() => void onClose()}
      width={720}
      bodyClass="modal-body--flex-col"
    >
      <div className={modalHeader}>
        <h2 className="mt-0">Register existing skills</h2>
        <ModalCloseButton onClose={() => void onClose()} />
      </div>
      <p className="register-modal-registry-hint">
        {report.registryRoot} · {agentDirCount} agent director
        {agentDirCount === 1 ? "y" : "ies"} scanned
      </p>
      <div className="register-modal-toolbar">
        <span className="register-modal-count">
          {planEntries.length} skill{planEntries.length === 1 ? "" : "s"} found
        </span>
        <label className="register-modal-bulk">
          Set all
          <select
            aria-label="Set the action for every skill"
            value=""
            onChange={(ev) => {
              if (ev.target.value)
                setAll(ev.target.value as RegistrationAction["type"]);
            }}
          >
            <option value="">Choose…</option>
            <option value="register">Register</option>
            <option value="skip">Skip</option>
          </select>
        </label>
      </div>
      <div className="register-modal-plan-scroll">
        {planEntries.map((e) => {
          const key = entryKey(e);
          return (
            <div className="row" key={key}>
              <div className="meta">
                <h3>
                  {e.name} <span className="tag">{e.kind}</span>{" "}
                  <span className="tag tag-soft">{e.agent}</span>
                </h3>
                <p>{e.target ?? e.linkPath}</p>
              </div>
              <select
                aria-label={`Action for ${e.name}`}
                value={choices[key]?.type ?? "skip"}
                onChange={(ev) =>
                  setChoices((c) => ({
                    ...c,
                    [key]: actionFor(
                      ev.target.value as RegistrationAction["type"],
                      e,
                      defaultInstallAgents,
                    ),
                  }))
                }
              >
                {actionsFor(e).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
      <div className={modalFooter}>
        <button onClick={() => void onClose()}>Cancel</button>
        <button
          className="primary"
          disabled={actionableCount === 0}
          onClick={() => void apply()}
        >
          Apply{actionableCount > 0 ? ` (${actionableCount})` : ""}
        </button>
      </div>
    </Modal>
  );
}

function defaultAction(
  e: InstalledSkill,
  agents: AgentId[] | undefined,
): RegistrationAction {
  const target = { agent: e.agent };
  switch (e.kind) {
    case "ours":
      return { type: "skip", name: e.name, ...target };
    case "broken-symlink":
      return { type: "remove", name: e.name, ...target };
    case "foreign-symlink":
    case "real-directory":
      return { type: "register", name: e.name, agents, ...target };
  }
}

function actionsFor(
  e: InstalledSkill,
): Array<{ value: RegistrationAction["type"]; label: string }> {
  switch (e.kind) {
    case "ours":
      return [{ value: "skip", label: "Skip (already registered)" }];
    case "broken-symlink":
      return [
        { value: "remove", label: "Remove broken symlink" },
        { value: "skip", label: "Skip" },
      ];
    case "foreign-symlink":
    case "real-directory":
      return [
        { value: "register", label: "Register" },
        { value: "skip", label: "Skip" },
      ];
  }
}

function actionFor(
  type: RegistrationAction["type"],
  e: InstalledSkill,
  agents: AgentId[] | undefined,
): RegistrationAction {
  const target = { agent: e.agent };
  switch (type) {
    case "register":
      return { type: "register", name: e.name, agents, ...target };
    case "remove":
      return { type: "remove", name: e.name, ...target };
    case "skip":
      return { type: "skip", name: e.name, ...target };
    case "setAgents":
      // Bulk Register-All flow doesn't expose per-skill agent pickers.
      return { type: "skip", name: e.name, ...target };
  }
}

function describeName(a: RegistrationAction): string {
  switch (a.type) {
    case "skip":
    case "remove":
      return `${a.type}: ${a.name}`;
    case "register":
      return `register: ${a.name} → skills/${a.name}`;
    case "setAgents":
      return `set-agents ${a.name} → ${a.agents.length} agent(s)`;
  }
}
