import pc from "picocolors";
import { buildRegistryIndex, resolveRegistryRoot } from "@skills-bank/core";

interface ListOptions {
  json?: boolean;
  root?: string;
}

export function listCommand(opts: ListOptions): void {
  const root = resolveRegistryRoot(opts.root);
  const index = buildRegistryIndex(root);
  if (opts.json) {
    process.stdout.write(JSON.stringify(index.entries, null, 2) + "\n");
    return;
  }
  if (index.entries.length === 0) {
    console.log(
      pc.dim(
        "(no skills in registry; add one under skills/<name>/ with a meta.json)",
      ),
    );
    return;
  }
  for (const e of index.entries) {
    const tags =
      e.tags && e.tags.length > 0
        ? " " + pc.dim(e.tags.map((t) => `#${t}`).join(" "))
        : "";
    console.log(`${pc.bold(e.name)}${tags} — ${e.description}`);
  }
}
