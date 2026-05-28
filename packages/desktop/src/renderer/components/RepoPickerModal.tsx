import React, { useMemo, useState } from "react";
import { useIpcQuery } from "../hooks/useIpcQuery.js";
import { Icon } from "./Icon.js";
import { Modal } from "./modalStyles.js";

interface Props {
  onClose: () => void;
  onPicked: (repoFullName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

/**
 * Lists the authenticated user's GitHub repos and lets them pick one to
 * use as the registry source. We don't pre-filter by "has skills/" because
 * verifying that across hundreds of repos requires a content API call per
 * repo; instead we validate at pick time and surface the error if the
 * chosen repo lacks a skills/ directory.
 */
export function RepoPickerModal({
  onClose,
  onPicked,
  onSignOut,
}: Props): React.ReactElement {
  // Shared error surface: both the load failure (via onError) and the
  // pick-action failure (below) write here. The `error` state lives
  // outside useIpcQuery because the pick flow needs to clear/set it
  // imperatively.
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  const { data: repos } = useIpcQuery(
    () => window.skillsBank.reposListMine(),
    [],
    { onError: (e) => setError(e.message) },
  );

  const filtered = useMemo(() => {
    if (!repos) return [];
    const q = search.trim().toLowerCase();
    if (!q) return repos;
    return repos.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q),
    );
  }, [repos, search]);

  const pick = async (fullName: string) => {
    setError(null);
    setPicking(fullName);
    try {
      await onPicked(fullName);
    } catch (err) {
      setError((err as Error).message);
      setPicking(null);
    }
  };

  return (
    <Modal
      label="Choose a registry repo"
      onClose={onClose}
      width={640}
      bodyClass="modal-body--no-scroll"
      trapFocus
    >
      <h2 className="mt-0">Choose a registry repo</h2>
      <p className="text-muted text-13 mt-4">
        Pick a repo of yours that contains a <code>skills/</code> directory at
        its root. Each subfolder of <code>skills/</code> should hold a{" "}
        <code>SKILL.md</code> (and optionally a <code>meta.json</code>). The
        chosen repo replaces your current registry; you maintain it on your own
        from then on.
      </p>

      <input
        type="text"
        className="search-input w-full mt-12"
        placeholder="Filter repos"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        autoFocus
      />

      {error && (
        <div role="alert" className="repo-picker-error">
          <Icon name="alert-triangle" size="sm" /> {error}
        </div>
      )}

      <div className="repo-picker-list">
        {repos === null && (
          <p className="text-subtle text-12">
            <span className="spinner inline" /> Loading your repos…
          </p>
        )}
        {repos !== null && filtered.length === 0 && (
          <p className="text-subtle text-12">No repos match your filter.</p>
        )}
        {filtered.map((r) => (
          <button
            key={r.fullName}
            type="button"
            className={`repo-picker-item${picking === r.fullName ? " repo-picker-item--picking" : ""}`}
            disabled={picking !== null}
            onClick={() => void pick(r.fullName)}
          >
            <div className="repo-item-header">
              <strong className="mono text-13">{r.fullName}</strong>
              <span className="inline-center-6">
                {r.isPrivate && (
                  <span className="repo-item-badge">private</span>
                )}
              </span>
            </div>
            {r.description && <p className="repo-item-desc">{r.description}</p>}
            {picking === r.fullName && (
              <p className="repo-item-loading">
                <span className="spinner inline" /> Importing…
              </p>
            )}
          </button>
        ))}
      </div>

      <div className="repo-picker-footer">
        <button
          type="button"
          className="link-btn"
          onClick={() => void onSignOut()}
          disabled={picking !== null}
        >
          Sign out of GitHub
        </button>
        <button
          type="button"
          className="btn"
          onClick={onClose}
          disabled={picking !== null}
        >
          Close
        </button>
      </div>
    </Modal>
  );
}
