import React, { useState } from "react";
import type { SkillDiffFile, SkillDiffResult } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

/**
 * Renders the per-file diff result from `skills:getSkillDiff` for two
 * skill folders. Compact by default: each file collapses to a one-line
 * summary (`+N / -M`); clicking expands to a monospace unified-diff
 * body. Reused across the sync-collision modal and (when the drift
 * drawer rebuild lands) the bundled-skill-edited heal flow.
 *
 * Stays presentational — data acquisition lives in the calling
 * component, which decides which paths to diff and labels each side.
 */
interface Props {
  result: SkillDiffResult | null;
  loading: boolean;
  error?: string | null;
}

export function DiffViewer({ result, loading, error }: Props): React.ReactElement {
  if (loading) {
    return (
      <div className="diff-viewer-state">
        <span className="spinner inline" /> Computing diff
      </div>
    );
  }
  if (error) {
    return (
      <div className="diff-viewer-state diff-viewer-error" role="alert">
        <Icon name="alert-triangle" size="sm" /> {error}
      </div>
    );
  }
  if (!result || result.files.length === 0) {
    return (
      <div className="diff-viewer-state diff-viewer-empty">
        No differences — the two copies match byte-for-byte.
      </div>
    );
  }
  return (
    <div className="diff-viewer">
      <div className="diff-viewer-legend">
        <span>
          <strong>{result.leftLabel}</strong>{" "}
          <span className="diff-legend-swatch removed" aria-hidden="true">
            −
          </span>
        </span>
        <span>→</span>
        <span>
          <strong>{result.rightLabel}</strong>{" "}
          <span className="diff-legend-swatch added" aria-hidden="true">
            +
          </span>
        </span>
      </div>
      <ul className="diff-file-list">
        {result.files.map((f) => (
          <DiffFileRow key={f.path} file={f} />
        ))}
      </ul>
    </div>
  );
}

function DiffFileRow({ file }: { file: SkillDiffFile }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const expandable = file.status === "modified" && file.unifiedDiff.length > 0;
  const statusLabel =
    file.status === "left-only"
      ? "removed (left only)"
      : file.status === "right-only"
        ? "added (right only)"
        : file.status === "binary"
          ? "binary"
          : null;

  return (
    <li className="diff-file-row">
      <button
        type="button"
        className="diff-file-summary"
        onClick={() => setOpen((v) => !v)}
        disabled={!expandable}
        aria-expanded={expandable ? open : undefined}
      >
        <span className="diff-file-chev" aria-hidden="true">
          {expandable ? (open ? "▾" : "▸") : "•"}
        </span>
        <code className="diff-file-path">{file.path}</code>
        {statusLabel ? (
          <span className="diff-file-status">{statusLabel}</span>
        ) : (
          <span className="diff-file-counts">
            <span className="diff-count-added">+{file.added}</span>
            <span className="diff-count-removed">−{file.removed}</span>
          </span>
        )}
      </button>
      {expandable && open && (
        <pre className="diff-file-body" role="region" aria-label={`Diff for ${file.path}`}>
          {renderDiffBody(file.unifiedDiff)}
        </pre>
      )}
    </li>
  );
}

/**
 * Tints `+` and `-` lines in the unified-diff body. Skips the hunk
 * header (`@@ ... @@`) lines for visual calm but keeps them as
 * subdued spans so the line-number anchors stay visible.
 */
function renderDiffBody(unified: string): React.ReactNode {
  const lines = unified.split("\n");
  return lines.map((line, i) => {
    let cls = "diff-line";
    if (line.startsWith("+") && !line.startsWith("+++")) cls += " added";
    else if (line.startsWith("-") && !line.startsWith("---")) cls += " removed";
    else if (line.startsWith("@@")) cls += " hunk";
    else if (line.startsWith("Index:") || line.startsWith("===")) cls += " header";
    return (
      <span key={i} className={cls}>
        {line}
        {i < lines.length - 1 && "\n"}
      </span>
    );
  });
}
