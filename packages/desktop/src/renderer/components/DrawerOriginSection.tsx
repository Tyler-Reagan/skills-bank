import React, { useEffect, useRef, useState } from "react";
import type { RegistryEntry } from "@skills-bank/core";
import { useIpcQuery } from "../hooks/useIpcQuery.js";

function formatStarCount(stars: number): string {
  if (stars >= 1000)
    return `${(stars / 1000).toFixed(stars >= 10000 ? 0 : 1)}k`;
  return String(stars);
}

interface Props {
  entry: RegistryEntry;
  isRegistered: boolean;
  showOriginActivity?: boolean;
  onSetManualUpstream?: (
    choice:
      | { kind: "github"; repo: string; skillPath: string }
      | { kind: "none" },
  ) => Promise<{ ok: boolean; message: string }>;
}

/**
 * Renders the Origin section of SkillDetailDrawer: the manual-link
 * picker for unlinked-adopted skills, and the origin metadata display
 * (repo link, stars, path, last-fetched, last-commit) for linked skills.
 * Owns its own picker UI state and the IPC queries for repo metadata.
 */
export function DrawerOriginSection({
  entry,
  isRegistered,
  showOriginActivity,
  onSetManualUpstream,
}: Props): React.ReactElement | null {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRepo, setPickerRepo] = useState("");
  const [pickerPath, setPickerPath] = useState("");
  const [pickerBusy, setPickerBusy] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const pickerRepoRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (pickerOpen) pickerRepoRef.current?.focus();
  }, [pickerOpen]);

  const upstreamRepo = entry.source.origin?.repo;
  const upstreamSkillPath = entry.source.origin?.skillPath;

  const { data: repoMeta } = useIpcQuery(
    () => window.skillsBank.originRepoMetadata(upstreamRepo!),
    [upstreamRepo],
    { enabled: Boolean(upstreamRepo) },
  );

  const { data: lastCommit } = useIpcQuery(
    () => window.skillsBank.originLastCommit(upstreamRepo!, upstreamSkillPath!),
    [upstreamRepo, upstreamSkillPath, showOriginActivity],
    {
      enabled: Boolean(showOriginActivity && upstreamRepo && upstreamSkillPath),
    },
  );

  const showLinkPicker =
    isRegistered &&
    entry.adopted !== false &&
    !entry.source.origin &&
    onSetManualUpstream;

  const showOriginDisplay =
    entry.source.origin?.kind === "github" && entry.source.origin.repo;

  if (!showLinkPicker && !showOriginDisplay) return null;

  return (
    <>
      {showLinkPicker && (
        <div className="drawer-section">
          <h3>Origin</h3>
          {!pickerOpen ? (
            <div className="origin-picker-row">
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setPickerOpen(true);
                  setPickerError(null);
                }}
              >
                Link origin
              </button>
              <span className="origin-picker-sep">·</span>
              <button
                type="button"
                className="link-btn"
                disabled={pickerBusy}
                onClick={async () => {
                  setPickerBusy(true);
                  await onSetManualUpstream!({ kind: "none" });
                  setPickerBusy(false);
                }}
              >
                Mark as local
              </button>
            </div>
          ) : (
            <div>
              <div className="form-field">
                <label htmlFor="picker-repo">Repo</label>
                <input
                  id="picker-repo"
                  ref={pickerRepoRef}
                  type="text"
                  className="input"
                  placeholder="owner/name"
                  value={pickerRepo}
                  onChange={(e) => setPickerRepo(e.target.value)}
                  disabled={pickerBusy}
                />
                <p className="form-field-hint">e.g. vercel-labs/skills</p>
              </div>
              <div className="form-field">
                <label htmlFor="picker-path">Path</label>
                <input
                  id="picker-path"
                  type="text"
                  className="input"
                  placeholder="skills/my-skill/SKILL.md"
                  value={pickerPath}
                  onChange={(e) => setPickerPath(e.target.value)}
                  disabled={pickerBusy}
                />
                <p className="form-field-hint">
                  Path to SKILL.md within the repo
                </p>
              </div>
              {pickerError && (
                <p className="origin-picker-error" role="alert">
                  {pickerError}
                </p>
              )}
              <div className="origin-picker-btn-row">
                <button
                  type="button"
                  className="btn primary"
                  disabled={
                    pickerBusy || !pickerRepo.trim() || !pickerPath.trim()
                  }
                  onClick={async () => {
                    setPickerBusy(true);
                    setPickerError(null);
                    const r = await onSetManualUpstream!({
                      kind: "github",
                      repo: pickerRepo.trim(),
                      skillPath: pickerPath.trim(),
                    });
                    if (!r.ok) {
                      setPickerError(r.message);
                      setPickerBusy(false);
                    } else {
                      setPickerOpen(false);
                      setPickerBusy(false);
                    }
                  }}
                >
                  {pickerBusy ? (
                    <>
                      <span className="spinner inline" /> Validating
                    </>
                  ) : (
                    "Link"
                  )}
                </button>
                <button
                  type="button"
                  className="link-btn"
                  disabled={pickerBusy}
                  onClick={() => {
                    setPickerOpen(false);
                    setPickerError(null);
                  }}
                  aria-label="Cancel linking an origin"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {showOriginDisplay && entry.source.origin?.repo && (
        <div className="drawer-section">
          <h3>Origin</h3>
          <div className="drawer-meta-row">
            <span className="drawer-meta-key">from</span>
            <span className="drawer-meta-value">
              <button
                type="button"
                className="link-btn"
                onClick={() =>
                  void window.skillsBank.openExternal(
                    `https://github.com/${entry.source.origin!.repo!}`,
                  )
                }
                title="Open the source repo on GitHub"
              >
                github.com/{entry.source.origin.repo}
              </button>
              {repoMeta?.stars !== null && repoMeta?.stars !== undefined && (
                <span
                  className="origin-star-count"
                  title={`${repoMeta.stars} stars on GitHub`}
                >
                  ★ {formatStarCount(repoMeta.stars)}
                </span>
              )}
            </span>
          </div>
          {repoMeta?.description && (
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">about</span>
              <span className="drawer-meta-value prose">
                {repoMeta.description}
              </span>
            </div>
          )}
          {entry.source.origin.skillPath && (
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">path in repo</span>
              <span className="drawer-meta-value">
                <button
                  type="button"
                  className="link-btn"
                  onClick={() => {
                    const repo = entry.source.origin!.repo!;
                    const skillPath = entry.source.origin!.skillPath!;
                    const folder = skillPath.replace(/\/SKILL\.md$/, "");
                    void window.skillsBank.openExternal(
                      `https://github.com/${repo}/tree/HEAD/${folder}`,
                    );
                  }}
                  title="Open the skill's folder on GitHub"
                >
                  {entry.source.origin.skillPath.replace(/\/SKILL\.md$/, "/")}
                </button>
              </span>
            </div>
          )}
          {entry.source.origin.skillFolderHash && (
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">fetched hash</span>
              <span className="drawer-meta-value">
                <code>{entry.source.origin.skillFolderHash.slice(0, 7)}</code>
              </span>
            </div>
          )}
          {entry.source.origin.fetchedAt && (
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">last fetched</span>
              <span className="drawer-meta-value">
                {new Date(entry.source.origin.fetchedAt).toLocaleDateString()}
              </span>
            </div>
          )}
          {showOriginActivity && lastCommit?.sha && lastCommit?.date && (
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">last Origin commit</span>
              <span className="drawer-meta-value">
                {new Date(lastCommit.date).toLocaleDateString()} ·{" "}
                <code>{lastCommit.sha.slice(0, 7)}</code>
                {lastCommit.message && (
                  <span
                    className="origin-commit-msg"
                    title={lastCommit.message}
                  >
                    {lastCommit.message.length > 60
                      ? lastCommit.message.slice(0, 60)
                      : lastCommit.message}
                  </span>
                )}
              </span>
            </div>
          )}
        </div>
      )}
    </>
  );
}
