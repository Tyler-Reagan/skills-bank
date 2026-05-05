import React, { useEffect, useState } from "react";
import type { InstalledSkill, RegistryEntry } from "@skills-bank/core";

const DOMAIN_TOKENS: Record<string, { color: string; dim: string }> = {
  design: { color: "var(--design)", dim: "var(--design-dim)" },
  code: { color: "var(--code)", dim: "var(--code-dim)" },
  content: { color: "var(--content)", dim: "var(--content-dim)" },
  data: { color: "var(--data)", dim: "var(--data-dim)" },
  meta: { color: "var(--meta)", dim: "var(--meta-dim)" },
  other: { color: "var(--other)", dim: "var(--other-dim)" },
};

interface Props {
  entry: RegistryEntry;
  installed: InstalledSkill[];
  registryRoot: string | null;
  onClose: () => void;
  onChanged: (msg: string) => void | Promise<void>;
}

type ActionState = null | "installing" | "uninstalling" | "exporting";

export function SkillDetailDrawer({
  entry,
  installed,
  registryRoot,
  onClose,
  onChanged,
}: Props): React.ReactElement {
  const [skillMd, setSkillMd] = useState<string | null>(null);
  const [skillMdLoading, setSkillMdLoading] = useState(true);
  const [action, setAction] = useState<ActionState>(null);

  useEffect(() => {
    let cancelled = false;
    setSkillMd(null);
    setSkillMdLoading(true);
    void window.skillsBank.readSkillMd(entry.name).then((md) => {
      if (!cancelled) {
        setSkillMd(md);
        setSkillMdLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [entry.name]);

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
  const domain = entry.domain ?? "other";
  const tok = DOMAIN_TOKENS[domain] ?? DOMAIN_TOKENS["other"]!;
  const absPath = registryRoot ? `${registryRoot}/${entry.path}` : entry.path;

  const install = async () => {
    setAction("installing");
    try {
      const r = await window.skillsBank.install(entry.name, false);
      await onChanged(r.message);
    } finally {
      setAction(null);
    }
  };
  const uninstall = async () => {
    setAction("uninstalling");
    try {
      const r = await window.skillsBank.uninstall(entry.name);
      await onChanged(r.message);
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
    if (registryRoot) void window.skillsBank.openInFinder(absPath);
  };

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label={`${entry.name} details`}>
        <div className="drawer-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span
              className="skill-domain-badge"
              style={
                {
                  "--badge-color": tok.color,
                  "--badge-bg": tok.dim,
                } as React.CSSProperties
              }
            >
              {domain}
            </span>
            <h2
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 18,
                marginTop: 8,
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
            ×
          </button>
        </div>

        <div className="drawer-body">
          {entry.warnings && entry.warnings.length > 0 && (
            <div className="drawer-warnings">
              <strong>
                ⚠ {entry.warnings.length}{" "}
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
            {entry.description ? (
              <p>{entry.description}</p>
            ) : (
              <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                (no description)
              </p>
            )}
          </div>

          {entry.tags && entry.tags.length > 0 && (
            <div className="drawer-section">
              <h3>Tags</h3>
              <div className="skill-tags">
                {entry.tags.map((t) => (
                  <span key={t} className="skill-tag">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="drawer-section">
            <h3>Metadata</h3>
            <div className="drawer-meta-row">
              <span className="drawer-meta-key">category</span>
              <span className="drawer-meta-value">{entry.category}</span>
            </div>
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
              <p style={{ color: "var(--text-3)" }}>
                <span className="spinner inline" /> Loading…
              </p>
            ) : skillMd ? (
              <pre className="skill-md-preview">{skillMd}</pre>
            ) : (
              <p style={{ color: "var(--text-3)", fontStyle: "italic" }}>
                (no SKILL.md found)
              </p>
            )}
          </div>
        </div>

        <div className="drawer-actions">
          {isInstalled ? (
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
            disabled={!registryRoot}
          >
            Reveal in Finder
          </button>
        </div>
      </aside>
    </>
  );
}
