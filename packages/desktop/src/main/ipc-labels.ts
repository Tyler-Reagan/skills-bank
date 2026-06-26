import { ipcMain } from "electron";
import { applySkillLabel, clearSkillLabel } from "@skills-bank/core";
import { readLabelsFile, writeLabelsFile } from "./main-state.js";
import { IPC } from "../shared/ipc.js";

export function registerLabelsHandlers(): void {
  ipcMain.handle(IPC.readLabels, (): import("@skills-bank/core").LabelsMap => {
    return readLabelsFile();
  });

  ipcMain.handle(
    IPC.updateLabel,
    (
      _e,
      name: string,
      patch: import("@skills-bank/core").SkillLabelOverride,
    ): void => {
      writeLabelsFile(applySkillLabel(readLabelsFile(), name, patch));
    },
  );

  ipcMain.handle(IPC.resetLabel, (_e, name: string): void => {
    writeLabelsFile(clearSkillLabel(readLabelsFile(), name));
  });

  // Bulk is a fold of the single-skill primitive, not its own primitive.
  ipcMain.handle(
    IPC.bulkUpdateLabels,
    (_e, updates: import("@skills-bank/core").LabelsMap): void => {
      let data = readLabelsFile();
      for (const [name, patch] of Object.entries(updates)) {
        data = applySkillLabel(data, name, patch);
      }
      writeLabelsFile(data);
    },
  );
}
