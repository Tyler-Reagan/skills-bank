import React, { useState } from "react";
import type { ImportRegistryManifestResult } from "@skills-bank/core";
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
}

export function ManifestModal({
  mode,
  linkedRepo,
  importingManifest,
  onCancelImport,
  onClose,
  onImportComplete,
  onExportComplete,
}: Props): React.ReactElement {
  const [transport, setTransport] = useState<"repo" | "disk">(
    linkedRepo ? "repo" : "disk",
  );

  const title = mode === "export" ? "Export manifest" : "Import manifest";

  return (
    <Modal label={title} onClose={onClose} width={480}>
      <div style={modalHeader}>
        <h2 style={{ margin: 0 }}>{title}</h2>
        <ModalCloseButton onClose={onClose} />
      </div>

      {linkedRepo && (
        <div style={transportToggle}>
          <button
            type="button"
            className={transport === "repo" ? "btn primary" : "btn"}
            style={toggleBtn}
            onClick={() => setTransport("repo")}
          >
            {mode === "export" ? "Push to" : "Read from"} linked GitHub repo
          </button>
          <button
            type="button"
            className={transport === "disk" ? "btn primary" : "btn"}
            style={toggleBtn}
            onClick={() => setTransport("disk")}
          >
            Read from local file system
          </button>
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        {transport === "repo" && linkedRepo ? (
          <RepoTransport
            mode={mode}
            linkedRepo={linkedRepo}
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

const transportToggle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  marginTop: 14,
};

const toggleBtn: React.CSSProperties = {
  flex: 1,
};
