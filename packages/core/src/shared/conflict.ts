import fs from "node:fs";
import path from "node:path";
import type { ConflictDecision } from "../sync.js";

/**
 * v0.11.9 M5: shared conflict-resolution primitive. Sync and Merge
 * previously each carried byte-identical copies of:
 *   - `resolveRenameTarget` — picks `<name>-local`, `-local-2`, … for
 *     the user's renamed copy when the user opts for `rename-mine`.
 *   - The three-arm decision switch (`keep-mine` / `use-canonical` /
 *     `rename-mine`) that operates on the local path.
 *
 * They still differ on the post-action stamp: Sync writes
 * `source: "curated"` with `syncedFromCommit`; Merge writes
 * `source: "user"` with `syncedAt`. That post-stamp stays in the
 * callers — this helper only resolves the on-disk preparation step.
 */

export function resolveRenameTarget(skillsDir: string, name: string): string {
  const base = `${name}-local`;
  if (!fs.existsSync(path.join(skillsDir, base))) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${base}-${i}`;
    if (!fs.existsSync(path.join(skillsDir, candidate))) return candidate;
  }
  throw new Error(`no available rename target for ${name}`);
}

/**
 * Effect emitted by `applyConflictDecision`. Callers branch on
 * `kind` to decide whether the canonical copy should be written
 * to `localPath` (yes for use-canonical and rename-mine; no for
 * keep-mine).
 */
export type ConflictDecisionEffect =
  | { kind: "keep-mine" }
  | { kind: "use-canonical" }
  | { kind: "rename-mine"; renamedTo: string };

export interface ApplyConflictDecisionInput {
  localSkillsDir: string;
  /** Absolute path of `<localSkillsDir>/<name>` — the current user copy. */
  localPath: string;
  /** Skill name, used as the rename-target base. */
  name: string;
  decision: ConflictDecision;
}

/**
 * Perform the on-disk preparation for a conflict decision. The
 * caller still writes the canonical content + stamps the source
 * marker afterwards (the post-stamp shape differs between Sync's
 * `bundled` and Merge's `yours` semantics).
 *
 * Effects:
 *   - `keep-mine`: no disk mutation; caller skips the canonical write.
 *   - `use-canonical`: removes `localPath` so the caller can copy
 *     the canonical content in its place.
 *   - `rename-mine`: renames `localPath` to `<name>-local[-N]` so the
 *     canonical content can land at the original `localPath`.
 */
export function applyConflictDecision(
  input: ApplyConflictDecisionInput,
): ConflictDecisionEffect {
  const { localSkillsDir, localPath, name, decision } = input;
  if (decision.action === "keep-mine") {
    return { kind: "keep-mine" };
  }
  if (decision.action === "use-canonical") {
    fs.rmSync(localPath, { recursive: true, force: true });
    return { kind: "use-canonical" };
  }
  if (decision.action === "rename-mine") {
    const target = resolveRenameTarget(localSkillsDir, name);
    fs.renameSync(localPath, path.join(localSkillsDir, target));
    return { kind: "rename-mine", renamedTo: target };
  }
  // Exhaustive — TypeScript narrows here; runtime guard for safety.
  throw new Error(
    `unknown ConflictDecision.action: ${(decision as ConflictDecision).action}`,
  );
}
