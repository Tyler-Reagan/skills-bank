import React from "react";
import { Modal } from "./modalStyles.js";

export interface ConflictAdapter {
  title: string;
  description: React.ReactNode;
  sides: { label: string; content: React.ReactNode }[];
  options: {
    label: React.ReactNode;
    value: string;
    danger?: boolean;
    disabled?: boolean;
  }[];
  onResolve: (choice: string) => void;
}

interface Props {
  adapter: ConflictAdapter;
  onClose: () => void | Promise<void>;
  width?: 480 | 520 | 540 | 560 | 600 | 640 | 720;
  closeDisabled?: boolean;
}

/**
 * Generic conflict modal shell. Renders title, description, zero or
 * more content sides, and a footer with the adapter's resolution
 * options. All state management lives in the adapter owner — this
 * component is intentionally stateless.
 *
 * Accessibility: focus trap, Escape dismissal, and aria attributes are
 * provided by the underlying Modal primitive.
 */
export function ConflictModal({
  adapter,
  onClose,
  width = 640,
  closeDisabled = false,
}: Props): React.ReactElement {
  return (
    <Modal
      label={adapter.title}
      onClose={() => void onClose()}
      width={width}
      bodyClass="modal-body--no-scroll"
    >
      <h2 className="mt-0">{adapter.title}</h2>
      <p className="text-muted text-13 mt-4">{adapter.description}</p>

      {adapter.sides.map((side) => (
        <div key={side.label}>{side.content}</div>
      ))}

      <div className="row-end mt-12">
        <button onClick={() => void onClose()} disabled={closeDisabled}>
          Cancel
        </button>
        {adapter.options.map((opt) => (
          <button
            key={opt.value}
            className={opt.danger ? "btn danger" : "primary"}
            onClick={() => adapter.onResolve(opt.value)}
            disabled={opt.disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </Modal>
  );
}
