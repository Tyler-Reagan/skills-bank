import pc from "picocolors";
import { listInstalled, resolveRegistryRoot } from "@skills-bank/core";

export interface InstalledOptions {
  json?: boolean;
  root?: string;
}

export function installedCommand(opts: InstalledOptions): void {
  const root = resolveRegistryRoot(opts.root);
  const items = listInstalled(root);
  if (opts.json) {
    process.stdout.write(JSON.stringify(items, null, 2) + "\n");
    return;
  }
  if (items.length === 0) {
    console.log(pc.dim("(no skills installed under ~/.claude/skills)"));
    return;
  }
  for (const it of items) {
    const tag = colorKind(it.kind);
    const target = it.target ? pc.dim(` → ${it.target}`) : "";
    console.log(`${pc.bold(it.name)} ${tag}${target}`);
  }
}

function colorKind(kind: string): string {
  switch (kind) {
    case "ours":
      return pc.green("[registry]");
    case "foreign-symlink":
      return pc.yellow("[external]");
    case "real-directory":
      return pc.magenta("[real-dir]");
    case "broken-symlink":
      return pc.red("[broken]");
    default:
      return `[${kind}]`;
  }
}
