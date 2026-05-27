import { useEffect, useState } from "react";
import type { UpdateStatus } from "../../shared/ipc.js";

export interface UpdateFeed {
  latestUpdateStatus: UpdateStatus | null;
  dismissedUpdateVersion: string | null;
  setDismissedUpdateVersion: (version: string | null) => void;
  /** True while a release in available/downloading/downloaded is known. */
  isLiveUpdate: boolean;
  /**
   * The version to badge: a live update the user hasn't skipped, else
   * null. `dismissedUpdateVersion` is per-version, so a newer release
   * reappears even after an earlier one was skipped.
   */
  pendingUpdateVersion: string | null;
}

/**
 * Owns auto-update state and wiring: mirrors every `onUpdateStatus`
 * event into `latestUpdateStatus`, hydrates the per-version dismissal
 * gate from config.json at boot, and derives the badge state. The
 * boot-time check only surfaces the badge — no modal auto-opens.
 */
export function useUpdateFeed(): UpdateFeed {
  const [latestUpdateStatus, setLatestUpdateStatus] =
    useState<UpdateStatus | null>(null);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<
    string | null
  >(null);

  useEffect(() => {
    if (!window.skillsBank.onUpdateStatus) return;
    return window.skillsBank.onUpdateStatus((status) => {
      setLatestUpdateStatus(status);
      if (status.kind === "error") {
        console.warn("[update] error:", status.message);
      }
    });
  }, []);

  useEffect(() => {
    void window.skillsBank.getConfig().then((cfg) => {
      setDismissedUpdateVersion(cfg.dismissedUpdateVersion);
    });
  }, []);

  // Narrow once so `version` is reachable without re-checking the kind.
  const live =
    latestUpdateStatus !== null &&
    (latestUpdateStatus.kind === "available" ||
      latestUpdateStatus.kind === "downloading" ||
      latestUpdateStatus.kind === "downloaded")
      ? latestUpdateStatus
      : null;
  const pendingUpdateVersion =
    live && live.version !== dismissedUpdateVersion ? live.version : null;

  return {
    latestUpdateStatus,
    dismissedUpdateVersion,
    setDismissedUpdateVersion,
    isLiveUpdate: live !== null,
    pendingUpdateVersion,
  };
}
