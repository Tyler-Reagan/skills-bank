import React, { useState } from "react";
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
import { useIpcQuery } from "../hooks/useIpcQuery.js";
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

// The preview read is a useIpcQuery; these capture only the imperative
// phases a user action drives on top of it (push / import).
type ExportAction =
  | { kind: "idle" }
  | { kind: "pushing" }
  | { kind: "done"; commitSha: string; htmlUrl: string; prNumber?: number }
  | { kind: "error"; message: string; resetAt?: string };

type ImportAction =
  | { kind: "idle" }
  | { kind: "importing" }
  | { kind: "error"; message: string };

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
  if (mode === "export") {
    return (
      <ExportView
        linkedRepo={linkedRepo}
        onExportComplete={onExportComplete}
        onError={onError}
      />
    );
  }
  return (
    <ImportView
      importingManifest={importingManifest}
      onCancelImport={onCancelImport}
      onImportComplete={onImportComplete}
      onError={onError}
    />
  );
}

function ExportView({
  linkedRepo,
  onExportComplete,
  onError,
}: {
  linkedRepo: LinkedRepoMetadata;
  onExportComplete: (msg: string) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const { data, loading } = useIpcQuery<PreviewManifestPushResult>(
    () => window.skillsBank.previewManifestPush(),
    [],
  );
  const [asPR, setAsPR] = useState(false);
  const [action, setAction] = useState<ExportAction>({ kind: "idle" });

  const push = async () => {
    setAction({ kind: "pushing" });
    const r = await window.skillsBank.pushManifestToRepo({ asPR });
    if (!r.ok) {
      setAction({
        kind: "error",
        message: r.message,
        resetAt: r.reason === "rate-limit" ? r.rateLimit.resetAt : undefined,
      });
      onError(r.message);
    } else {
      setAction({
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

  if (action.kind === "pushing") {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Pushing…
      </div>
    );
  }

  if (action.kind === "done") {
    return (
      <div style={{ marginTop: 8 }}>
        <div style={{ color: "var(--text-3)", fontSize: 13, marginBottom: 12 }}>
          Committed <code>{action.commitSha.slice(0, 7)}</code>
          {action.prNumber && ` · PR #${action.prNumber}`}
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => void window.skillsBank.openExternal(action.htmlUrl)}
        >
          View on GitHub
        </button>
      </div>
    );
  }

  if (action.kind === "error") {
    return <ErrorBox message={action.message} resetAt={action.resetAt} />;
  }

  if (loading || !data) {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Loading diff…
      </div>
    );
  }

  if (!data.ok) {
    return (
      <ErrorBox message={data.message} resetAt={data.rateLimit?.resetAt} />
    );
  }

  // preview
  return (
    <div>
      <div style={metaRow}>
        <span style={metaLabel}>{linkedRepo.fullName}</span>
        <span style={{ color: "var(--text-3)", fontSize: 12 }}>
          registry-manifest.json · {data.branch}
        </span>
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 10 }}>
        {data.skillCount} skill{data.skillCount === 1 ? "" : "s"} total
      </div>
      <DiffTable diff={data.diff} />
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
  importingManifest,
  onCancelImport,
  onImportComplete,
  onError,
}: {
  importingManifest: boolean;
  onCancelImport: () => void;
  onImportComplete: (result: ImportRegistryManifestResult) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const { data, loading } = useIpcQuery<ReadManifestFromRepoResult>(
    () => window.skillsBank.readManifestFromRepo(),
    [],
  );
  const [action, setAction] = useState<ImportAction>({ kind: "idle" });

  const runImport = async () => {
    setAction({ kind: "importing" });
    const readRes = await window.skillsBank.readManifestFromRepo();
    if (!readRes.ok) {
      const msg =
        readRes.reason === "not-found"
          ? "Manifest not found in repo."
          : ((readRes as { message: string }).message ?? "Unknown error");
      setAction({ kind: "error", message: msg });
      onError(msg);
      return;
    }
    const r = await window.skillsBank.runManifestImport(readRes.manifest);
    if (!r.ok) {
      setAction({ kind: "error", message: r.message });
      onError(r.message);
    } else {
      onImportComplete(r.result);
    }
  };

  if (action.kind === "importing" || importingManifest) {
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

  if (action.kind === "error") {
    return <ErrorBox message={action.message} />;
  }

  if (loading || !data) {
    return (
      <div style={centerHint}>
        <span className="spinner inline" /> Reading manifest…
      </div>
    );
  }

  if (!data.ok) {
    if (data.reason === "not-found") {
      return (
        <div style={centerHint}>
          <div style={{ fontSize: 13, color: "var(--text-3)" }}>
            No manifest in repo yet — push one first.
          </div>
        </div>
      );
    }
    return (
      <ErrorBox
        message={data.message}
        resetAt={
          data.reason === "rate-limit" ? data.rateLimit.resetAt : undefined
        }
      />
    );
  }

  // preview
  return (
    <div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 4 }}>
        Exported:{" "}
        {data.manifest.exportedAt
          ? new Date(data.manifest.exportedAt).toLocaleString()
          : "—"}
      </div>
      <div style={{ color: "var(--text-3)", fontSize: 12, marginBottom: 10 }}>
        {data.manifest.skills.length} skill
        {data.manifest.skills.length === 1 ? "" : "s"} in remote manifest
      </div>
      <DiffTable diff={data.diff} />
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

/** Shared rate-limit-aware error box for the transport phases. */
function ErrorBox({
  message,
  resetAt,
}: {
  message: string;
  resetAt?: string;
}): React.ReactElement {
  return (
    <div style={errorBox}>
      <strong>Error:</strong> {message}
      {resetAt && (
        <div style={{ marginTop: 6, fontSize: 11 }}>
          Rate limited — resets at {formatResetAt(resetAt)}. Sign in to raise
          the limit.
        </div>
      )}
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
