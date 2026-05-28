import React from "react";
import { Modal } from "./modalStyles.js";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ["⌘ K", "/"], description: "Focus the Registry search" },
  { keys: ["Esc"], description: "Close the open dialog or drawer" },
  {
    keys: ["←", "→"],
    description:
      "Move between Registry / Installed tabs (when a tab is focused)",
  },
  {
    keys: ["Enter", "Space"],
    description: "Open the focused skill card's detail drawer",
  },
  { keys: ["Tab"], description: "Move focus through cards and controls" },
];

/**
 * Compact reference panel for the few global keyboard shortcuts we
 * support today. Reachable from the header menu; closes on Esc or
 * outside-click. Acts as a discoverability surface so power users find
 * the shortcuts without trial-and-error.
 */
export function KeyboardShortcutsOverlay({
  onClose,
}: Props): React.ReactElement {
  return (
    <Modal label="Keyboard shortcuts" onClose={onClose}>
      <h2 className="mt-0">Keyboard shortcuts</h2>
      <p className="text-muted text-13 mt-4">
        A handful of shortcuts to keep your hands on the keys.
      </p>
      <table className="kb-table">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.description}>
              <td className="kb-keys-cell">
                {s.keys.map((k) => (
                  <kbd key={k} className="kb-key">
                    {k}
                  </kbd>
                ))}
              </td>
              <td className="kb-desc-cell">{s.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row-end mt-16">
        <button className="primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Modal>
  );
}
