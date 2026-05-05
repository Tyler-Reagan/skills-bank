import React, { useEffect, useState } from "react";
import type {
  InstalledSkill,
  MigrationAction,
  ScanReport,
} from "@skills-bank/core";

interface Props {
  onClose: () => void | Promise<void>;
  onFlash: (msg: string) => void;
}

type ChoiceMap = Record<string, MigrationAction>;

export function MigrateModal({ onClose, onFlash }: Props): React.ReactElement {
  const [report, setReport] = useState<ScanReport | null>(null);
  const [choices, setChoices] = useState<ChoiceMap>({});
  const [busy, setBusy] = useState(false);
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
        <div style={modal}>
          <h2 style={{ marginTop: 0 }}>Scan failed</h2>
          <p style={{ color: "#dc7f7f", fontFamily: "monospace", fontSize: 13 }}>
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
        <div style={modal}>
          <h2 style={{ marginTop: 0 }}>Scanning for existing skills…</h2>
          <p style={{ color: "#aaa", fontSize: 13 }}>
            Inspecting <code>~/.claude/skills/</code> and classifying each entry as
            already-integrated, foreign symlink, real directory, or broken link.
          </p>
          {skillsDirHint && (
            <p style={{ color: "#888", fontSize: 12, fontFamily: "monospace" }}>
              registry: {skillsDirHint}
            </p>
          )}
          <div style={spinnerWrap}>
            <div style={spinner} />
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
        <div style={modal}>
          <h2 style={{ marginTop: 0 }}>Nothing to migrate</h2>
          <p style={{ color: "#aaa", fontSize: 13 }}>
            Scanned <code>{report.claudeSkillsDir}</code> and found no entries.
          </p>
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
    setBusy(true);
    const items = report.entries.map((e) => ({
      name: e.name,
      action: choices[e.name] ?? defaultAction(e),
    }));
    const results = await window.skillsBank.migrate(items);
    const ok = results.filter((r) => r.ok).length;
    onFlash(`migration: ${ok}/${results.length} succeeded`);
    setBusy(false);
    await onClose();
  };

  return (
    <div style={overlay}>
      <div style={modal}>
        <h2 style={{ marginTop: 0 }}>Migrate existing skills</h2>
        <p style={{ color: "#aaa", fontSize: 13 }}>
          Registry: {report.registryRoot}
          <br />
          Skills dir: {report.claudeSkillsDir}
        </p>
        <div style={{ maxHeight: 400, overflow: "auto", marginBottom: 16 }}>
          {report.entries.map((e) => (
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
                    [e.name]: actionFor(ev.target.value as MigrationAction["type"], e),
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
          <button className="primary" disabled={busy} onClick={() => void apply()}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>
      </div>
    </div>
  );
}

function defaultAction(e: InstalledSkill): MigrationAction {
  switch (e.kind) {
    case "ours":
      return { type: "skip", name: e.name };
    case "broken-symlink":
      return { type: "remove", name: e.name };
    case "foreign-symlink":
      return { type: "register-external", name: e.name };
    case "real-directory":
      return { type: "adopt", name: e.name, category: "meta" };
  }
}

function actionsFor(e: InstalledSkill): Array<{ value: MigrationAction["type"]; label: string }> {
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

function actionFor(type: MigrationAction["type"], e: InstalledSkill): MigrationAction {
  switch (type) {
    case "adopt":
      return { type: "adopt", name: e.name, category: "meta" };
    case "register-external":
      return { type: "register-external", name: e.name };
    case "remove":
      return { type: "remove", name: e.name };
    case "skip":
      return { type: "skip", name: e.name };
  }
}

const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modal: React.CSSProperties = {
  background: "#1e1e22",
  border: "1px solid #444",
  borderRadius: 8,
  padding: 24,
  width: 720,
  maxWidth: "90vw",
};

const spinnerWrap: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "24px 0",
};

const spinner: React.CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid #2a2a2e",
  borderTopColor: "#4a9eff",
  borderRadius: "50%",
  animation: "skills-bank-spin 0.8s linear infinite",
};
