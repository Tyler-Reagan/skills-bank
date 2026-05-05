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

  useEffect(() => {
    void window.skillsBank.scan().then((r) => {
      setReport(r);
      const initial: ChoiceMap = {};
      for (const e of r.entries) initial[e.name] = defaultAction(e);
      setChoices(initial);
    });
  }, []);

  if (!report) {
    return (
      <div style={overlay}>
        <div style={modal}>Loading…</div>
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
