import path from "node:path";
import pc from "picocolors";
import {
  exportSkill,
  getExportInfo,
  resolveRegistryRoot,
} from "@skills-bank/core";

interface ExportCmdOptions {
  out?: string;
  root?: string;
}

export async function exportCommand(
  name: string,
  opts: ExportCmdOptions,
): Promise<void> {
  const root = resolveRegistryRoot(opts.root);
  const info = getExportInfo(root, name);
  const destPath = opts.out
    ? path.resolve(opts.out)
    : path.resolve(process.cwd(), info.suggestedFilename);
  const r = await exportSkill(root, name, destPath);
  const sizeKb = (r.bytesWritten / 1024).toFixed(1);
  console.log(
    `${pc.green("✓")} exported ${pc.bold(name)} as ${pc.dim(r.kind)} → ${
      r.destPath
    } ${pc.dim(`(${sizeKb} KB)`)}`,
  );
}
