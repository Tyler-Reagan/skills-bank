import fs from "node:fs";
import path from "node:path";
import archiver from "archiver";
import { findEntry, resolveEntryPath } from "../registry/walk.js";
import { buildRegistryIndex } from "../registry/build.js";

export type ExportKind = "standalone" | "bundled";

export interface ExportInfo {
  name: string;
  kind: ExportKind;
  /**
   * Absolute path to the source. For standalone exports this is the
   * SKILL.md file; for bundled exports it's the skill directory.
   */
  sourcePath: string;
  /** Default filename (with extension) to suggest in a save dialog. */
  suggestedFilename: string;
  /**
   * Files inside the skill directory. Useful for the UI to explain *why*
   * the export will be a zip rather than a raw .md.
   */
  contents: string[];
}

const STANDALONE_ALLOWED = new Set(["SKILL.md", "meta.json"]);

/**
 * Inspect a registry skill folder and decide how it should be exported.
 * Standalone (raw SKILL.md) when the folder contains nothing other than
 * SKILL.md and (optionally) meta.json; otherwise bundled (zip).
 */
export function getExportInfo(registryRoot: string, name: string): ExportInfo {
  const index = buildRegistryIndex(registryRoot);
  const entry = findEntry(index, name);
  if (!entry) {
    throw new Error(
      `Skill "${name}" not found. Verify a folder exists at <root>/skills/<category>/${name} with a valid meta.json.`,
    );
  }
  const skillDir = resolveEntryPath(registryRoot, entry);
  if (!fs.existsSync(skillDir)) {
    throw new Error(`Skill folder missing on disk: ${skillDir}`);
  }
  const skillMd = path.join(skillDir, "SKILL.md");
  if (!fs.existsSync(skillMd)) {
    // No SKILL.md at all — bundled is the only sensible export.
    const contents = fs.readdirSync(skillDir);
    return {
      name,
      kind: "bundled",
      sourcePath: skillDir,
      suggestedFilename: `${name}.zip`,
      contents,
    };
  }
  const contents = fs.readdirSync(skillDir);
  const isStandalone = contents.every((f) => STANDALONE_ALLOWED.has(f));
  if (isStandalone) {
    return {
      name,
      kind: "standalone",
      sourcePath: skillMd,
      suggestedFilename: `${name}.md`,
      contents,
    };
  }
  return {
    name,
    kind: "bundled",
    sourcePath: skillDir,
    suggestedFilename: `${name}.zip`,
    contents,
  };
}

export interface ExportResult {
  name: string;
  kind: ExportKind;
  destPath: string;
  bytesWritten: number;
}

/**
 * Write the export to disk. For standalone, copies SKILL.md to destPath.
 * For bundled, zips the entire skill directory under a top-level folder
 * named after the skill (so unzipping yields `<name>/SKILL.md`, etc).
 */
export async function exportSkill(
  registryRoot: string,
  name: string,
  destPath: string,
): Promise<ExportResult> {
  const info = getExportInfo(registryRoot, name);
  const absDest = path.resolve(destPath);
  fs.mkdirSync(path.dirname(absDest), { recursive: true });

  if (info.kind === "standalone") {
    fs.copyFileSync(info.sourcePath, absDest);
    const stat = fs.statSync(absDest);
    return {
      name,
      kind: "standalone",
      destPath: absDest,
      bytesWritten: stat.size,
    };
  }

  return await new Promise<ExportResult>((resolve, reject) => {
    const output = fs.createWriteStream(absDest);
    const archive = archiver("zip", { zlib: { level: 9 } });
    let settled = false;
    output.on("close", () => {
      if (settled) return;
      settled = true;
      resolve({
        name,
        kind: "bundled",
        destPath: absDest,
        bytesWritten: archive.pointer(),
      });
    });
    output.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    archive.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    archive.pipe(output);
    archive.directory(info.sourcePath, name);
    void archive.finalize();
  });
}
