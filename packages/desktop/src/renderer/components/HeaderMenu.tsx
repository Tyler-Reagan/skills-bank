import React from "react";
import type { AuthStatus, HeaderMenuContext } from "../../shared/ipc.js";
import { Icon } from "./Icon.js";

interface Props {
  authStatus: AuthStatus | null;
  showSync: boolean;
}

export function HeaderMenu({
  authStatus,
  showSync,
}: Props): React.ReactElement {
  const isGithub = authStatus?.registrySource === "github";
  const user = authStatus?.user ?? null;

  const handleClick = () => {
    const context: HeaderMenuContext = {
      registrySource: authStatus?.registrySource ?? null,
      user: user ? { login: user.login } : null,
      showSync,
    };
    void window.skillsBank.showHeaderMenu(context);
  };

  return (
    <button
      className="header-menu-trigger"
      type="button"
      onClick={handleClick}
      title={isGithub ? "Account & registry" : "Settings"}
    >
      {isGithub && user?.avatarUrl ? (
        <img
          src={user.avatarUrl}
          alt=""
          className="header-menu-avatar"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Icon name="settings" size="md" />
      )}
      <span className="header-menu-label">
        {isGithub ? (user?.login ?? "Account") : "Settings"}
      </span>
      <Icon name="chevron-down" size="sm" />
    </button>
  );
}
