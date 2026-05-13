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
export interface AppError {
  /** Stable machine-readable identifier — `<verb>.<symptom>`. */
  code: string;
  /** One-line user-facing summary. Always populated. */
  message: string;
  /**
   * Optional next-step affordance the renderer can render as a
   * primary button alongside the dismiss action. `kind` is a stable
   * id the renderer maps to a handler.
   */
  suggestedAction?: {
    kind: string;
    label: string;
  };
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
  suggestedAction?: AppError["suggestedAction"];
  copyableDetails?: AppError["copyableDetails"];
}): AppError {
  const out: AppError = { code: args.code, message: args.message };
  if (args.suggestedAction) out.suggestedAction = args.suggestedAction;
  if (args.copyableDetails) out.copyableDetails = args.copyableDetails;
  return out;
}
