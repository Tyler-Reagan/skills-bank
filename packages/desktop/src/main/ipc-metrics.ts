import { ipcMain } from "electron";
import { readInvocationStats } from "@skills-bank/core";
import {
  disableTracking,
  enableTracking,
  getTrackingStatus,
} from "./skill-tracking.js";
import { IPC } from "../shared/ipc.js";

export function registerMetricsHandlers(): void {
  ipcMain.handle(IPC.getInvocationStats, () => readInvocationStats());
  ipcMain.handle(IPC.getSkillTrackingStatus, () => getTrackingStatus());
  ipcMain.handle(IPC.setSkillTrackingEnabled, (_e, enabled: boolean) =>
    enabled ? enableTracking() : disableTracking(),
  );
}
