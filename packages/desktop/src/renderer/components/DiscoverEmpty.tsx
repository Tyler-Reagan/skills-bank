import React from "react";

interface Props {
  description: string;
  onRetry: () => void;
  onOpenExternal: () => void;
}

export function DiscoverEmpty({
  description,
  onRetry,
  onOpenExternal,
}: Props): React.ReactElement {
  return (
    <div className="discover-empty" role="status" aria-live="polite">
      <div className="discover-empty-card">
        <div className="discover-empty-eyebrow">skills.sh</div>
        <h2 className="discover-empty-title">Can't reach skills.sh</h2>
        <p className="discover-empty-body">{description}</p>
        <div className="discover-empty-actions">
          <button
            type="button"
            className="btn primary"
            onClick={onRetry}
            autoFocus
          >
            Retry
          </button>
          <button
            type="button"
            className="btn ghost"
            onClick={onOpenExternal}
          >
            Open in browser
          </button>
        </div>
      </div>
    </div>
  );
}
