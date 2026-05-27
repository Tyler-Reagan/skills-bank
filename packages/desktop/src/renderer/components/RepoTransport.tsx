import React, { useEffect, useState } from "react";
import type {
  ImportRegistryManifestResult,
  ManifestDiff,
} from "@skills-bank/core";
import type {
  PreviewManifestPushResult,
  ReadManifestFromRepoResult,
} from "../../shared/ipc.js";
import type { LinkedRepoMetadata } from "../../shared/ipc.js";
import { useDisclosureSet } from "../hooks/useDisclosure.js";
import { DisclosureChevron } from "./DisclosureChevron.js";
import { SkillTagList } from "./SkillTagList.js";

interface Props {
  mode: "export" | "import";
  linkedRepo: LinkedRepoMetadata;
  importingManifest: boolean;
  onCancelImport: () => void;
  onImportComplete: (result: ImportRegistryManifestResult) => void;
  onExportComplete: (msg: string) => void;
  onError: (msg: string) => void;
}

type ExportPhase =
  | { kind: "loading" }
  | { kind: "preview"; diff: ManifestDiff; skillCount: number; branch: string }
  | { kind: "pushing" }
  | { kind: "done"; commitSha: string; htmlUrl: string; prNumber?: number }
  | { kind: "error"; message: string; resetAt?: string };

type ImportPhase =
  | { kind: "loading" }
  | { kind: "not-found" }
  | {
      kind: "preview";
      diff: ManifestDiff;
      exportedAt: string;
      skillCount: number;
    }
  | { kind: "importing" }
  | { kind: "error"; message: string; resetAt?: string };

const DIFF_CATEGORIES: {
  key: keyof ManifestDiff;
  label: string;
  color: string;
}[] = [
  { key: "added", label: "Added", color: "var(--green, #4ade80)" },
  { key: "removed", label: "Removed", color: "var(--red, #f87171)" },
  { key: "changed", label: "Changed", color: "var(--yellow, #fbbf24)" },
  { key: "unchanged", label: "Unchanged", color: "var(--text-3)" },
];

/**
 * Per-category breakdown of a manifest diff. Each category with at
 * least one skill is a disclosure row that expands to list which
 * skills fall in it; empty categories stay as a static count.
 */
