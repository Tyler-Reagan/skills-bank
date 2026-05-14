import React from "react";

/**
 * Pre-mount placeholder rendered while the renderer is still resolving
 * which top-level view to show (LoginScreen vs main app shell).
 *
 * Without this, the app renders its loading skeleton chrome before the
 * auth status is known — so on first launch the user briefly sees the
 * full app outline, which then snaps to LoginScreen. The splash keeps
 * the visual feedback consistent: one calm loading state that
 * transitions to the real first frame the user should see.
 */
export function SplashScreen(): React.ReactElement {
  return (
    <div className="splash" role="status" aria-live="polite">
      <div className="splash-stack">
        <div className="splash-mark" aria-hidden="true">
          <span className="spinner" />
        </div>
        <div className="splash-title">Skills Bank</div>
        <div className="splash-subtitle">Loading</div>
      </div>
    </div>
  );
}
