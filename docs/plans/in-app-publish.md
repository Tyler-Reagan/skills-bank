# In-app Publish (planned post-v1.0)

The desktop app lets a user push a skill from their local registry to their linked GitHub repo as a pull request — the inverse of vendoring. Three sub-flows (new skill / safekeeping / fork) cover every shape of "skill in my registry that I want to deposit in my linked repo." The maintainer scenario (linked repo == bundled repo) and the third-party-linked-repo scenario both work through the same primitives.

The design pinned in this plan was grilled inline across the architecture-pass session that produced ADRs 0006 / 0007 / 0008. Each ADR pins the invariants for one primitive; this plan ties them together with implementation order, conflict audits, and the IPC + UI surface.

## Depends on

- v1.0.0 (the post-v1.0 backcompat-conscious public-surface discipline applies).
- Closure of the v0.11.10 origin-rename deprecation cycle (commit 474f42e on `feat/skills-flow-fixes`).
- Renamed `RegistryEntry` shape (this plan drops `publishState` per ADR-0008).

## Goals

1. A user with a linked GitHub repo can publish any local skill via the drawer Publish button, opening a PR against the linked repo.
2. Three trigger conditions route automatically into the right sub-flow: new skill, safekeeping a vendored skill, forking an edited vendored skill.
3. Edits to a vendored skill that the user publishes force an explicit Fork confirmation before the publish proceeds, since fork is irreversible without re-vendoring (per ADR-0006).
4. Push is always PR-only; the linked repo's default branch is never written directly. Subsequent publishes of the same skill while a prior PR is open append commits to the open PR (per ADR-0007).
5. The drawer surfaces publish-state pre-flight via a chip in the Linked-repo section; classifier and canon gate read the same values via the new dual-mode `publish-state.ts` (per ADR-0008).
6. Packaged-app instances compute publish-state correctly for the first time, fixing the silent canon-gate bug where `git` unavailability defaulted every skill to `unknown`.

## Non-goals

- **Bulk publish.** Out of scope for the v0 implementation. Once the per-skill primitive lands, a thin loop in the IPC handler (matching the bulk-install precedent) is the natural extension; it follows in its own scope.
- **Renaming `acceptDriftSeverUpstream` → `unlinkOrigin`.** UL canon, separate refactor. Out of scope.
- **Renaming the `SkillSource.upstream` JSON field → `origin`.** ADR-0002 binds the wire format. Out of scope.
- **PR template inheritance.** Linked repos with `.github/PULL_REQUEST_TEMPLATE.md` get our auto-generated body, which overrides the template per the GitHub API contract. If a maintainer with a template hits this, follow-up adds a "fetch template + prepend" path.
- **Multi-linked-repo coexistence.** One linked repo at a time, as today.
- **In-app file editing of published skills.** The user edits skills through their agent tools or the maintainer scripts; the app reads, classifies, and publishes.

## Scope

### New core primitives

`packages/core/src/fork.ts` (new file)

```ts
export function forkSkill(
  registryRoot: string,
  name: string,
): ForkSkillResult;

export type ForkSkillResult =
  | { ok: true; newDir: string; ref: SkillFolderRef; symlinksRepointed: number }
  | { ok: false; reason: "collision"; existingDir: string }
  | { ok: false; reason: "no-origin" }
  | { ok: false; reason: "source-missing" }
  | { ok: false; reason: "swap-failed"; message: string };
```

Per ADR-0006: scratch-dir + atomic-swap atomicity, refuse-on-collision policy, must-have-origin trigger. Composes `acceptDriftSeverUpstream` on the scratch dir + a new four-line `flipSourceToYours` helper in `heal.ts` + the bucket relocation.

`packages/core/src/upstream.ts` (extension)

```ts
export async function pushSkillFolder(
  repo: string,
  sourceDir: string,
  targetPath: string,
  branch: string,
  token: string,
  prMeta?: { title?: string; body?: string },
): Promise<PushSkillResult>;

export type PushSkillResult =
  | { ok: true; prUrl: string; prNumber: number; updated: boolean }
  | { ok: false; reason: "rate-limit"; rateLimit: RateLimitInfo }
  | { ok: false; reason: "push-failed"; step: 1|2|3|4|5|6; message: string }
  | { ok: false; reason: "branch-resolution-failed"; message: string };
```

Per ADR-0007: ref-as-commit-point atomicity, PR-state-aware branch resolution (auto-resolve, no modal), rate-limit handling matches `mirrorSkillFolder`, caller-overridable PR metadata.

`packages/core/src/publish-state.ts` (rewrite)

```ts
export function computePublishStatesFromGit(
  registryRoot: string,
): Map<string, PublishState>;

export function computePublishStatesFromRemote(
  opts: {
    registryRoot: string;
    repo: string;
    token: string | null;
    baseBranch?: string;
  },
): Promise<Map<string, PublishState>>;

export function detectPublishStateMode(
  registryRoot: string,
  ctx: { linkedRepo: LinkedRepoMetadata | null; token: string | null },
): PublishStateMode | null;
```

