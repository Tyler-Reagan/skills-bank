/**
 * Structured application error. Replaces the legacy
 * `{ message: string }` shape that lost code, suggestedAction, and
 * stack-trace context the moment a catch block ran.
 *
 * Codes follow `<verb>.<symptom>` naming (e.g. `unregister.destination-collision`,
 * `install.permission-denied`, `sync.network-unavailable`) so the
 * renderer can branch on category without parsing the message string.
 *
 * `copyableDetails` is surfaced behind a "Show details" affordance and
 * copied as a structured Markdown block when the user clicks Copy.
 */
/**
 * Stable id strings the renderer maps to a handler. Narrow union so a
 * typo on either side fails at build instead of silently no-op'ing.
 * Add new kinds here when you add a new dispatch case in
 * App.tsx's handleSuggestedAction.
 */
export type SuggestedActionKind =
  | "open-unregister-destination-settings"
  | "unregister-force-overwrite";

/**
 * Next-step affordance the renderer can render as a button.
 * `tone` controls visual treatment (danger for irreversible operations
 * like force-overwrite).
 */
export interface SuggestedAction {
  kind: SuggestedActionKind;
  label: string;
  tone?: "primary" | "danger";
}

export interface AppError {
  /** Stable machine-readable identifier — `<verb>.<symptom>`. */
  code: string;
  /** One-line user-facing summary. Always populated. */
  message: string;
  /**
   * Zero or more next-step affordances. Rendered as a row of buttons
   * in the ErrorPanel beneath the message.
   */
  suggestedActions?: SuggestedAction[];
  /**
   * Free-form structured payload — paths, names, agent ids — that
   * survives the message-stringification step. Each value renders as
   * a row under "Show details" and ships in the clipboard copy.
   */
  copyableDetails?: Record<string, string | string[]>;
}

/** Construct an AppError from a thrown error plus a code namespace. */
export function fromCaught(code: string, err: unknown): AppError {
  if (err instanceof Error) {
    return {
      code,
      message: err.message,
      copyableDetails: err.stack ? { stack: err.stack } : undefined,
    };
  }
  return { code, message: String(err) };
}

/** Construct an AppError with explicit fields. Helper for the common case. */
export function makeAppError(args: {
  code: string;
  message: string;
  suggestedActions?: SuggestedAction[];
  copyableDetails?: AppError["copyableDetails"];
}): AppError {
  const out: AppError = { code: args.code, message: args.message };
  if (args.suggestedActions && args.suggestedActions.length > 0) {
    out.suggestedActions = args.suggestedActions;
  }
  if (args.copyableDetails) out.copyableDetails = args.copyableDetails;
  return out;
}
