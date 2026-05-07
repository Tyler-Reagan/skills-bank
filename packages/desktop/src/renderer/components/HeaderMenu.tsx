import React, { useEffect, useRef, useState } from "react";
import type { AuthStatus } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

interface Props {
  authStatus: AuthStatus | null;
  onChangeRegistry: () => void;
  onExportRegistry?: () => void;
  onSignOut: () => Promise<void> | void;
  onOpenSettings: () => void;
  onOpenKeyboardShortcuts?: () => void;
}

/**
 * Persona-aware account/settings popover. Replaces the bare gear icon
 * (which was overloaded — folder picker for convenience users, repo
 * picker for power users — without making either intent visible).
 *
 * - Convenience persona: trigger reads "Settings" with a gear icon.
 *   Menu items: "Change registry folder…" (the existing folder dialog).
 * - Power persona: trigger shows the GitHub avatar + login.
 *   Menu items: "Choose registry repo…" (the GitHub picker) and
 *   "Sign out of GitHub" (clears token + persona, returns to LoginScreen).
 *
 * Closes on outside click, Escape, or any item activation.
 */
export function HeaderMenu({
  authStatus,
  onChangeRegistry,
  onExportRegistry,
  onSignOut,
  onOpenSettings,
  onOpenKeyboardShortcuts,
}: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isPower = authStatus?.persona === "power";
  const user = authStatus?.user ?? null;
  const triggerLabel = isPower ? (user?.login ?? "Account") : "Settings";

  const close = () => setOpen(false);

  return (
    <div className="header-menu" ref={wrapRef}>
      <button
        className="header-menu-trigger"
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={isPower ? "Account & registry" : "Settings"}
      >
        {isPower && user?.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="header-menu-avatar"
            referrerPolicy="no-referrer"
          />
        ) : (
          <Icon name="settings" size="md" />
        )}
        <span className="header-menu-label">{triggerLabel}</span>
        <Icon name="chevron-down" size="sm" />
      </button>

      {open && (
        <div role="menu" className="header-menu-popover">
          {isPower ? (
            <>
              {user && (
                <div className="header-menu-meta">
                  Signed in as <strong>{user.login}</strong>
                </div>
              )}
              <button
                role="menuitem"
                type="button"
                className="header-menu-item"
                onClick={() => {
                  close();
                  onChangeRegistry();
                }}
              >
                <Icon name="folder" size="sm" />
                <span>Choose registry repo…</span>
              </button>
            </>
          ) : (
            <>
              <div className="header-menu-meta">Using bundled registry</div>
              <button
                role="menuitem"
                type="button"
                className="header-menu-item"
                onClick={() => {
                  close();
                  onChangeRegistry();
                }}
              >
                <Icon name="folder" size="sm" />
                <span>Import a registry…</span>
              </button>
              {onExportRegistry && (
                <button
                  role="menuitem"
                  type="button"
                  className="header-menu-item"
                  onClick={() => {
                    close();
                    onExportRegistry();
                  }}
                >
                  <Icon name="folder" size="sm" />
                  <span>Export registry…</span>
                </button>
              )}
            </>
          )}
          <button
            role="menuitem"
            type="button"
            className="header-menu-item"
            onClick={() => {
              close();
              onOpenSettings();
            }}
          >
            <Icon name="settings" size="sm" />
            <span>Settings…</span>
          </button>
          {onOpenKeyboardShortcuts && (
            <button
              role="menuitem"
              type="button"
              className="header-menu-item"
              onClick={() => {
                close();
                onOpenKeyboardShortcuts();
              }}
            >
              <Icon name="info" size="sm" />
              <span>Keyboard shortcuts…</span>
            </button>
          )}
          {isPower && (
            <button
              role="menuitem"
              type="button"
              className="header-menu-item danger"
              onClick={() => {
                close();
                void onSignOut();
              }}
            >
              <Icon name="log-out" size="sm" />
              <span>Sign out of GitHub</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
