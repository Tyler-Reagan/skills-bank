import { ipcMain } from "electron";
import { getCurrentUser } from "./auth.js";
import { isAuthConfigured } from "./auth-config.js";
import {
  cancelDeviceFlow,
  clearStoredToken,
  DeviceFlowError,
  pollDeviceFlow,
  resumeDeviceFlow,
  startDeviceFlow,
} from "./auth.js";
import { getLinkedRepo, persistConfig } from "./main-state.js";
import { IPC, type AuthStatus } from "../shared/ipc.js";

async function buildAuthStatus(): Promise<AuthStatus> {
  // Identity is independent of the linked repo: a token persists across
  // linking/unlinking, so `user` reflects token validity, not registry
  // state.
  const user = await getCurrentUser();
  return {
    isAuthConfigured: isAuthConfigured(),
    user,
    // Emit `linkedRepo` unconditionally so the renderer can render the
    // linked-repo label / last-fetched chrome for any user who's bound
    // to an explicit repo.
    linkedRepo: getLinkedRepo(),
  };
}

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.authStatus, () => buildAuthStatus());

  ipcMain.handle(IPC.authStartDeviceFlow, async () => {
    return startDeviceFlow();
  });

  ipcMain.handle(IPC.authPollDeviceFlow, async (_e, flowId: string) => {
    try {
      await pollDeviceFlow(flowId);
      // Successful Device Flow only establishes identity — linking a
      // repo (see replaceRegistryWithRepo) is a separate, later step.
      return await buildAuthStatus();
    } catch (err) {
      if (err instanceof DeviceFlowError) {
        throw new Error(`device-flow:${err.code}:${err.message}`);
      }
      throw err;
    }
  });

  ipcMain.handle(IPC.authCancelDeviceFlow, (_e, flowId: string) => {
    cancelDeviceFlow(flowId);
  });

  ipcMain.handle(IPC.authResumeDeviceFlow, () => {
    return resumeDeviceFlow();
  });

  ipcMain.handle(IPC.authLogout, async () => {
    // Clear the token only — preserve `linkedRepo` so the user stays in
    // the app shell with anonymized identity.
    clearStoredToken();
    persistConfig();
    return buildAuthStatus();
  });
}
