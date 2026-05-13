import React, { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { UpdateStatus } from "../../shared/ipc.js";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

// State machine for the modal. `available` is the awareness phase — bytes
// haven't been pulled yet. `downloading` is post-consent (user clicked
// Download & install) with live progress. `downloaded` is the final
// confirmation state with an explicit Restart action. Skip and Later are
// available throughout; Skip persists across launches via the main config.
type ModalStatus = Extract<
  UpdateStatus,
  { kind: "available" | "downloading" | "downloaded" }
>;

interface Props {
  status: ModalStatus;
  onClose: () => void;
  onSkip: (version: string) => void;
  onDownload: () => void;
  onRestart: () => void;
}

export function UpdateNotesModal({
  status,
  onClose,
  onSkip,
  onDownload,
  onRestart,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);

  const renderedNotes = useMemo(() => {
    if (!status.releaseNotes) return null;
    const html = marked.parse(status.releaseNotes, {
      breaks: true,
      async: false,
    });
    return DOMPurify.sanitize(html as string);
  }, [status.releaseNotes]);

  const { title, subtitle } = headerCopy(status);

  return (
    <div style={overlay}>
      <div style={modal} role="dialog" aria-modal="true" aria-label={title}>
        <h2 style={{ marginTop: 0 }}>{title}</h2>
        {status.releaseName && status.releaseName !== `v${status.version}` && (
          <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: -8 }}>
            {status.releaseName}
          </p>
        )}
        <p style={{ color: "var(--text-2)", fontSize: 13 }}>{subtitle}</p>

        {status.kind === "downloading" && (
          <DownloadProgress percent={status.percent} />
        )}

        <div style={notesScroll}>
          {renderedNotes ? (
            <div
              className="markdown-body"
              dangerouslySetInnerHTML={{ __html: renderedNotes }}
            />
          ) : (
            <p style={{ color: "var(--text-3)", fontSize: 13 }}>
              No release notes were attached to this release.
            </p>
          )}
        </div>

        <div style={footer}>
          <button
            onClick={() => onSkip(status.version)}
            disabled={status.kind === "downloading"}
            title={
              status.kind === "downloading"
                ? "Download in progress — cancel by quitting and relaunching"
                : "Hide notifications for this version. A newer release will surface again."
            }
          >
            Skip this version
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose}>Later</button>
            {status.kind === "available" && (
              <button className="primary" onClick={onDownload}>
                Download &amp; install
              </button>
            )}
            {status.kind === "downloading" && (
              <button className="primary" disabled>
                Downloading…
              </button>
            )}
            {status.kind === "downloaded" && (
              <button className="primary" onClick={onRestart}>
                Restart now
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function headerCopy(status: ModalStatus): { title: string; subtitle: string } {
  if (status.kind === "available") {
    return {
      title: `Update available: v${status.version}`,
      subtitle:
        "A new version is ready to download. Skills Bank only pulls the bytes after you click Download & install.",
    };
  }
  if (status.kind === "downloading") {
    return {
      title: `Downloading v${status.version}`,
      subtitle:
        "Hang tight — the download runs in the background. You can close this dialog and come back via the badge next to the logo.",
    };
  }
  return {
    title: `Update ready: v${status.version}`,
    subtitle:
      "Restart now to install. Skills Bank will pick up where you left off.",
  };
}

function DownloadProgress({
  percent,
}: {
  percent: number;
}): React.ReactElement {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      style={{
        margin: "4px 0 12px 0",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          flex: 1,
          height: 6,
          background: "var(--border)",
          borderRadius: 999,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamped}%`,
            height: "100%",
            background: "var(--accent)",
            transition: "width 200ms ease",
          }}
        />
      </div>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-2)",
          minWidth: 40,
          textAlign: "right",
        }}
      >
        {Math.round(clamped)}%
      </span>
    </div>
  );
}

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
  width: 640,
  maxWidth: "90vw",
  maxHeight: "85vh",
  display: "flex",
  flexDirection: "column",
};

const notesScroll: React.CSSProperties = {
  flex: 1,
  overflowY: "auto",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: "12px 16px",
  marginBottom: 16,
  fontSize: 13,
  lineHeight: 1.5,
};

const footer: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};
