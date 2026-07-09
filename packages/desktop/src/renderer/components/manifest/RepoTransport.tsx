import React, { useState } from "react";
import { DisclosureChevron, SkillTagList } from "../primitives.js";
import type { ManifestConflict, ManifestDiff } from "@skills-bank/core";
import type {
  PreviewManifestExportResult,
  ReadManifestFromRepoResult,
} from "../../../shared/ipc.js";
import type { LinkedRepoMetadata } from "../../../shared/ipc.js";
import { useDisclosureSet } from "../../hooks/useDisclosure.js";
import { useIpcQuery } from "../../hooks/useIpcQuery.js";

interface Props {
  mode: "export" | "import";
  linkedRepo: LinkedRepoMetadata;
  importingManifest: boolean;
  onCancelImport: () => void;
  onExportComplete: (msg: string) => void;
  /** Clean pull-merge — message to flash. */
  onMerged: (msg: string) => void;
  /** Pull-merge surfaced conflicts — hand off to the resolver modal. */
  onConflicts: (conflicts: ManifestConflict[]) => void;
  onError: (msg: string) => void;
}

// The preview read is a useIpcQuery; these capture only the imperative
// phases a user action drives on top of it (export / import).
type ExportAction =
  | { kind: "idle" }
  | { kind: "exporting" }
  | {
      kind: "done";
      commitSha: string;
      htmlUrl: string;
      prNumber?: number;
      warning?: string;
    }
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
    <div className="diff-table">
      {DIFF_CATEGORIES.map(({ key, label, color }) => {
        const names = diff[key];
        const expandable = names.length > 0;
        const open = isOpen(key);
        return (
          <div key={key}>
            <button
              type="button"
              className={`diff-row diff-row-button${expandable ? "" : " diff-row-button--static"}`}
              style={{ cursor: expandable ? "pointer" : "default" }}
              onClick={expandable ? () => toggle(key) : undefined}
              aria-expanded={expandable ? open : undefined}
            >
              <span className="diff-label-wrap">
                <DisclosureChevron
                  open={open}
                  style={{
                    color: "var(--text-3)",
                    visibility: expandable ? "visible" : "hidden",
                  }}
                />
                <span className="diff-label">{label}</span>
              </span>
              <span style={{ color }}>{names.length}</span>
            </button>
            {expandable && open && (
              <SkillTagList names={names} className="diff-names" />
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
  onExportComplete,
  onMerged,
  onConflicts,
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
      onMerged={onMerged}
      onConflicts={onConflicts}
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
  const { data, loading } = useIpcQuery<PreviewManifestExportResult>(
    () => window.skillsBank.previewManifestExport(),
    [],
  );
  const [asPR, setAsPR] = useState(false);
  const [action, setAction] = useState<ExportAction>({ kind: "idle" });

  const runExport = async () => {
    setAction({ kind: "exporting" });
    const r = await window.skillsBank.exportManifestToRepo({ asPR });
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
        warning: r.warning,
      });
      const label = r.prNumber
        ? `Manifest exported as PR #${r.prNumber}`
        : `Manifest exported — ${r.skillCount} skill${r.skillCount === 1 ? "" : "s"}`;
      onExportComplete(label);
    }
  };

  if (action.kind === "exporting") {
    return (
      <div className="repo-transport-center">
        <span className="spinner inline" /> Exporting…
      </div>
    );
  }

  if (action.kind === "done") {
    return (
      <div className="repo-transport-done">
        <div className="repo-transport-done-meta">
          Committed <code>{action.commitSha.slice(0, 7)}</code>
          {action.prNumber && ` · PR #${action.prNumber}`}
        </div>
        {action.warning && (
          <div className="repo-transport-warning">⚠ {action.warning}</div>
        )}
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
      <div className="repo-transport-center">
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
      <div className="repo-transport-meta-row">
        <span className="repo-transport-meta-label">{linkedRepo.fullName}</span>
        <span className="repo-transport-meta-detail">
          registry-manifest.json · {data.branch}
        </span>
      </div>
      <div className="repo-transport-skill-count">
        {data.skillCount} skill{data.skillCount === 1 ? "" : "s"} total
      </div>
      <DiffTable diff={data.diff} />
      <div className="repo-transport-toggle-row">
        <label className="repo-transport-toggle-label">
          <input
            type="checkbox"
            checked={asPR}
            onChange={(e) => setAsPR(e.target.checked)}
          />
          Open as pull request
        </label>
      </div>
      <div className="mt-16">
        <button
          className="btn primary"
          type="button"
          onClick={() => void runExport()}
        >
          {asPR ? "Export as PR" : "Commit directly"}
        </button>
      </div>
    </div>
  );
}

function ImportView({
  importingManifest,
  onCancelImport,
  onMerged,
  onConflicts,
  onError,
}: {
  importingManifest: boolean;
  onCancelImport: () => void;
  onMerged: (msg: string) => void;
  onConflicts: (conflicts: ManifestConflict[]) => void;
  onError: (msg: string) => void;
}): React.ReactElement {
  const { data, loading } = useIpcQuery<ReadManifestFromRepoResult>(
    () => window.skillsBank.readManifestFromRepo(),
    [],
  );
  const [action, setAction] = useState<ImportAction>({ kind: "idle" });

  // The button runs a three-way pull-merge (not an additive import): a
  // clean merge reconciles locally; conflicts hand off to the resolver
  // modal. The read above is only the preview diff.
  const runMerge = async () => {
    setAction({ kind: "importing" });
    const r = await window.skillsBank.runManifestMerge();
    if (!r.ok) {
      setAction({ kind: "error", message: r.message });
      onError(r.message);
      return;
    }
    if (r.status === "conflicts") {
      onConflicts(r.conflicts);
    } else {
      onMerged(r.message);
    }
  };

  if (action.kind === "importing" || importingManifest) {
    return (
      <div className="repo-transport-center">
        <span className="spinner inline" /> Importing…
        <div className="mt-12">
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
      <div className="repo-transport-center">
        <span className="spinner inline" /> Reading manifest…
      </div>
    );
  }

  if (!data.ok) {
    if (data.reason === "not-found") {
      return (
        <div className="repo-transport-not-found">
          <div className="repo-transport-not-found-msg">
            No manifest in repo yet — export one first.
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
      <div className="repo-transport-skill-count">
        {data.manifest.skills.length} skill
        {data.manifest.skills.length === 1 ? "" : "s"} in remote manifest
      </div>
      <DiffTable diff={data.diff} />
      <div className="mt-16">
        <button
          className="btn primary"
          type="button"
          onClick={() => void runMerge()}
        >
          Import
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
    <div className="repo-transport-error">
      <strong>Error:</strong> {message}
      {resetAt && (
        <div className="repo-transport-error-reset">
          Rate limited — resets at {formatResetAt(resetAt)}. Sign in to raise
          the limit.
        </div>
      )}
    </div>
  );
}
