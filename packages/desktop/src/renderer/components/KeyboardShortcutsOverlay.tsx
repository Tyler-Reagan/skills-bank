import React from "react";
import { useFocusReturn } from "../hooks/useFocusReturn.js";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["⌘ K", "/"], description: "Focus the Registry search" },
  { keys: ["Esc"], description: "Close the open dialog or drawer" },
  { keys: ["←", "→"], description: "Move between Registry / Installed tabs (when a tab is focused)" },
  { keys: ["Enter", "Space"], description: "Open the focused skill card's detail drawer" },
  { keys: ["Tab"], description: "Move focus through cards and controls" },
];

/**
 * Compact reference panel for the few global keyboard shortcuts we
 * support today. Reachable from the header menu; closes on Esc or
 * outside-click. Acts as a discoverability surface so power users find
 * the shortcuts without trial-and-error.
 */
export function KeyboardShortcutsOverlay({ onClose }: Props): React.ReactElement {
  useFocusReturn();
  return (
    <div style={overlay} onClick={onClose}>
      <div
        style={modal}
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ marginTop: 0 }}>Keyboard shortcuts</h2>
        <p style={{ color: "var(--text-2)", fontSize: 13, marginTop: 4 }}>
          A handful of shortcuts to keep your hands on the keys.
        </p>
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.description}>
                <td style={keysCell}>
                  {s.keys.map((k) => (
                    <kbd key={k} style={kbd}>
                      {k}
                    </kbd>
                  ))}
                </td>
                <td style={descCell}>{s.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 16 }}>
          <button className="primary" onClick={onClose}>
            Done
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
  width: 480,
  maxWidth: "90vw",
};
const keysCell: React.CSSProperties = {
  padding: "8px 12px 8px 0",
  whiteSpace: "nowrap",
  borderBottom: "1px solid var(--border)",
};
const descCell: React.CSSProperties = {
  padding: "8px 0",
  fontSize: 13,
  color: "var(--text-2)",
  borderBottom: "1px solid var(--border)",
};
const kbd: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  marginRight: 6,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  color: "var(--text)",
  background: "var(--surface-hi)",
  border: "1px solid var(--border)",
  borderBottomWidth: 2,
  borderRadius: 4,
};