function DiffTable({ diff }: { diff: ManifestDiff }): React.ReactElement {
  const { isOpen, toggle } = useDisclosureSet();

  return (
    <div style={diffTable}>
      {DIFF_CATEGORIES.map(({ key, label, color }) => {
        const names = diff[key];
        const expandable = names.length > 0;
        const open = isOpen(key);
        return (
          <div key={key}>
            <button
              type="button"
              style={{
                ...diffRow,
                ...diffRowButton,
                cursor: expandable ? "pointer" : "default",
              }}
              onClick={expandable ? () => toggle(key) : undefined}
              aria-expanded={expandable ? open : undefined}
            >
              <span style={diffLabelWrap}>
                <DisclosureChevron
                  open={open}
                  style={{
                    color: "var(--text-3)",
                    visibility: expandable ? "visible" : "hidden",
                  }}
                />
                <span style={diffLabel}>{label}</span>
              </span>
              <span style={{ color }}>{names.length}</span>
            </button>
            {expandable && open && (
              <SkillTagList names={names} style={diffNames} />
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatResetAt(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function RepoTransport({
  mode,
  linkedRepo,
  importingManifest,
  onCancelImport,
  onImportComplete,
  onExportComplete,
  onError,
}: Props): React.ReactElement {
  const [exportPhase, setExportPhase] = useState<ExportPhase>({
    kind: "loading",
  });
  const [importPhase, setImportPhase] = useState<ImportPhase>({
    kind: "loading",
  });
  const [asPR, setAsPR] = useState(false);

  useEffect(() => {
    if (mode === "export") {
      void window.skillsBank
        .previewManifestPush()
        .then((r: PreviewManifestPushResult) => {
          if (!r.ok) {
            setExportPhase({
              kind: "error",
              message: r.message,
              resetAt: r.rateLimit?.resetAt,
            });
          } else {
            setExportPhase({
              kind: "preview",
              diff: r.diff,
              skillCount: r.skillCount,
              branch: r.branch,
            });
          }
        });
    } else {
      void window.skillsBank
        .readManifestFromRepo()
        .then((r: ReadManifestFromRepoResult) => {
          if (!r.ok) {
            if (r.reason === "not-found") {
              setImportPhase({ kind: "not-found" });
            } else if (r.reason === "rate-limit") {
              setImportPhase({
                kind: "error",
                message: r.message,
                resetAt: r.rateLimit?.resetAt,
              });
            } else {
              setImportPhase({ kind: "error", message: r.message });
            }
          } else {
            setImportPhase({
              kind: "preview",
              diff: r.diff,
              exportedAt: r.manifest.exportedAt,
              skillCount: r.manifest.skills.length,
            });
          }
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  // Sync importingManifest → importing phase
  useEffect(() => {
    if (importingManifest && importPhase.kind === "preview") {
      setImportPhase({ kind: "importing" });
    }
  }, [importingManifest, importPhase.kind]);

  if (mode === "export") {
    return (
      <ExportView
        phase={exportPhase}
        asPR={asPR}
        setAsPR={setAsPR}
        linkedRepo={linkedRepo}
        onExportComplete={onExportComplete}
        onError={onError}
        setPhase={setExportPhase}
      />
    );
  }
  return (
    <ImportView
      phase={importPhase}
      importingManifest={importingManifest}
      onCancelImport={onCancelImport}
      onImportComplete={onImportComplete}
      onError={onError}
      setPhase={setImportPhase}
    />
  );
}

function ExportView({
  phase,
  asPR,
  setAsPR,
  linkedRepo,
  onExportComplete,
  onError,
  setPhase,
}: {
  phase: ExportPhase;
  asPR: boolean;
  setAsPR: (v: boolean) => void;
  linkedRepo: LinkedRepoMetadata;
  onExportComplete: (msg: string) => void;
  onError: (msg: string) => void;
  setPhase: (p: ExportPhase) => void;
}): React.ReactElement {
  const push = async () => {
    setPhase({ kind: "pushing" });
    const r = await window.skillsBank.pushManifestToRepo({ asPR });
    if (!r.ok) {
      if (r.reason === "rate-limit") {
        setPhase({
          kind: "error",
          message: r.message,
          resetAt: r.rateLimit?.resetAt,
        });
      } else {
        setPhase({ kind: "error", message: r.message });
      }
      onError(r.message);
    } else {
      setPhase({
        kind: "done",
        commitSha: r.commitSha,
        htmlUrl: r.htmlUrl,
        prNumber: r.prNumber,
      });
      const label = r.prNumber
        ? `Manifest pushed as PR #${r.prNumber}`
        : `Manifest pushed — ${r.skillCount} skill${r.skillCount === 1 ? "" : "s"}`;
      onExportComplete(label);
    }
  };

  if (phase.kind === "loading") {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Loading diff…
      </div>
    );
  }

  if (phase.kind === "pushing") {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Pushing…
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div style={errorBox}>
        <strong>Error:</strong> {phase.message}
        {phase.resetAt && (
          <div style={{ marginTop: 6, fontSize: 11 }}>
            Rate limited — resets at {formatResetAt(phase.resetAt)}. Sign in to
            raise the limit.
          </div>
        )}
      </div>
    );
  }

  if (phase.kind === "done") {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 12 }}>
          Committed <code>{phase.commitSha.slice(0, 7)}</code>
          {phase.prNumber && ` · PR #${phase.prNumber}`}
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => void window.skillsBank.openExternal(phase.htmlUrl)}
        >
          View on GitHub
        </button>
      </div>
    );
  }

  // preview
  return (
    <div>
      <div style={metaRow}>
        <span style={metaLabel}>{linkedRepo.fullName}</span>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>
          registry-manifest.json · {phase.branch}
        </span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 10 }}>
        {phase.skillCount} skill{phase.skillCount === 1 ? "" : "s"} total
      </div>
      <DiffTable diff={phase.diff} />
      <div style={toggleRow}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={asPR}
            onChange={(e) => setAsPR(e.target.checked)}
          />
          Open as pull request
        </label>
      </div>
      <div style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          type="button"
          onClick={() => void push()}
        >
          {asPR ? "Push as PR" : "Commit directly"}
        </button>
      </div>
    </div>
  );
}

function ImportView({
  phase,
  importingManifest,
  onCancelImport,
  onImportComplete,
  onError,
  setPhase,
}: {
  phase: ImportPhase;
  importingManifest: boolean;
  onCancelImport: () => void;
  onImportComplete: (result: ImportRegistryManifestResult) => void;
  onError: (msg: string) => void;
  setPhase: (p: ImportPhase) => void;
}): React.ReactElement {
  const runImport = async () => {
    if (phase.kind !== "preview") return;
    setPhase({ kind: "importing" });
    const readRes = await window.skillsBank.readManifestFromRepo();
    if (!readRes.ok) {
      const msg =
        readRes.reason === "not-found"
          ? "Manifest not found in repo."
          : ((readRes as { message: string }).message ?? "Unknown error");
      setPhase({ kind: "error", message: msg });
      onError(msg);
      return;
    }
    const r = await window.skillsBank.runManifestImport(readRes.manifest);
    if (!r.ok) {
      setPhase({ kind: "error", message: r.message });
      onError(r.message);
    } else {
      onImportComplete(r.result);
    }
  };

  if (phase.kind === "loading") {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Reading manifest…
      </div>
    );
  }

  if (phase.kind === "not-found") {
    return (
      <div style={centerHint}>
        <div style={{ fontSize: 13, color: "var(--text-3)" }}>
          No manifest in repo yet — push one first.
        </div>
      </div>
    );
  }

  if (phase.kind === "importing" || importingManifest) {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Importing…
        <div style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={onCancelImport}>
            Cancel import
          </button>
        </div>
      </div>
    );
  }

  if (phase.kind === "error") {
    return (
      <div style={errorBox}>
        <strong>Error:</strong> {phase.message}
        {phase.resetAt && (
          <div style={{ marginTop: 6, fontSize: 11 }}>
            Rate limited — resets at {formatResetAt(phase.resetAt)}. Sign in to
            raise the limit.
          </div>
        )}
      </div>
    );
  }

  // preview
  return (
    <div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 4 }}>
        Exported:{" "}
        {phase.exportedAt ? new Date(phase.exportedAt).toLocaleString() : "—"}
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 10 }}>
        {phase.skillCount} skill{phase.skillCount === 1 ? "" : "s"} in remote
        manifest
      </div>
      <DiffTable diff={phase.diff} />
      <div style={{ marginTop: 16 }}>
        <button
          className="btn primary"
          type="button"
          onClick={() => void runImport()}
        >
          Import from repo
        </button>
      </div>
    </div>
  );
}

const centerHint: React.CSSProperties = {
  textAlign: "center",
  padding: "24px 0",
  color: "var(--text-3)",
  fontSize: 13,
};

const diffTable: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  background: "var(--surface-hi)",
  borderRadius: 6,
  padding: "10px 12px",
};

const diffRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  fontSize: 13,
};

const diffRowButton: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: 0,
  padding: "2px 0",
  color: "inherit",
  font: "inherit",
  textAlign: "left",
};

const diffLabel: React.CSSProperties = {
  color: "var(--text-3)",
};

const diffLabelWrap: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
};

// Indent the disclosed names under their category row; SkillTagList's
// own class supplies the flex-wrap layout.
const diffNames: React.CSSProperties = {
  padding: "4px 0 6px 16px",
};

const metaRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "baseline",
  marginBottom: 4,
};

const metaLabel: React.CSSProperties = {
  fontWeight: 600,
  fontSize: 13,
};

const toggleRow: React.CSSProperties = {
  marginTop: 14,
};

const errorBox: React.CSSProperties = {
  background: "var(--surface-hi)",
  borderRadius: 6,
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--text-1)",
  marginTop: 8,
};
