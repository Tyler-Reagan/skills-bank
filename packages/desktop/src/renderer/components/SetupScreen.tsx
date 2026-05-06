import React, { useState } from "react";
import { Icon } from "./Icon.js";

interface Props {
  onConfigured: (registryRoot: string) => void;
}

/**
 * Shown when the app launches with no resolvable registry folder.
 * Walks the user through pointing it at their cloned skills-bank repo,
 * persists the choice, and hands off to the main UI on success.
 */
export function SetupScreen({ onConfigured }: Props): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await window.skillsBank.setRegistryRoot();
      if (r.ok && r.registryRoot) {
        onConfigured(r.registryRoot);
      } else if (r.message !== "cancelled") {
        setError(r.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="setup-screen">
      <div className="setup-card">
        <div className="setup-brand">
          skills<span>-</span>bank
        </div>
        <h1>Welcome — pick your registry folder.</h1>
        <p>
          skills-bank manages skills that live inside a cloned git repo on
          your machine. To get started, point this app at the folder where
          you cloned <code>skills-bank</code>.
        </p>
        <p className="setup-hint">
          The folder must contain a <code>package.json</code> whose name is
          <code>"skills-bank"</code> and a <code>skills/</code> subdirectory.
        </p>
        <button
          className="btn primary setup-cta"
          onClick={() => void pick()}
          disabled={busy}
        >
          {busy ? (
            <>
              <span className="spinner inline" /> Choosing folder…
            </>
          ) : (
            <>
              <Icon name="folder" size="md" /> Choose registry folder…
            </>
          )}
        </button>
        {error && (
          <p className="setup-error" role="alert">
            <Icon name="alert-triangle" size="sm" /> {error}
          </p>
        )}
        <p className="setup-footnote">
          Don&apos;t have it cloned yet? Run{" "}
          <code>git clone git@github.com:Tyler-Reagan/skills-bank.git</code>{" "}
          in a Terminal first, then come back and pick that folder.
        </p>
      </div>
    </div>
  );
}
