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
import {
  getLinkedRepo,
  getRegistrySource,
  persistConfig,
  setLinkedRepo,
  setRegistrySource,
} from "./main-state.js";
import { IPC, type AuthStatus } from "../shared/ipc.js";

async function buildAuthStatus(): Promise<AuthStatus> {
  // Identity is independent of registry mode: a token persists across
  // mode switches (and is opportunistically used by local-bundled sync
  // for rate-limit headroom), so `user` reflects token validity, not
  // current mode.
  const user = await getCurrentUser();
  return {
    registrySource: getRegistrySource(),
    isAuthConfigured: isAuthConfigured(),
    user,
    // Emit `linkedRepo` unconditionally so the renderer can render the
    // linked-repo label / last-fetched chrome for any user who's bound
    // to an explicit repo.
    linkedRepo: getLinkedRepo(),
  };
}

export { buildAuthStatus };

export function registerAuthHandlers(): void {
  ipcMain.handle(IPC.authStatus, () => buildAuthStatus());

  ipcMain.handle(IPC.authSetRegistrySourceLocal, async () => {
    setRegistrySource("local");
    setLinkedRepo(null);
    persistConfig();
    return buildAuthStatus();
  });

  ipcMain.handle(IPC.authStartDeviceFlow, async () => {
    return startDeviceFlow();
  });

  ipcMain.handle(IPC.authPollDeviceFlow, async (_e, flowId: string) => {
    try {
      await pollDeviceFlow(flowId);
      // Deferred: registrySource flips to "github" only when a repo is
      // actually linked (see replaceRegistryWithRepo). Successful Device
      // Flow alone just establishes identity.
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
    // Clear the token only — preserve `registrySource` and `linkedRepo`
    // so the user stays in the app shell with anonymized identity rather
    // than being kicked back to LoginScreen.
    clearStoredToken();
    persistConfig();
    return buildAuthStatus();
  });
}
