import React, { useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { UpdateStatus } from "../../shared/ipc.js";
import { Modal } from "./modalStyles.js";

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
    <Modal
      label={title}
      onClose={onClose}
      width={640}
      bodyClass="modal-body--flex-col"
    >
      <h2 className="mt-0">{title}</h2>
      {status.releaseName && status.releaseName !== `v${status.version}` && (
        <p className="text-muted text-13 mt-neg8">{status.releaseName}</p>
      )}
      <p className="text-muted text-13">{subtitle}</p>

      {status.kind === "downloading" && (
        <DownloadProgress percent={status.percent} />
      )}

      <div className="update-notes-scroll">
        {renderedNotes ? (
          <div
            className="markdown-body"
            dangerouslySetInnerHTML={{ __html: renderedNotes }}
          />
        ) : (
          <p className="text-subtle text-13">
            No release notes were attached to this release.
          </p>
        )}
      </div>

      <div className="update-notes-footer">
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
        <div className="update-notes-footer-right">
          <button onClick={onClose}>Later</button>
          {status.kind === "available" && (
            <button className="primary" onClick={onDownload}>
              Download &amp; install
            </button>
          )}
          {status.kind === "downloading" && (
            <button className="primary" disabled>
              Downloading
            </button>
          )}
          {status.kind === "downloaded" && (
            <button className="primary" onClick={onRestart}>
              Restart now
            </button>
          )}
        </div>
      </div>
    </Modal>
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
    <div className="download-progress">
      <div
        role="progressbar"
        aria-valuenow={Math.round(clamped)}
        aria-valuemin={0}
        aria-valuemax={100}
        className="download-progress-track"
      >
        <div
          className="download-progress-fill"
          style={{ width: `${clamped}%` }}
        />
      </div>
      <span className="download-progress-pct">{Math.round(clamped)}%</span>
    </div>
  );
}