Per ADR-0008: dual-mode computation, four-value vocabulary preserved, compute-on-call with 5-min tree cache, invalidated on push success + rescan, `publishState` dropped from `RegistryEntry`.

`packages/core/src/publish-classify.ts` (new file)

```ts
export type SkillPublishFlow =
  | { flow: "new"; defaultPrMeta: PrMeta }
  | { flow: "safekeeping"; defaultPrMeta: PrMeta }
  | { flow: "fork"; defaultPrMeta: PrMeta; willCollide: boolean; existingPersonalDir?: string }
  | { flow: "not-publishable"; reason: "no-linked-repo" | "missing-meta-json" };

export function classifySkillForPublish(
  registryRoot: string,
  name: string,
  ctx: { linkedRepo: LinkedRepoMetadata | null; entry: RegistryEntry; publishState: PublishState },
): SkillPublishFlow;
```

Pure function; no IPC, no I/O. Takes the inputs the renderer / IPC handler can gather and routes into the appropriate flow. `willCollide` is the pre-check that lets the renderer skip the fork-confirm modal and go straight to the collision-resolution modal when needed.

### New IPC

In `packages/desktop/src/shared/ipc.ts` and the main-process handler:

```ts
classifySkillForPublish(name: string): Promise<SkillPublishFlow>;
publishSkill(name: string, options: PublishSkillOptions): Promise<PublishResult>;
getPublishState(name: string): Promise<PublishState>;
getPublishStates(names: string[]): Promise<Map<string, PublishState>>;
```

`publishSkill` orchestrates: validates linked-repo + auth preconditions, classifies the flow, invokes `forkSkill` for Flow 3, then `pushSkillFolder`. Returns a discriminated union:

```ts
type PublishResult =
  | { ok: true; prUrl: string; prNumber: number; updated: boolean }
  | { ok: false; reason: "fork-collision"; existingDir: string }
  | { ok: false; reason: "fork-no-origin" }
  | { ok: false; reason: "fork-swap-failed"; message: string }
  | { ok: false; reason: "fork-confirmation-required" }
  | { ok: false; reason: "no-linked-repo" }
  | { ok: false; reason: "missing-auth" }
  | { ok: false; reason: "rate-limit"; rateLimit: RateLimitInfo }
  | { ok: false; reason: "push-failed"; step: 1|2|3|4|5|6; message: string };
```

Renderer switches on `reason` to drive UI per case.

### New UI surfaces

