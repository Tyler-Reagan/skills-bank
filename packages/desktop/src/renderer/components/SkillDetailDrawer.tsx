import React, { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";
import { useFocusReturn, useInitialFocus } from "../hooks/useFocusReturn.js";
import { Icon } from "./Icon.js";

const DESCRIPTION_SOFT_CAP = 400;

interface Props {
  entry: RegistryEntry;
  installed: InstalledSkill[];
  registryRoot: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void | Promise<void>;
  /** Called specifically after a successful uninstall so the host can offer Undo. */
  onUninstalled?: (name: string) => void;
  /** Open the dedicated "Manage agent links" modal for this skill. */
  onManageLinks?: () => void;
  /**
   * Open the conflict-resolve modal for non-ours, non-broken
   * installations of a registered skill (e.g. leftover real-dir
   * duplicates after CLI installs). Only relevant when isRegistered.
   */
  onResolveConflicts?: () => void;
  /**
   * When true, the entry is a real registry-managed skill: tag editing,
   * install/uninstall, and Markdown loading from the registry path all
   * apply. When false, the entry is a synthetic stand-in for a skill
   * that lives only in some agent dir(s); the drawer offers a "Register
   * in registry" action instead, and hides registry-only chrome.
   */
  isRegistered: boolean;
  /**
   * Trigger registration into the registry for a not-yet-registered
   * entry. Required when isRegistered is false; ignored otherwise.
   */
  onRegister?: () => Promise<void> | void;
  /**
   * Optional override of which agent dirs to install into. When omitted,
   * install broadcasts to every existing agent dir (legacy behavior).
   */
  defaultInstallAgents?: import("@skills-bank/core").AgentId[];
}

type ActionState = null | "installing" | "uninstalling" | "exporting" | "registering";

export function SkillDetailDrawer({
  entry,
  installed,
  registryRoot,
  onClose,
  onChanged,
  onUninstalled,
  onManageLinks,
  onResolveConflicts,
  isRegistered,
  onRegister,
  defaultInstallAgents,
}: Props): React.ReactElement {
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillMdLoading, setSkillMdLoading] = useState(true);
  const [action, setAction] = useState<ActionState>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  useFocusReturn();
  useInitialFocus(drawerRef);
  const [descExpanded, setDescExpanded] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const [tagDraft, setTagDraft] = useState<string[]>(entry.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [tagInputError, setTagInputError] = useState<string | null>(null);
  const [savingTags, setSavingTags] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSkillMd(null);
    setSkillMdLoading(true);
    setDescExpanded(false);
    setEditingTags(false);
    setTagDraft(entry.tags ?? []);
    setTagInput("");
    void window.skillsBank.readSkillMd(entry.name).then((md) => {
      if (!cancelled) {
        setSkillMd(md);
        setSkillMdLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name, entry.tags]);

  // Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isInstalled = installed.some(
    (i) => i.name === entry.name && i.kind === "ours",
  );
  const brokenInstallations = installed.filter(
    (i) => i.name === entry.name && i.kind === "broken-symlink",
  );
  const hasBrokenLinks = brokenInstallations.length > 0;
  // Non-ours, non-broken stragglers for a REGISTERED skill = duplicates
  // / stale external links that need conflict resolution. Only
  // meaningful when the skill is in the registry; for purely
  // not-registered skills these would be the only installations.
  const conflictInstallations =
    isRegistered && isInstalled
      ? installed.filter(
          (i) =>
            i.name === entry.name &&
            i.kind !== "ours" &&
            i.kind !== "broken-symlink",
        )
      : [];
  const hasConflicts = conflictInstallations.length > 0;
  const [repairState, setRepairState] = useState<
    | { kind: "idle" }
    | { kind: "running" }
    | { kind: "confirm-delete"; agents: import("@skills-bank/core").AgentId[]; reasons: string[] }
  >({ kind: "idle" });

  const repairOrRemoveBroken = async () => {
    setRepairState({ kind: "running" });
    const report = await window.skillsBank.repairBrokenLinks(entry.name);
    if (report.unrepairable.length === 0) {
      setRepairState({ kind: "idle" });
      await onChanged(
        report.repaired.length > 0
          ? `Repaired ${report.repaired.length} broken link(s) for ${entry.name}`
          : `No broken links for ${entry.name}`,
      );
      return;
    }
    setRepairState({
      kind: "confirm-delete",
      agents: report.unrepairable.map((u) => u.agent),
      reasons: report.unrepairable.map(
        (u) => `${u.linkPath}: ${u.reason}`,
      ),
    });
  };

  const confirmDeleteBroken = async () => {
    if (repairState.kind !== "confirm-delete") return;
    setRepairState({ kind: "running" });
    const report = await window.skillsBank.removeBrokenLinks(
      entry.name,
      repairState.agents,
    );
    setRepairState({ kind: "idle" });
    if (report.errors.length > 0) {
      await onChanged(
        `Removed ${report.removed.length}; ${report.errors.length} failed`,
      );
    } else {
      await onChanged(`Deleted ${report.removed.length} broken link(s)`);
    }
  };
  // Synthetic entries (not-registered skills) carry an absolute linkPath
  // as `entry.path`; registered entries carry a relative `skills/<name>`.
  // Compose vs. use-as-is so Reveal in Finder works in both cases.
  const absPath = entry.path.startsWith("/")
    ? entry.path
    : registryRoot
      ? `${registryRoot}/${entry.path}`
      : entry.path;

  const renderedMd = useMemo(() => {
    if (!skillMd) return null;
    const html = marked.parse(skillMd, { breaks: true, async: false });
    return DOMPurify.sanitize(html as string);
  }, [skillMd]);

  const description = entry.description;
  const isLongDescription = description.length > DESCRIPTION_SOFT_CAP;
  const visibleDescription =
    !descExpanded && isLongDescription
      ? description.slice(0, DESCRIPTION_SOFT_CAP).trimEnd() + "…"
      : description;

  const install = async () => {
    setAction("installing");
    try {
      const r = await window.skillsBank.install(
        entry.name,
        false,
        defaultInstallAgents,
      );
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };
  const uninstall = async () => {
    setAction("uninstalling");
    try {
      const r = await window.skillsBank.uninstall(entry.name);
      if (r.ok && onUninstalled) {
        onUninstalled(entry.name);
      } else {
        await onChanged(r.message);
      }
    } finally {
      setAction(null);
    }
  };
  const exportSkill = async () => {
    setAction("exporting");
    try {
      const r = await window.skillsBank.exportSkill(entry.name);
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };
  const reveal = () => {
    if (absPath) void window.skillsBank.openInFinder(absPath);
  };

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (t.length > 64) {
      setTagInputError(`tag is ${t.length} chars; 64 max`);
      return;
    }
    if (tagDraft.includes(t)) {
      setTagInputError(`"${t}" is already in the list`);
      return;
    }
    setTagDraft([...tagDraft, t]);
    setTagInput("");
    setTagInputError(null);
  };
  const removeTag = (t: string) => {
    setTagDraft(tagDraft.filter((x) => x !== t));
  };
  const cancelTagEdit = () => {
    setEditingTags(false);
    setTagDraft(entry.tags ?? []);
    setTagInput("");
    setTagInputError(null);
  };
  const saveTags = async () => {
    setSavingTags(true);
    try {
      const r = await window.skillsBank.editTags(entry.name, tagDraft);
      if (r.ok) {
        setEditingTags(false);
        await onChanged(r.message);
      } else {
        await onChanged(`tag save failed: ${r.message}`);
      }
    } finally {
      setSavingTags(false);
    }
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} aria-hidden="true" />
      <aside
        ref={drawerRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-label={`${entry.name} details`}
      >
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                wordBreak: "break-word",
              }}
            >
              {entry.name}
            </h2>
            {entry.version && (
              <p
                style={{
                  fontSize: 12,
                  color: "var(--text-3)",
                  fontFamily: "var(--font-mono)",
                  marginTop: 2,
                }}
              >
                v{entry.version}
              </p>
            )}
          </div>
          <button className="drawer-close" onClick={onClose} aria-label="Close">
            <Icon name="x" size="lg" />
          </button>
        </div>

        <div className="drawer-body">
          {entry.warnings && entry.warnings.length > 0 && (
            <div className="drawer-warnings">
              <strong>
                <Icon name="alert-triangle" size="sm" /> {entry.warnings.length}{" "}
                {entry.warnings.length === 1 ? "warning" : "warnings"}
              </strong>
              <ul>
                {entry.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="drawer-section">
            <h3>Description</h3>
            {description ? (
              <>
                <p>{visibleDescription}</p>
                {isLongDescription && (
                  <button
                    className="link-btn"
                    onClick={() => setDescExpanded((v) => !v)}
                  >
                    {descExpanded ? "Show less" : "Show more"}
                  </button>
                )}
              </>
            ) : (
              <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                (no description)
              </p>
            )}
          </div>

          <div className="drawer-section">
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 8,
              }}
            >
              <h3 style={{ margin: 0 }}>Tags</h3>
              {!editingTags ? (
                <button
                  className="link-btn"
                  onClick={() => setEditingTags(true)}
                >
                  Edit
                </button>
              ) : (
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="link-btn"
                    onClick={cancelTagEdit}
                    disabled={savingTags}
                  >
                    Cancel
                  </button>
                  <button
                    className="link-btn"
                    style={{ color: "var(--accent)" }}
                    onClick={() => void saveTags()}
                    disabled={savingTags}
                  >
                    {savingTags ? "Saving…" : "Save"}
                  </button>
                </div>
              )}
            </div>
            {editingTags ? (
              <div>
                <div className="skill-tags" style={{ marginBottom: 8 }}>
                  {tagDraft.map((t) => (
                    <span key={t} className="skill-tag editable">
                      #{t}
                      <button
                        className="tag-remove"
                        aria-label={`remove ${t}`}
                        onClick={() => removeTag(t)}
                      >
                        <Icon name="x" size="sm" />
                      </button>
                    </span>
                  ))}
                </div>
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    if (tagInputError) setTagInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="add a tag, press Enter"
                  className={`tag-input ${tagInputError ? "invalid" : ""}`}
                  aria-invalid={tagInputError ? true : undefined}
                  aria-describedby={
                    tagInputError ? "tag-input-error" : undefined
                  }
                />
                {tagInputError && (
                  <p id="tag-input-error" className="form-error" role="alert">
                    {tagInputError}
                  </p>
                )}
              </div>
            ) : entry.tags && entry.tags.length > 0 ? (
              <div className="skill-tags">
                {entry.tags.map((t) => (
                  <span key={t} className="skill-tag">
                    #{t}
                  </span>
                ))}
              </div>
            ) : (
              <p
                style={{
                  color: "var(--text-3)",
                  fontStyle: "italic",
                  fontSize: 12,
                }}
              >
                (no tags)
              </p>
            )}
          </div>

          <div className="drawer-section">
            <h3>Metadata</h3>
            {entry.author && (
              <div className="drawer-meta-row">
                <span className="drawer-meta-key">author</span>
                <span className="drawer-meta-value">{entry.author}</span>
              </div>
            )}
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">path</span>
              <span className="drawer-meta-value">{entry.path}</span>
            </div>
            {entry.lastCommit && (
              <div className="drawer-meta-row">
                <span className="drawer-meta-key">last commit</span>
                <span className="drawer-meta-value">
                  {new Date(entry.lastCommit.date).toLocaleDateString()} ·{" "}
                  {entry.lastCommit.sha.slice(0, 7)}
                </span>
              </div>
            )}
          </div>

          <div className="drawer-section">
            <h3>SKILL.md preview</h3>
            {skillMdLoading ? (
              <div
                aria-label="Loading SKILL.md preview"
                aria-busy="true"
                role="status"
              >
                {[100, 86, 92, 70, 96, 64].map((width, i) => (
                  <div
                    key={i}
                    className="skeleton skeleton-line"
                    style={{
                      width: `${width}%`,
                      animationDelay: `${i * 60}ms`,
                    }}
                  />
                ))}
              </div>
            ) : renderedMd ? (
              <div
                className="skill-md-preview md"
                dangerouslySetInnerHTML={{ __html: renderedMd }}
              />
            ) : (
              <div className="empty-inline">
                <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                  No <code>SKILL.md</code> in this folder.
                </p>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={reveal}
                  disabled={!registryRoot}
                >
                  <Icon name="folder" size="sm" /> Open folder to create one
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="drawer-actions">
          {/* For not-registered entries, the only useful primary action is
              moving them into the registry. install/uninstall don't apply
              because there's no registry copy to symlink to yet. */}
          {!isRegistered && onRegister && (
            <button
              className="btn primary"
              disabled={action !== null}
              onClick={() => {
                setAction("registering");
                void Promise.resolve(onRegister()).finally(() =>
                  setAction(null),
                );
              }}
            >
              {action === "registering" ? (
                <>
                  <span className="spinner inline" /> Registering…
                </>
              ) : (
                "Register in registry"
              )}
            </button>
          )}
          {isRegistered &&
            (isInstalled ? (
              <button
                className="btn danger"
                disabled={action !== null}
                onClick={() => void uninstall()}
              >
                {action === "uninstalling" ? (
                  <>
                    <span className="spinner inline" /> Uninstalling…
                  </>
                ) : (
                  "Uninstall"
                )}
              </button>
            ) : (
              <button
                className="btn primary"
                disabled={action !== null}
                onClick={() => void install()}
              >
                {action === "installing" ? (
                  <>
                    <span className="spinner inline" /> Installing…
                  </>
                ) : (
                  "Install"
                )}
              </button>
            ))}
          {/* Manage agent links — available for any skill regardless of
              registration state. Distinct from Register: this only adjusts
              symlinks across agent dirs. */}
          {onManageLinks && (
            <button
              className="btn"
              disabled={action !== null}
              onClick={onManageLinks}
            >
              Manage agent links
            </button>
          )}
          {/* Conflict resolution for registered skills with non-ours
              stragglers in other agent dirs (e.g. duplicate real-dir
              from a prior CLI install). Distinct from broken-link
              repair: these are intact alternative installations that
              the user must explicitly choose how to reconcile. */}
          {hasConflicts && onResolveConflicts && (
            <button
              className="btn warn"
              disabled={action !== null}
              onClick={onResolveConflicts}
              title={`${conflictInstallations.length} agent dir(s) have duplicate or stale entries for this skill`}
            >
              Resolve conflicts ({conflictInstallations.length})
            </button>
          )}
          {/* Two-step repair-or-delete for broken symlinks. First click
              tries to find a usable source elsewhere (other agent dirs or
              the registry) and repoints. Anything that can't be repaired
              comes back as a confirm prompt before deletion. */}
          {hasBrokenLinks && (
            <button
              className="btn warn"
              disabled={action !== null || repairState.kind === "running"}
              onClick={() => void repairOrRemoveBroken()}
              title={`${brokenInstallations.length} broken symlink(s) for this skill`}
            >
              {repairState.kind === "running" ? (
                <>
                  <span className="spinner inline" /> Repairing…
                </>
              ) : (
                `Fix broken link${brokenInstallations.length === 1 ? "" : "s"}`
              )}
            </button>
          )}
          <button
            className="btn"
            disabled={action !== null}
            onClick={() => void exportSkill()}
          >
            {action === "exporting" ? (
              <>
                <span className="spinner inline" /> Exporting…
              </>
            ) : (
              "Export"
            )}
          </button>
          <button
            className="btn ghost"
            style={{ gridColumn: "1 / -1" }}
            onClick={reveal}
            disabled={!absPath}
          >
            Reveal in Finder
          </button>
        </div>
      </aside>
      {repairState.kind === "confirm-delete" && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            background: "var(--scrim)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1100,
          }}
        >
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border-hi)",
              borderRadius: 8,
              padding: 24,
              width: 480,
              maxWidth: "90vw",
            }}
          >
            <h3 style={{ marginTop: 0 }}>Couldn't repair broken link{repairState.agents.length === 1 ? "" : "s"}</h3>
            <p style={{ color: "var(--text-2)", fontSize: 13 }}>
              No usable source found for these broken symlink
              {repairState.agents.length === 1 ? "" : "s"}. Delete{" "}
              {repairState.agents.length === 1 ? "it" : "them"}?
            </p>
            <ul
              style={{
                margin: "8px 0",
                padding: "8px 12px",
                background: "var(--surface-hi)",
                borderRadius: 4,
                fontSize: 11,
                fontFamily: "var(--font-mono)",
                color: "var(--text-3)",
                listStyle: "none",
                maxHeight: 160,
                overflowY: "auto",
              }}
            >
              {repairState.reasons.map((r) => (
                <li key={r} style={{ padding: "2px 0" }}>
                  {r}
                </li>
              ))}
            </ul>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button
                className="btn"
                onClick={() => setRepairState({ kind: "idle" })}
              >
                Keep as-is
              </button>
              <button
                className="btn danger"
                onClick={() => void confirmDeleteBroken()}
              >
                Delete broken link{repairState.agents.length === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
