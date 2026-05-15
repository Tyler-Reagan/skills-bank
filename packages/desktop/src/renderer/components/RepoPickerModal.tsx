import React, { useEffect, useMemo, useState } from "react";
import { BUNDLED_REPO, type UserRepo } from "../../shared/ipc.js";
import { useFocusReturn } from "../hooks/useFocusReturn.js";
import { useEscapeToClose } from "../hooks/useEscapeToClose.js";
import { Icon } from "./Icon.js";

interface Props {
  onClose: () => void;
  onPicked: (repoFullName: string) => Promise<void>;
  onSignOut: () => Promise<void>;
}

// Synthetic entry for the canonical bundled repo. Plan 02 surfaces this
// as the Recommended row so users who Connect with GitHub can keep the
// curated set with higher rate limits (5000/hr) without finding it in
// the list of their own repos.
const BUNDLED_RECOMMENDATION: UserRepo & { description: string } = {
  fullName: BUNDLED_REPO,
  isPrivate: false,
  defaultBranch: "main",
  description:
    "The curated bundled set shipped with the app. Pick this for the public skills bank with higher (5000/hr) rate limits.",
};

/**
 * Lists the authenticated user's GitHub repos and lets them pick one to
 * use as the registry source. The bundled repo (`Tyler-Reagan/skills-bank`)
 * is pre-listed as the Recommended row so users who Connect with GitHub
 * can stay on the curated set rather than only seeing their own repos.
 *
 * We don't pre-filter user repos by "has skills/" because verifying that
 * across hundreds of repos requires a content API call per repo; instead
 * we validate at pick time and surface the error if the chosen repo lacks
 * a skills/ directory.
 */
export function RepoPickerModal({
  onClose,
  onPicked,
  onSignOut,
}: Props): React.ReactElement {
  useFocusReturn();
  useEscapeToClose(onClose);
  const [repos, setRepos] = useState<UserRepo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await window.skillsBank.reposListMine();
        setRepos(r);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    if (!repos) return [];
    // Inject the bundled-recommendation at the top. If the user's
    // own repo list already contains BUNDLED_REPO (the maintainer's
    // case), drop the duplicate so it only renders once — with the
    // Recommended affordance.
    const withoutDup = repos.filter((r) => r.fullName !== BUNDLED_REPO);
    const merged = [BUNDLED_RECOMMENDATION, ...withoutDup];
    const q = search.trim().toLowerCase();
    if (!q) return merged;
    return merged.filter(
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
    <div style={overlay}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Choose a registry repo"
      >
        <h2 style={{ marginTop: 0 }}>Choose a registry repo</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          Pick a repo of yours that contains a <code>skills/</code> directory at
          its root. Each subfolder of <code>skills/</code> should hold a{" "}
          <code>SKILL.md</code> (and optionally a <code>meta.json</code>). The
          chosen repo replaces your current registry; you maintain it on your
          own from then on.
        </p>

        <input
          type="text"
          className="search-input"
          placeholder="Filter repos"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: "100%", marginTop: 12 }}
          autoFocus
        />

        {error && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: 8,
              background: "var(--danger-dim)",
              border: "1px solid var(--danger)",
              borderRadius: 6,
              color: "var(--danger)",
              fontSize: 12,
            }}
          >
            <Icon name="alert-triangle" size="sm" /> {error}
          </div>
        )}

        <div style={{ marginTop: 12, maxHeight: "55vh", overflowY: "auto" }}>
          {repos === null && (
            <p style={{ color: "var(--text-3)", fontSize: 12 }}>
              <span className="spinner inline" /> Loading your repos
            </p>
          )}
          {repos !== null && filtered.length === 0 && (
            <p style={{ color: "var(--text-3)", fontSize: 12 }}>
              No repos match your filter.
            </p>
          )}
          {filtered.map((r) => (
            <button
              key={r.fullName}
              type="button"
              disabled={picking !== null}
              onClick={() => void pick(r.fullName)}
              style={{
                width: "100%",
                textAlign: "left",
                padding: 10,
                marginBottom: 6,
                background:
                  picking === r.fullName
                    ? "var(--accent-dim)"
                    : "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                cursor: picking ? "wait" : "pointer",
                color: "var(--text)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 8,
                }}
              >
                <strong
                  style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
                >
                  {r.fullName}
                </strong>
                <span style={{ display: "inline-flex", gap: 6 }}>
                  {r.fullName === BUNDLED_REPO && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--accent)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                        fontWeight: 700,
                      }}
                    >
                      recommended
                    </span>
                  )}
                  {r.isPrivate && (
                    <span
                      style={{
                        fontSize: 10,
                        color: "var(--text-3)",
                        textTransform: "uppercase",
                        letterSpacing: "0.05em",
                      }}
                    >
                      private
                    </span>
                  )}
                </span>
              </div>
              {r.description && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 12,
                    color: "var(--text-2)",
                  }}
                >
                  {r.description}
                </p>
              )}
              {picking === r.fullName && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: 11,
                    color: "var(--text-3)",
                  }}
                >
                  <span className="spinner inline" /> Importing
                </p>
              )}
            </button>
          ))}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            marginTop: 12,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
          }}
        >
          <button
            type="button"
            className="link-btn"
            onClick={() => void onSignOut()}
            disabled={picking !== null}
          >
            Sign out of GitHub
          </button>
          <button onClick={onClose} disabled={picking !== null}>
            Close
          </button>
        </div>
      </div>
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
};
