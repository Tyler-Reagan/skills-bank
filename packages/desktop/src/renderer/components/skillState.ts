// Re-export shim. The classifier and its types live in @skills-bank/core
// as of M1 (taxonomy alignment). Renderer call sites keep their imports
// from "./skillState" — no churn — while the main process and CLI can
// consume the same source of truth.
//
// Imports from the `./skill-state` subpath (not the package root) so
// vite doesn't transitively pull in node-only modules like build.ts.
export {
  classifyDrawerState,
  type ClassifyOptions,
  type DrawerCapabilities,
  type DrawerState,
  type DrawerStateClassification,
  type PrimaryAction,
} from "@skills-bank/core/skill-state";
