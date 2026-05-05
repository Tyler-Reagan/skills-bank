import pc from "picocolors";
import { loadIndex, resolveRegistryRoot } from "@skills-bank/core";

export interface ListOptions {
  json?: boolean;
  root?: string;
}

export function listCommand(opts: ListOptions): void {
  const root = resolveRegistryRoot(opts.root);
  const index = loadIndex(root);
  if (opts.json) {
    process.stdout.write(JSON.stringify(index.entries, null, 2) + "\n");
    return;
  }
  if (index.entries.length === 0) {
    console.log(pc.dim("(no skills in registry; run `npm run build:index`)"));
    return;
  }
  for (const e of index.entries) {
    const tag = e.category ? pc.dim(`[${e.category}]`) : "";
    console.log(`${pc.bold(e.name)} ${tag} — ${e.description}`);
  }
}
