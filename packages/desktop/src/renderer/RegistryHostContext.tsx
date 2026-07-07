import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AppError } from "@skills-bank/core";

type ToastAction = { label: string; onClick: () => void };

interface ToastShape {
  message: string;
  /** When set, the toast doesn't auto-dismiss; user must click ×. */
  sticky?: boolean;
  /** Visual severity. "error" gets a red border + persistent close. */
  severity?: "info" | "error";
  /** Primary action button (e.g. "Sign in"). */
  action?: ToastAction;
  /** Optional secondary action — typically Copy details / Diagnostics. */
  secondaryAction?: ToastAction;
  /** Hidden diagnostic payload; "Copy details" copies this to clipboard. */
  diagnostic?: string;
}

interface FlashErrorOpts {
  action?: ToastAction;
  diagnostic?: string;
}

interface AppErrorEntry {
  id: number;
  error: AppError;
}

export interface RegistryHostValue {
  /** Transient confirmation toast — 2.5s auto-dismiss. */
  flash: (msg: string) => void;
  /** Confirmation toast with a single action button — 6s auto-dismiss. */
  flashWithAction: (msg: string, label: string, onClick: () => void) => void;
  /** Sticky error toast — no auto-dismiss; user closes via ×. */
  flashError: (msg: string, opts?: FlashErrorOpts) => void;
  /**
   * Force-dismiss the current toast. Use for action-onClick handlers
   * that route the user elsewhere (e.g. Sign-in from a rate-limit
   * toast) and want the toast gone before the destination renders.
   */
  dismissToast: () => void;
  /** Persistent error panel push; returns the id for later dismiss/match. */
  pushAppError: (e: AppError) => number;
  dismissAppError: (id: number) => void;
  /** Live AppError list (rendered by AppContent's ErrorPanel mapper). */
  appErrors: AppErrorEntry[];
}

const RegistryHostContext = createContext<RegistryHostValue | null>(null);

export function useRegistryHost(): RegistryHostValue {
  const ctx = useContext(RegistryHostContext);
  if (!ctx) {
    throw new Error(
      "useRegistryHost must be used inside <RegistryHostProvider>",
    );
  }
  return ctx;
}

interface ProviderProps {
  children: React.ReactNode;
}

/**
 * Owns toast + AppError state and exposes the corresponding callbacks to
 * the rest of the renderer via context. The Toast UI itself is rendered
 * here so children don't need to thread `toast` state down. AppError
 * panel UI stays in AppContent (its handlers reach AppContent-owned
 * state like settings).
 *
 * `refresh` is intentionally NOT part of this context yet — it depends
 * on registry/installed state that's still owned by AppContent. The
 * subsequent M3 split (renderer-state-architecture) hoists those into
 * a RegistryHost component, at which point refresh joins this context.
 */
export function RegistryHostProvider({
  children,
}: ProviderProps): React.ReactElement {
  const [toast, setToast] = useState<ToastShape | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [appErrors, setAppErrors] = useState<AppErrorEntry[]>([]);
  const appErrorIdRef = useRef(0);

  const flash = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message: msg });
    toastTimerRef.current = setTimeout(() => setToast(null), 2500);
  }, []);

  const flashWithAction = useCallback(
    (msg: string, label: string, onClick: () => void) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToast({
        message: msg,
        action: {
          label,
          onClick: () => {
            if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
            setToast(null);
            onClick();
          },
        },
      });
      toastTimerRef.current = setTimeout(() => setToast(null), 6000);
    },
    [],
  );

  const flashError = useCallback((msg: string, opts: FlashErrorOpts = {}) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    const diagnostic = opts.diagnostic ?? msg;
    const copyAction: ToastAction = {
      label: "Copy details",
      onClick: () => {
        void navigator.clipboard.writeText(diagnostic);
      },
    };
    setToast({
      message: msg,
      sticky: true,
      severity: "error",
      action: opts.action,
      secondaryAction: copyAction,
      diagnostic,
    });
    // No timer — sticky toasts persist until the user dismisses.
  }, []);

  const pushAppError = useCallback((e: AppError): number => {
    const id = ++appErrorIdRef.current;
    setAppErrors((prev) => [...prev, { id, error: e }]);
    return id;
  }, []);

  const dismissAppError = useCallback((id: number) => {
    setAppErrors((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const dismissToast = useCallback(() => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(null);
  }, []);

  const value = useMemo<RegistryHostValue>(
    () => ({
      flash,
      flashWithAction,
      flashError,
      dismissToast,
      pushAppError,
      dismissAppError,
      appErrors,
    }),
    [
      flash,
      flashWithAction,
      flashError,
      dismissToast,
      pushAppError,
      dismissAppError,
      appErrors,
    ],
  );

  return (
    <RegistryHostContext.Provider value={value}>
      {children}
      {toast && (
        <div
          className={`toast${toast.severity === "error" ? " toast-error" : ""}`}
          role={toast.severity === "error" ? "alert" : "status"}
          aria-live={toast.severity === "error" ? "assertive" : "polite"}
        >
          <span className="toast-message">{toast.message}</span>
          {toast.action && (
            <button className="toast-action" onClick={toast.action.onClick}>
              {toast.action.label}
            </button>
          )}
          {toast.secondaryAction && (
            <button
              className="toast-action secondary"
              onClick={toast.secondaryAction.onClick}
            >
              {toast.secondaryAction.label}
            </button>
          )}
          {toast.sticky && (
            <button
              className="toast-close"
              aria-label="Dismiss"
              onClick={() => {
                if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
                setToast(null);
              }}
            >
              ×
            </button>
          )}
        </div>
      )}
    </RegistryHostContext.Provider>
  );
}
