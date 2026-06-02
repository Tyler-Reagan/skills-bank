import React, { useState } from "react";
import type {
  ImportRegistryManifestResult,
  ManifestConflict,
} from "@skills-bank/core";
import type { LinkedRepoMetadata } from "../../shared/ipc.js";
import { Modal, ModalCloseButton, modalHeader } from "./modalStyles.js";
import { RepoTransport } from "./RepoTransport.js";
import { DiskTransport } from "./DiskTransport.js";

interface Props {
  mode: "export" | "import";
  linkedRepo: LinkedRepoMetadata | null;
  appVersion: string;
  importingManifest: boolean;
  onCancelImport: () => void;
  onClose: () => void;
  onImportComplete: (result: ImportRegistryManifestResult) => void;
  onExportComplete: (msg: string) => void;
  /** Clean repo pull-merge — message to flash. */
  onMerged: (msg: string) => void;
  /** Repo pull-merge surfaced conflicts — open the resolver modal. */
  onConflicts: (conflicts: ManifestConflict[]) => void;
}

export function ManifestModal({
  mode,
  linkedRepo,
  importingManifest,
  onCancelImport,
  onClose,
  onImportComplete,
  onExportComplete,
  onMerged,
  onConflicts,
}: Props): React.ReactElement {
  const [transport, setTransport] = useState<"repo" | "disk">(
    linkedRepo ? "repo" : "disk",
  );

  const title = mode === "export" ? "Export manifest" : "Import manifest";

  return (
    <Modal label={title} onClose={onClose} width={480}>
      <div className={modalHeader}>
        <h2 className="mt-0 mb-0">{title}</h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      {linkedRepo && (
        <div className="manifest-transport-toggle">
          <button
            type="button"
            className={`manifest-transport-btn ${transport === "repo" ? "btn primary" : "btn"}`}
            onClick={() => setTransport("repo")}
          >
            {mode === "export" ? "Push to" : "Read from"} repo
          </button>
          <button
            type="button"
            className={`manifest-transport-btn ${transport === "disk" ? "btn primary" : "btn"}`}
            onClick={() => setTransport("disk")}
          >
            Use a file
          </button>
        </div>
      )}

      <div className="manifest-content-wrap">
        {transport === "repo" && linkedRepo ? (
          <RepoTransport
            mode={mode}
            linkedRepo={linkedRepo}
            importingManifest={importingManifest}
            onCancelImport={onCancelImport}
            onExportComplete={(msg) => {
              onExportComplete(msg);
              onClose();
            }}
            onMerged={(msg) => {
              onMerged(msg);
              onClose();
            }}
            onConflicts={(conflicts) => {
              onConflicts(conflicts);
              onClose();
            }}
            onError={() => {
              // error is surfaced inline inside RepoTransport; don't auto-close
            }}
          />
        ) : (
          <DiskTransport
            mode={mode}
            importingManifest={importingManifest}
            onCancelImport={onCancelImport}
            onImportComplete={(result) => {
              onImportComplete(result);
              onClose();
            }}
            onExportComplete={(msg) => {
              onExportComplete(msg);
              onClose();
            }}
            onError={() => {
              onClose();
            }}
          />
        )}
      </div>
    </Modal>
  );
}
