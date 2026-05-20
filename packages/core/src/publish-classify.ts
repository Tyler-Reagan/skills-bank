import type { LinkedRepoLike } from "./publish-state.js";
import type { PublishState, RegistryEntry } from "./types.js";

/**
 * Phase 5 (v1.5) — Publish-flow classifier per ADR-0007 +
 * `docs/plans/in-app-publish.md`. Pure function; no IPC, no I/O.
 * Takes the inputs the renderer / IPC handler can gather and
 * routes the skill into one of three publish sub-flows:
 *
 *   - `new`         — user-authored skill, never published. Push lands
 *                     a fresh PR on the linked repo.
 *   - `safekeeping` — vendored skill with origin pointer, clean
 *                     local state. Push deposits an unedited mirror
 *                     into the user's linked repo to survive
 *                     origin loss.
 *   - `fork`        — vendored skill with origin pointer + local
 *                     drift. Publishing forces the user to confirm
 *                     a Fork (ADR-0006) before the push proceeds.
 *
 * The fourth variant — `not-publishable` — covers the gating cases:
 * no linked repo, or no meta.json on the source folder (the push
 * primitive requires one for the PR title fallback).
 */

export interface PrMeta {
  title: string;
  body: string;
}

export type SkillPublishFlow =
  | { flow: "new"; defaultPrMeta: PrMeta; targetPath: string }
  | {
      flow: "safekeeping";
      defaultPrMeta: PrMeta;
      targetPath: string;
    }
  | {
      flow: "fork";
      defaultPrMeta: PrMeta;
      targetPath: string;
      willCollide: boolean;
      existingPersonalDir?: string;
    }
  | {
      flow: "not-publishable";
      reason: "no-linked-repo" | "missing-meta-json";
    };

export interface ClassifySkillForPublishContext {
  linkedRepo: LinkedRepoLike | null;
  entry: RegistryEntry;
  publishState: PublishState;
  /**
   * Pre-checked filesystem signal: does `skills/personal/<name>/`
   * already exist on disk? Used to gate Fork's collision modal at
   * classify time, so the renderer can skip the fork-confirm modal
   * and go straight to the collision-resolution modal.
   */
  personalNameInUse: boolean;
  /**
   * Optional absolute path to the existing personal/<name>/ when
   * `personalNameInUse === true`. Surfaced to the collision modal.
   */
  existingPersonalDir?: string;
}

/**
 * Pure classifier. Implementation order mirrors the plan's grilled
 * decision tree: precondition gates first (linked repo, meta), then
 * fan out by `(bucket, origin presence, drift state)`.
 */
export function classifySkillForPublish(
  ctx: ClassifySkillForPublishContext,
): SkillPublishFlow {
  if (!ctx.linkedRepo) {
    return { flow: "not-publishable", reason: "no-linked-repo" };
  }
  if (!ctx.entry.description) {
    // meta.json carries the PR-body description; an entry with no
    // description signals a malformed skill folder. The push
    // primitive could fall back, but raising early lets the UI
    // direct the user to fix the metadata first.
    return { flow: "not-publishable", reason: "missing-meta-json" };
  }

  const bucket = ctx.entry.bucket ?? "personal";
  const origin = ctx.entry.source.origin;
  const hasOrigin = origin?.kind === "github";

  // Fork — vendored + origin + drift. The publish IPC handler
  // routes through `forkSkill` before `pushSkillFolder`; the
  // renderer surfaces the fork confirmation modal first.
  if (bucket === "vendored" && hasOrigin && ctx.entry.drift) {
    return {
      flow: "fork",
      defaultPrMeta: defaultPrMetaForFork(ctx.entry, origin),
      targetPath: `skills/personal/${ctx.entry.name}`,
      willCollide: ctx.personalNameInUse,
      ...(ctx.existingPersonalDir
        ? { existingPersonalDir: ctx.existingPersonalDir }
        : {}),
    };
  }

  // Safekeeping — vendored + origin, no drift. Push deposits the
  // mirror as-is. PR title cites the origin so the safekeep nature
  // is obvious in the review history.
  if (bucket === "vendored" && hasOrigin) {
    return {
      flow: "safekeeping",
      defaultPrMeta: defaultPrMetaForSafekeeping(ctx.entry, origin),
      targetPath: `skills/vendored/${ctx.entry.name}`,
    };
  }

  // New — anything else publishable: personal skills, vendored
  // skills without an origin, etc. Default target is the personal
  // bucket since these are user-owned content.
  return {
    flow: "new",
    defaultPrMeta: defaultPrMetaForNew(ctx.entry),
    targetPath: `skills/personal/${ctx.entry.name}`,
  };
}

function defaultPrMetaForNew(entry: RegistryEntry): PrMeta {
  return {
    title: `feat(personal): add ${entry.name}`,
    body: prBody({
      heading: `Add \`${entry.name}\` to personal/`,
      description: entry.description,
      provenanceLine: "User-authored — no origin pointer.",
    }),
  };
}

function defaultPrMetaForSafekeeping(
  entry: RegistryEntry,
  origin: NonNullable<RegistryEntry["source"]["origin"]>,
): PrMeta {
  return {
    title: `chore(vendored): vendor ${entry.name} from ${origin.repo ?? "origin"}`,
    body: prBody({
      heading: `Vendor \`${entry.name}\``,
      description: entry.description,
      provenanceLine: origin.repo
        ? `Origin: \`${origin.repo}\` (\`${origin.skillPath ?? "?"}\`).`
        : "Origin: github (details omitted).",
    }),
  };
}

function defaultPrMetaForFork(
  entry: RegistryEntry,
  origin: NonNullable<RegistryEntry["source"]["origin"]>,
): PrMeta {
  return {
    title: `feat(personal): fork ${entry.name} from ${origin.repo ?? "origin"}`,
    body: prBody({
      heading: `Fork \`${entry.name}\``,
      description: entry.description,
      provenanceLine: origin.repo
        ? `Forked from \`${origin.repo}\` (\`${origin.skillPath ?? "?"}\`). Origin pointer cleared locally.`
        : "Forked from a github origin (details omitted). Origin pointer cleared locally.",
    }),
  };
}

function prBody(opts: {
  heading: string;
  description: string;
  provenanceLine: string;
}): string {
  const desc = opts.description.trim();
  return `## ${opts.heading}\n\n${desc || "_(no description)_"}\n\n${opts.provenanceLine}\n`;
}