- **Drawer sectioning** (candidate #6). Four explicit sections: Local agents / Bank / Upstream / Linked repo. Section headers are semantic `<h3>` (or appropriate level) for screen-reader navigability. Within each section, destructive actions sit at the bottom with extra spacing.
- **Publish button** in the Linked-repo section. Primary action when the skill is publish-eligible; disabled when the classifier returns `not-publishable`.
- **publishState chip** beside the Publish button. Combines `publishState` from IPC + the open-PR query at render time:
  - `pushed` + no open PR → `↑ Pushed`
  - `pushed` + open PR → `↑ Pushed (PR #N)` (rare edge case after a merge race)
  - `draft` + no open PR → `● Draft`
  - `draft` + open PR → `● PR #N open`
  - `untracked` → `○ Untracked`
  - `unknown` → `○ Unknown`
- **Fork confirmation modal** (Flow 3 trigger). "Forking severs your vendored copy from `<owner>/<repo>`. Continue?" Single confirm button → calls `publishSkill` with `confirmFork: true`.
- **Collision resolution modal** (Flow 3 + `willCollide: true`). Three resolution paths per ADR-0006: open existing personal skill, revert vendored edits, cancel.
- **PR metadata confirmation modal** (single-skill publish). Editable title + body pre-filled from the classifier's `defaultPrMeta`. Skipped in the (future) bulk publish flow.

### `RegistryEntry` and dependent code

- Remove the `publishState?: PublishState` field from `types.ts`.
- Remove `BuildOptions.publishStates` and the `computePublishStates(registryRoot)` call from `build.ts`'s index-build path. The git path no longer runs at index-build time.
- Rewrite `canon.ts` to take a `PublishState` lookup as input rather than reading `entry.publishState`. Canon-derivation becomes a pure function over `(entry, publishStateLookup)`.
- The renderer's drawer + classifier consume the IPC channels instead of reading `entry.publishState`.

## Milestones

Ordered so no milestone undoes prior work; no milestone overlaps another.

### M1 — Core primitives + test foundation extension

**Scope.** Implement `fork.ts`, `pushSkillFolder` in `upstream.ts`, the dual-mode `publish-state.ts`, and `publish-classify.ts`. Land the three test suite extensions (Suite 6 / 7 / 8) per ADRs 0006 / 0007 / 0008. Add `flipSourceToYours` to `heal.ts`.

**Why first.** Every subsequent milestone consumes these primitives. The ADRs already pinned the invariants; M1 is the implementation against them. Tests gate M2 from regressing.

**Conflict audit.** Removing `publishState` from `RegistryEntry` and `build.ts` is a wire-format change; existing index.json files contain the field, which becomes ignored. The build path stops writing it. Forward-compat: `RegistryEntry.publishState` reads as `undefined` from old indexes; consumers already handle the absence (the chip falls through to the IPC fetch). Backward-compat: not relevant; this is a downstream-only field, never read by tools outside the app.

**Docs.** ADRs are already written. `docs/concepts.md` gets a small update under "Publish" to point at the new primitive names rather than the speculative interfaces previously documented.

### M2 — IPC + classifier wiring

**Scope.** Add the four IPC channels (`classifySkillForPublish`, `publishSkill`, `getPublishState`, `getPublishStates`) to `ipc.ts` and their handlers in `main.ts`. Wire the canon gate to call `detectPublishStateMode` + the appropriate `compute*` function instead of reading `entry.publishState`. Implement the tree cache (5-min TTL, push + rescan invalidation per ADR-0008).

**Why second.** M1 leaves the primitives callable but unreachable from the renderer. M2 makes them reachable without changing UI. After M2, the app can publish via a developer-tool flow (DevTools → `window.skillsBank.publishSkill(...)`); the UI lands in M3.

**Conflict audit.** The canon-gate rewrite touches `canon.ts` and any caller passing a `RegistryEntry` to canon-derivation. The two existing callers (`build.ts`, the IPC handler for `listRegistry`) thread the `PublishState` lookup explicitly. No behavioral change in dev mode; behavioral change in packaged mode is the bug fix.

**Docs.** `docs/personas.md` updates the canon-derivation note to say the lookup is dynamic, not stored.

### M3 — Drawer sectioning + publish UI

**Scope.** Section the drawer per candidate #6. Add the Publish button + chip in the Linked-repo section. Add the fork confirmation modal + collision-resolution modal. Add the PR metadata confirmation modal for single-skill publish.

**Why third.** UI consumes M1 + M2. Lands the full user-facing path.

**Conflict audit.** The drawer already has `role="separator"` divs between action clusters. M3 replaces those with explicit `<h3>` section headers; no IPC, no state change. The publish chip's IPC calls (`getPublishState` + the open-PR query) fire on drawer open; cancellation on close is straightforward via standard React cleanup.

**Docs.** `docs/concepts.md` updates the destructive-action ladder section if action grouping changes. Screenshots flagged for manual update (per the sweep's category 5 inventory): `skill-detail.png`, `skill-detail-yours.png`, `skill-detail-unregistered.png`.

### M4 — Polish + closeout

**Scope.** Toast messages tuned to the discriminated `PublishResult` union. Error states reviewed in the UI for every `reason` variant. Final pass on the drawer's section ordering frequency-of-use (Local agents → Bank → Upstream → Linked repo). Validate `pnpm docs:check` and the screenshot-update flag report.

**Why last.** Catches the rough edges after the full flow is exercised end-to-end. Also the natural point to write the `docs/user-guide.md` Publish section once the UI is stable.

**Conflict audit.** No new code paths; only refinement. The `concepts.md` "Publish" section gets its final form.

**Docs.** `docs/user-guide.md` adds a "Publish" subsection covering the three sub-flows and the Fork confirmation. `docs/personas.md` updates the persona feature comparison if power-persona users gain capabilities here.

## Cross-cutting concerns (no separate milestone)

- **Naming.** The function `acceptDriftSeverUpstream` keeps its name through this plan. The user-facing verb is **Unlink origin** per UL; the function rename to `unlinkOrigin` is a separate refactor.
- **JSON wire format.** `.skills-bank.json`'s `upstream` field name stays per ADR-0002. The type annotation is `OriginPointer` (post-Tier-2 cleanup); the field name is unchanged.
- **Rate-limit budget.** Authenticated GitHub calls are 5000/hr. A publish operation costs ≤25 calls per skill (Invariant 1 of ADR-0007). The publishState tree probe (Invariant 7 of ADR-0008) costs ~1 call per 5-minute cache window. Heavy bulk activity (post-v1) would push this; the per-skill cost is the natural cap.

## Out of scope

- Multi-linked-repo coexistence (one linked repo at a time).
- Publishing without a linked repo (the bundled-registry persona).
- Bulk publish (per-skill primitive ships first; bulk is a thin loop in a follow-up).
- Replacing the existing maintainer CLI flows (`pnpm vendor:skill`, `pnpm update:skill`); they stay alongside.
- Webhooks or push notifications for cross-machine publish-state sync.
- The function rename of `acceptDriftSeverUpstream` and the JSON field rename of `upstream` → `origin`.
