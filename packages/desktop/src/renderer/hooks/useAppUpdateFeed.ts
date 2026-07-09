import { useEffect, useState } from "react";
import type { AppUpdateStatus } from "../../shared/ipc.js";

export interface AppUpdateFeed {
  latestAppUpdateStatus: AppUpdateStatus | null;
  dismissedAppUpdateVersion: string | null;
  setDismissedAppUpdateVersion: (version: string | null) => void;
  /** True while a release in available/downloading/downloaded is known. */
  isLiveAppUpdate: boolean;
  /**
   * The version to badge: a live update the user hasn't skipped, else
   * null. `dismissedAppUpdateVersion` is per-version, so a newer release
   * reappears even after an earlier one was skipped.
   */
  pendingAppUpdateVersion: string | null;
}

/**
 * Owns auto-update state and wiring: mirrors every `onAppUpdateStatus`
 * event into `latestAppUpdateStatus`, hydrates the per-version dismissal
 * gate from config.json at boot, and derives the badge state. The
 * boot-time check only surfaces the badge — no modal auto-opens.
 */
export function useAppUpdateFeed(): AppUpdateFeed {
  const [latestAppUpdateStatus, setLatestAppUpdateStatus] =
    useState<AppUpdateStatus | null>(null);
  const [dismissedAppUpdateVersion, setDismissedAppUpdateVersion] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!window.skillsBank.onAppUpdateStatus) return;
    return window.skillsBank.onAppUpdateStatus((status) => {
      setLatestAppUpdateStatus(status);
      if (status.kind === "error") {
        console.warn("[update] error:", status.message);
      }
    });
  }, []);

  useEffect(() => {
    void window.skillsBank.getConfig().then((cfg) => {
      setDismissedAppUpdateVersion(cfg.dismissedAppUpdateVersion);
    });
  }, []);

  // Narrow once so `version` is reachable without re-checking the kind.
  const live =
    latestAppUpdateStatus !== null &&
    (latestAppUpdateStatus.kind === "available" ||
      latestAppUpdateStatus.kind === "downloading" ||
      latestAppUpdateStatus.kind === "downloaded")
      ? latestAppUpdateStatus
      : null;
  const pendingAppUpdateVersion =
    live && live.version !== dismissedAppUpdateVersion ? live.version : null;

  return {
    latestAppUpdateStatus,
    dismissedAppUpdateVersion,
    setDismissedAppUpdateVersion,
    isLiveAppUpdate: live !== null,
    pendingAppUpdateVersion,
  };
}
