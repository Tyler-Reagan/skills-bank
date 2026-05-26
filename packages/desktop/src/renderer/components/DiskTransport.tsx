import React, { useEffect } from "react";
import type { ImportRegistryManifestResult } from "@skills-bank/core";

interface Props {
  mode: "export" | "import";
  importingManifest: boolean;
  onCancelImport: () => void;
  onImportComplete: (result: ImportRegistryManifestResult) => void;
  onExportComplete: (msg: string) => void;
  onError: (msg: string) => void;
}

/**
 * Thin wrapper around the existing OS-dialog-based manifest export /
 * import flow. Calls the appropriate IPC on mount and reports the
 * result back up. No new logic — disk transport is the legacy path
 * preserved as the fallback inside ManifestModal.
 */
export function DiskTransport({
  mode,
  importingManifest,
  onCancelImport,
  onImportComplete,
  onExportComplete,
  onError,
}: Props): React.ReactElement {
  useEffect(() => {
    if (mode === "export") {
      void window.skillsBank.exportManifest().then((r) => {
        if (r.ok) {
          const where = r.destPath
            ? ` (${r.destPath.split("/").pop() ?? r.destPath})`
            : "";
          onExportComplete(
            `Exported ${r.skillCount ?? 0} skill${r.skillCount === 1 ? "" : "s"}${where}`,
          );
        } else if (r.message && r.message !== "export cancelled") {
          onError(r.message);
        }
      });
    } else {
      void window.skillsBank.importManifest().then((r) => {
        if (!r.ok) {
          if (r.message && r.message !== "cancelled") onError(r.message);
        } else {
          onImportComplete(r.result);
        }
      });
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (mode === "import" && importingManifest) {
    return (
      <div style={{ textAlign: "center", padding: "24px 0" }}>
        <span className="spinner inline" /> Importing…
        <div style={{ marginTop: 12 }}>
          <button className="btn" type="button" onClick={onCancelImport}>
            Cancel import
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        textAlign: "center",
        padding: "24px 0",
        color: "var(--text-3)",
        fontSize: 13,
      }}
    >
      {mode === "export" ? "Opening save dialog…" : "Opening file picker…"}
    </div>
  );
}
