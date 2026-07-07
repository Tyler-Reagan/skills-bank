import React, { useRef, useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { parseOwnerRepo } from "@skills-bank/core/origin-url";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";

interface Props {
  entry: RegistryEntry;
  onClose: () => void;
  /** Called after a successful action; closes the modal + refreshes. */
  onDone: (msg: string) => void | Promise<void>;
}

type Busy = null | "repoint" | "rehome" | "detach";

/**
 * Restore an unreachable origin (ADR-0012). Two deterministic,
 * human-driven paths — repoint to a new GitHub URL, or re-home the skill
 * into the linked repo via a PR — plus a "keep local" detach escape for
 * when the upstream is genuinely gone. No auto-discovery (rejected by
 * design: folder names aren't unique, so a guess could repoint to a
 * different skill).
 */
export function RestoreOriginModal({
  entry,
  onClose,
  onDone,
}: Props): React.ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  useFocusTrap(ref, true);
  useEscapeToClose(onClose);

  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [destPath, setDestPath] = useState(`skills/${entry.name}`);

  const wasRepo = parseOwnerRepo(entry.origin.url) ?? undefined;

  const run = async (
    kind: Busy,
    op: () => Promise<{ ok: boolean; message: string }>,
  ): Promise<void> => {
    setBusy(kind);
    setError(null);
    try {
      const r = await op();
      if (r.ok) {
        await onDone(r.message);
      } else {
        setError(r.message);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div role="dialog" aria-modal="true" className="modal-overlay">
      <div ref={ref} tabIndex={-1} className="modal-body">
        <h3 className="mt-0">Restore origin for {entry.name}</h3>
        <p className="text-muted text-13">
          The upstream {wasRepo ? <code>{wasRepo}</code> : "origin"} is
          unreachable — it was deleted, renamed, or reorganized. Point it at the
          new location, or keep the skill by moving it into your linked repo.
        </p>

        {error && (
          <p className="text-13" style={{ color: "var(--red, #f87171)" }}>
            {error}
          </p>
        )}

        <div className="restore-origin-section">
          <label className="restore-origin-label" htmlFor="restore-url">
            Update the source URL
          </label>
          <p className="text-muted text-13">
            Paste the GitHub link to the skill's new folder (the upstream moved
            or was reorganized).
          </p>
          <input
            id="restore-url"
            className="input"
            type="text"
            placeholder="https://github.com/owner/repo/tree/main/path/to/skill"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            disabled={busy !== null}
          />
          <button
            className="btn primary mt-8"
            disabled={busy !== null || url.trim() === ""}
            onClick={() =>
              void run("repoint", () =>
                window.skillsBank.repointOrigin(entry.name, url.trim()),
              )
            }
          >
            {busy === "repoint" ? (
              <>
                <span className="spinner inline" /> Repointing
              </>
            ) : (
              "Repoint"
            )}
          </button>
        </div>

        <div className="restore-origin-section">
          <label className="restore-origin-label" htmlFor="restore-path">
            Move into my linked repo
          </label>
          <p className="text-muted text-13">
            Opens a pull request adding this skill to your linked repo at the
            path below. After you merge it, the skill is re-homed and stays
            installable. Adjust the path and any repo-specific files in the PR.
          </p>
          <input
            id="restore-path"
            className="input"
            type="text"
            placeholder="skills/tools/my-skill"
            value={destPath}
            onChange={(e) => setDestPath(e.target.value)}
            disabled={busy !== null}
          />
          <button
            className="btn mt-8"
            disabled={busy !== null || destPath.trim() === ""}
            onClick={() =>
              void run("rehome", () =>
                window.skillsBank.rehomeIntoLinkedRepo(
                  entry.name,
                  destPath.trim(),
                ),
              )
            }
          >
            {busy === "rehome" ? (
              <>
                <span className="spinner inline" /> Opening PR
              </>
            ) : (
              "Open re-home PR"
            )}
          </button>
        </div>

        <div className="row-end mt-12">
          <button className="btn" disabled={busy !== null} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn ghost"
            disabled={busy !== null}
            onClick={() =>
              void run("detach", () =>
                window.skillsBank.detachLocal(entry.name),
              )
            }
            title="The upstream is gone for good. Keep the skill as a local-only copy and stop tracking it."
          >
            {busy === "detach" ? (
              <>
                <span className="spinner inline" /> Detaching
              </>
            ) : (
              "Keep local (detach)"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
