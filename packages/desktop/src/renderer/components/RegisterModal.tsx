import React, { useEffect, useState } from "react";
import type {
  InstalledSkill,
  RegistrationAction,
  RegistrationResult,
  ScanReport,
} from "@skills-bank/core";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

interface Props {
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type ChoiceMap = Record<string, RegistrationAction>;

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

export function RegisterModal({ onClose, onFlash }: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(() => void onClose());
  const [report, setReport] = useState<ScanReport | null>(null);
  const [choices, setChoices] = useState<ChoiceMap>({});
  const [phase, setPhase] = useState<Phase>({ kind: "scan" });
  const [finalizing, setFinalizing] = useState(false);
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
        for (const e of r.entries) initial[e.name] = defaultAction(e);
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
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Scan failed</h2>
          <p
            style={{
              color: "var(--danger)",
              fontFamily: "monospace",
              fontSize: 13,
            }}
          >
            {scanError}
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => void onClose()}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Scanning for existing skills…</h2>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            Inspecting <code>~/.claude/skills/</code> and classifying each entry
            as already-integrated, foreign symlink, real directory, or broken
            link.
          </p>
          {skillsDirHint && (
            <p
              style={{
                color: "var(--text-3)",
                fontSize: 12,
                fontFamily: "monospace",
              }}
            >
              registry: {skillsDirHint}
            </p>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "24px 0",
            }}
          >
            <div className="spinner" />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button onClick={() => void onClose()}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  if (report.entries.length === 0) {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Nothing to register</h2>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            Scanned <code>{report.claudeSkillsDir}</code> and found no entries.
          </p>
          {report.topLevelSymlinks.length > 0 && (
            <FinalizeCallout
              report={report}
              finalizing={finalizing}
              setFinalizing={setFinalizing}
              onFlash={onFlash}
              onAfter={onClose}
              hasUnregistered={false}
            />
          )}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="primary" onClick={() => void onClose()}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  const apply = async () => {
    if (!report) return;
    const items = report.entries.map((e) => ({
      name: e.name,
      action: choices[e.name] ?? defaultAction(e),
    }));
    setPhase({ kind: "applying", total: items.length });
    const results = await window.skillsBank.register(items);
    const adoptedCount = results.filter(
      (r) => r.ok && r.action.type === "adopt",
    ).length;
    setPhase({
      kind: "results",
      results,
      rebuilding: adoptedCount > 0,
      rebuildMessage: null,
    });

    // After adopt actions, regenerate index.json so the new skills register
    // as ours rather than as foreign symlinks on the next scan.
    if (adoptedCount > 0) {
      const r = await window.skillsBank.rebuildIndex();
      setPhase((prev) =>
        prev.kind === "results"
          ? { ...prev, rebuilding: false, rebuildMessage: r.message }
          : prev,
      );
    }
  };

  const stillUnregistered = report.entries.some(
    (e) => e.kind === "real-directory",
  );

  // Apply-in-progress view
  if (phase.kind === "applying") {
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>Registering skills…</h2>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            Applying {phase.total} action{phase.total === 1 ? "" : "s"}. Files
            are being moved/copied — this may take a moment for large skill
            bundles.
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "32px 0",
            }}
          >
            <div className="spinner" />
          </div>
        </div>
      </div>
    );
  }

  // Results view (success/failure summary)
  if (phase.kind === "results") {
    const succeeded = phase.results.filter((r) => r.ok);
    const failed = phase.results.filter((r) => !r.ok);
    return (
      <div style={overlay}>
        <div style={modal} role="dialog" aria-modal="true">
          <h2 style={{ marginTop: 0 }}>
            {failed.length === 0
              ? "Registration complete"
              : `Registration finished with ${failed.length} failure${
                  failed.length === 1 ? "" : "s"
                }`}
          </h2>
          <p style={{ color: "var(--text-2)", fontSize: 13 }}>
            {succeeded.length} of {phase.results.length} succeeded.
          </p>
          {phase.rebuilding ? (
            <p
              style={{
                color: "var(--text-2)",
                fontSize: 12,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <span className="spinner inline" /> Rebuilding registry index…
            </p>
          ) : phase.rebuildMessage ? (
            <p style={{ color: "var(--success)", fontSize: 12 }}>
              <Icon name="check" size="sm" /> {phase.rebuildMessage}
            </p>
          ) : null}

          <div
            style={{
              maxHeight: 320,
              overflow: "auto",
              marginTop: 12,
              marginBottom: 16,
            }}
          >
            {phase.results.map((r, i) => (
              <div
                key={`${r.action.type}-${("name" in r.action && r.action.name) || i}`}
                style={resultRow}
              >
                <span
                  style={{
                    color: r.ok ? "var(--success)" : "var(--danger)",
                    display: "inline-flex",
                    alignItems: "center",
                  }}
                >
                  <Icon name={r.ok ? "check" : "x"} size="sm" />
                </span>
                <span style={{ flex: 1, fontSize: 13 }}>
                  <code style={{ color: "var(--text)" }}>
                    {describeName(r.action)}
                  </code>
                  {" — "}
                  <span
                    style={{ color: r.ok ? "var(--text-2)" : "var(--danger)" }}
                  >
                    {r.message}
                  </span>
                </span>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              className="primary"
              disabled={phase.rebuilding}
              onClick={() => {
                onFlash(
                  `registration: ${succeeded.length}/${phase.results.length} succeeded`,
                );
                void onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true">
        <h2 style={{ marginTop: 0 }}>Register existing skills</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13 }}>
          Registry: {report.registryRoot}
          <br />
          Skills dir: {report.claudeSkillsDir}
        </p>
        {report.topLevelSymlinks.length > 0 && (
          <FinalizeCallout
            report={report}
            finalizing={finalizing}
            setFinalizing={setFinalizing}
            onFlash={onFlash}
            onAfter={onClose}
            hasUnregistered={stillUnregistered}
          />
        )}
        <div style={{ maxHeight: 400, overflow: "auto", marginBottom: 16 }}>
          {report.entries
            .filter(
              (e) =>
                actionsFor(e).filter((opt) => opt.value !== "skip").length > 0,
            )
            .map((e) => (
              <div className="row" key={e.name}>
                <div className="meta">
                  <h3>
                    {e.name} <span className="tag">{e.kind}</span>
                  </h3>
                  <p>{e.target ?? e.linkPath}</p>
                </div>
                <select
                  value={choices[e.name]?.type ?? "skip"}
                  onChange={(ev) =>
                    setChoices((c) => ({
                      ...c,
                      [e.name]: actionFor(
                        ev.target.value as RegistrationAction["type"],
                        e,
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
            ))}
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={() => void onClose()}>Cancel</button>
          <button className="primary" onClick={() => void apply()}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultAction(e: InstalledSkill): RegistrationAction {
  switch (e.kind) {
    case "ours":
      return { type: "skip", name: e.name };
    case "broken-symlink":
      return { type: "remove", name: e.name };
    case "foreign-symlink":
      return { type: "register-external", name: e.name };
    case "real-directory":
      return { type: "adopt", name: e.name };
  }
}

function actionsFor(
  e: InstalledSkill,
): Array<{ value: RegistrationAction["type"]; label: string }> {
  switch (e.kind) {
    case "ours":
      return [{ value: "skip", label: "Skip (already integrated)" }];
    case "broken-symlink":
      return [
        { value: "remove", label: "Remove broken symlink" },
        { value: "skip", label: "Skip" },
      ];
    case "foreign-symlink":
      return [
        { value: "register-external", label: "Register as external" },
        { value: "adopt", label: "Adopt into registry (copy)" },
        { value: "skip", label: "Skip" },
      ];
    case "real-directory":
      return [
        { value: "adopt", label: "Adopt into registry (move)" },
        { value: "skip", label: "Skip" },
      ];
  }
}

function actionFor(
  type: RegistrationAction["type"],
  e: InstalledSkill,
): RegistrationAction {
  switch (type) {
    case "adopt":
      return { type: "adopt", name: e.name };
    case "register-external":
      return { type: "register-external", name: e.name };
    case "remove":
      return { type: "remove", name: e.name };
    case "skip":
      return { type: "skip", name: e.name };
    case "setAgents":
      // Bulk Register-All flow doesn't expose per-skill agent pickers;
      // the user uses the per-card SingleRegisterModal for that.
      return { type: "skip", name: e.name };
  }
}

function describeName(a: RegistrationAction): string {
  switch (a.type) {
    case "skip":
    case "remove":
    case "register-external":
      return `${a.type}: ${a.name}`;
    case "adopt":
      return `register: ${a.name} → skills/${a.name}`;
    case "setAgents":
      return `set-agents ${a.name} → ${a.agents.length} agent(s)`;
  }
}

const resultRow: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 8,
  padding: "6px 0",
  borderBottom: "1px solid var(--border)",
};

function FinalizeCallout(props: {
  report: ScanReport;
  finalizing: boolean;
  setFinalizing: (v: boolean) => void;
  onFlash: (msg: string) => void;
  onAfter: () => void | Promise<void>;
  hasUnregistered: boolean;
}): React.ReactElement {
  const { report, finalizing, setFinalizing, onFlash, onAfter, hasUnregistered } =
    props;
  const [errorDetail, setErrorDetail] = useState<string | null>(null);

  const target = report.topLevelSymlinks[0]?.resolvedTarget;

  const finalize = async () => {
    setErrorDetail(null);
    setFinalizing(true);
    try {
      const r = await window.skillsBank.finalize();
      if (r.ok) {
        onFlash(r.message);
        await onAfter();
      } else {
        setErrorDetail(
          r.blockingEntries
            ? `${r.message}\n\n${r.blockingEntries.map((n) => `  • ${n}`).join("\n")}`
            : r.message,
        );
      }
    } finally {
      setFinalizing(false);
    }
  };

  return (
    <div style={callout}>
      <div style={{ flex: 1 }}>
        <strong
          style={{
            color: "var(--warn)",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          <Icon name="alert-triangle" size="sm" /> Top-level indirection
        </strong>
        <p style={{ margin: "4px 0", fontSize: 12, color: "var(--text)" }}>
          <code>{report.claudeSkillsDir}</code> is itself a symlink →{" "}
          <code>{target}</code>. Registering skills here leaves a double-hop.
          Once everything is registered, finalize to replace the top-level
          symlink with a real directory.
        </p>
        {hasUnregistered && (
          <p
            style={{ margin: "4px 0 0", fontSize: 12, color: "var(--danger)" }}
          >
            Register first — finalize will refuse while real-directory entries
            remain.
          </p>
        )}
        {errorDetail && (
          <pre
            style={{
              margin: "8px 0 0",
              fontSize: 11,
              color: "var(--danger)",
              whiteSpace: "pre-wrap",
            }}
          >
            {errorDetail}
          </pre>
        )}
      </div>
      <button
        disabled={finalizing || hasUnregistered}
        onClick={() => void finalize()}
      >
        {finalizing ? (
          <>
            <span className="spinner inline" /> Finalizing…
          </>
        ) : (
          "Finalize"
        )}
      </button>
    </div>
  );
}

const callout: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
  background: "var(--warn-dim)",
  border: "1px solid var(--warn)",
  borderRadius: 6,
  padding: 12,
  marginBottom: 16,
};

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
  width: 720,
  maxWidth: "90vw",
};
