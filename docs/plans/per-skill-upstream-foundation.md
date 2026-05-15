# Per-skill upstream foundation (planned)

This plan fills the missing layer in the data model: every skill has its own origin and update lifecycle, independent of how the registry collection is replicated. Today, Skills Bank tracks registry-level provenance (bundled vs. yours) but not skill-level provenance — a skill installed via `npx skills add foo` carries no record of where it came from or how to update it.

This plan establishes the foundation: per-skill upstream pointers, a probe for newer versions, an update action that re-runs `npx skills add` and lands the result in the right place regardless of adoption, and drift attribution that distinguishes "upstream pushed an update" from "user hand-edited."

The bank-mode persistence layer (cache snapshots, recovery if upstream disappears) is plan 04. The in-app install path from the Discover tab is plan 05.

## Depends on

None. The plan establishes its own data model and APIs.

## Goals

1. Every registered skill carries an `upstream` pointer when its origin is known (skills.sh package). Pointers survive registration, adoption, and re-installation.
2. Skills with a known skills.sh upstream are checked for newer versions in-app, with a one-click update.
3. Adoption no longer silently severs the upstream relationship. The pointer travels with the skill regardless of whether files live in the registry or in an agent dir.
4. Drift detection distinguishes "upstream pushed an update" from "user hand-edited."
5. The maintainer's existing bundled skills and deployed registry are aligned to the new schema via one-time scripts; future installers receive correctly-stamped data from day one.

## Non-goals

- Becoming a package manager. The plan tracks origin pointers and triggers refetches via the existing `npx skills add` tool; it doesn't reimplement dependency resolution.
- Bank-mode persistence (cache snapshots, upstream-unreachable recovery). Plan 04.
- In-app install from Discover tab. Plan 05; uses this plan's npx invocation infrastructure.
- Git-sourced upstreams (`kind: "git"`). The `UpstreamPointer` schema reserves the type but doesn't wire a probe or update action. Skills cloned from arbitrary GitHub repos get passive metadata only.
- Backwards-compatibility shims for the `SkillSource` schema. Existing `.skills-bank.json` files without `upstream` continue to work; missing pointer = unknown lineage = today's behavior. The backfill scripts bring known cases up to the new schema; unknown cases stay unknown.

## Scope

### Schema extension

`packages/core/src/source.ts`:

```ts
type SkillOrigin = "bundled" | "yours";
type UpstreamKind = "skills-sh" | "git" | "none";

interface UpstreamPointer {
  kind: UpstreamKind;
  package?: string; // skills-sh
  version?: string; // skills-sh
  repo?: string; // git (reserved; no probe/update wired in v1)
  ref?: string; // git (reserved)
  contentHash?: string; // SHA-256 of skill dir at fetch time
  fetchedAt?: string;
}

interface SkillSource {
  source: SkillOrigin;
  syncedFromCommit?: string;
  syncedAt?: string;
  upstream?: UpstreamPointer; // NEW
}
```

`readSkillSource` / `writeSkillSource` round-trip the new field. Missing `upstream` reads as undefined; reading is fully backward-compatible.

### Update probe

A periodic check against skills.sh for each registered skill with `upstream.kind === "skills-sh"`. Surfaces:

- Per-card chip: **"Update available"** (small, anchored bottom-right of the card body).
- Header aggregate indicator: count badge linking to an `UpdatesModal` listing all available updates.

Cadence: on app open + every 6 hours while running. Cached per-skill with a 5-minute minimum interval to avoid spam. Failures don't block the app; transient failures are absorbed silently. (Persistent unreachability becomes a state in plan 04.)

Implementation: new module `packages/core/src/upstream.ts` exports `probeSkill(pointer)` returning `{ latestVersion, fetchedAt }`. The implementation prefers a skills.sh API (research item #1 in Open questions); fallback is to shell `npx skills info <pkg>` or `--dry-run` and parse output.

### Update action

A drawer button — **Update this skill** — appears when the probe reports a newer version. Behavior depends on adoption:

- **Tracked (`adopted: false`).** Run `npx skills add <pkg>` against the recorded agent dir. Skills Bank's existing scan picks up the new content. Update the stored `version`, `contentHash`, `fetchedAt`.
- **Adopted (`adopted: true`).** Run `npx skills add` in a temp dir, then copy the result into `<registryRoot>/skills/<name>/`, then re-stamp.

Either way, **adoption no longer severs the upstream relationship.** The pointer travels with the skill.

### Fallback origin-capture scanner

For users who run `npx skills add` directly in their terminal (via the Discover tab's "Open Terminal" escape hatch, fresh-machine bootstrap scripts, npx outside the app), the in-app install path doesn't fire. The scanner backfills:

1. On every index walk, identify skills in agent dirs that have no `upstream` pointer.
2. For each unstamped skill, probe skills.sh for a package whose name matches.
3. If matched with high confidence (exact name match, current installed version readable), stamp `upstream: { kind: "skills-sh", package, version, ... }`.
4. Ambiguous matches go to the drawer's manual upstream picker rather than being silently mis-stamped.

### Manual upstream picker

The `SkillDetailDrawer` for skills without an `upstream` pointer surfaces a small **"Where did this come from?"** disclosure. Clicking opens a picker:

- **Skip** — leave unstamped (default).
- **skills.sh package...** — text input for package name; validates against skills.sh on save.
- **Other / unknown** — explicit "this is mine" stamp (sets `upstream.kind = "none"`, suppressing future scanner attempts to classify).

### Drift attribution split

Today, `bundled-skill-edited` fires when the on-disk hash differs from the synced-baseline hash. With per-skill upstream pointers, drift splits into:

- **`upstream-update-available`** — upstream version > stored version. Capability: `canUpdate`.
- **`user-edited-with-upstream`** — content hash differs from stored `contentHash`, but version matches. Capabilities: `canAcceptDrift` (sever upstream, keep edits, becomes `source: "yours"`), `canTakeUpstream` (revert content to upstream).
- **`bundled-skill-edited`** — preserved semantics for bundled skills _without_ an upstream pointer.

The new states route through `classifyDrawerState` in `packages/core/src/skill-state.ts`. Add `canUpdate`, `canTakeUpstream` to `DrawerCapabilities`.

### UpdatesModal

A modal listing every skill with `upstream-update-available`. Per row: skill name, current version → new version, **Update** button, **View skill** link (opens drawer). An **Update all** button runs updates sequentially with progress.

Triggered from the Header aggregate indicator.

### Header aggregate indicator

When updates are available, a small badge appears next to the existing header chrome (sync button if local-bundled, refresh-from-repo if github-linked). Click → opens `UpdatesModal`.

### One-time alignment scripts

Two maintainer-internal scripts ship in `scripts/`:

**`scripts/backfill-bundled-upstream.ts`** — for the repo's checked-in bundled set:

1. For each `skills/<name>/` in this repo, read the existing `.skills-bank.json`.
2. Resolve the skill's upstream via a maintainer-curated mapping (`scripts/bundled-upstream-mapping.json`, hand-maintained as part of the curation pipeline) and/or a skills.sh probe.
3. Write `upstream: { kind: "skills-sh", package, version, contentHash, fetchedAt: now }` into the source marker.
4. Log unstamped skills for manual classification.

Run once by the maintainer; resulting `.skills-bank.json` changes get committed alongside the data-model PR.

**`scripts/backfill-deployed-upstream.ts`** — for the maintainer's deployed registry:

1. Resolve the registry root via the same `resolveRegistryRoot()` the desktop app uses.
2. For each skill, read its current `.skills-bank.json`.
3. If `source === "bundled"`, no work (Script 1's output ships via the next sync).
4. If `source === "yours"` and the name matches a known skills.sh package (probe), prompt for confirmation, stamp `upstream`.
5. Report unstamped + ambiguous.

Run once; mutates the deployed registry directly; no commits.

Neither script ships as user-facing tooling. Future installers get correctly-stamped data via Script 1's output baked into the repo and via the runtime origin-capture paths.

## Files this PR will touch

- `packages/core/src/source.ts` — schema extension; `UpstreamPointer` type; round-trip read/write.
- `packages/core/src/skill-state.ts` — new drawer states + capabilities.
- **New**: `packages/core/src/upstream.ts` — probe + update orchestration; skills.sh API interface; npx invocation primitives (reused by plan 05).
- `packages/core/src/build.ts` — fallback origin-capture scanner integrated into the index walk.
- `packages/desktop/src/main/main.ts` — IPC handlers for `upstream:probeAll`, `upstream:probeSkill`, `upstream:updateSkill`.
- `packages/desktop/src/shared/ipc.ts` — new channels + types.
- `packages/desktop/src/renderer/components/SkillCard.tsx` — "Update available" chip.
- `packages/desktop/src/renderer/components/SkillDetailDrawer.tsx` — Update action + new heal arms; "Where did this come from?" picker for unstamped skills.
- `packages/desktop/src/renderer/components/Header.tsx` — aggregate updates indicator badge.
- **New**: `packages/desktop/src/renderer/components/UpdatesModal.tsx` — aggregate updates list.
- **New**: `scripts/backfill-bundled-upstream.ts` — repo-level alignment.
- **New**: `scripts/backfill-deployed-upstream.ts` — local-registry alignment.
- **New**: `scripts/bundled-upstream-mapping.json` — maintainer-curated mapping fed into Script 1.

## Verification

### Origin capture (fallback path)

- Run `npx skills add foo` in a terminal (bypassing in-app install — plan 05 covers the primary path). Reopen Skills Bank. The skill appears in Installed → Not registered with inferred `upstream: { kind: "skills-sh", package: "foo", version: "1.0.0" }`.
- Register-as-tracked: upstream survives.
- Register-as-adopted: upstream survives, lives in the registry copy.

### Update flow

- Bump the upstream package version. Reopen the app or wait for the probe. Card shows "Update available." Drawer Update action runs npx and bumps the version, for both tracked and adopted skills.
- **Update all** from the UpdatesModal applies multiple updates sequentially with progress.

### Drift attribution

- Edit a tracked skill's `SKILL.md` locally without an upstream version bump. Drawer state fires `user-edited-with-upstream` (not `upstream-update-available`); Keep edits / Revert to upstream both work.
- Bundled skill _without_ an upstream pointer + content drift: still routes to `bundled-skill-edited` (preserved behavior).

### Manual upstream picker

- An unregistered skill with no `upstream` pointer: drawer shows the disclosure. Picking "skills.sh package foo" stamps the pointer; validates against skills.sh.

### Alignment scripts

- Run `scripts/backfill-bundled-upstream.ts`. Inspect `.skills-bank.json` files: matched skills carry `upstream`; unmatched reported. Re-run is idempotent.
- Run `scripts/backfill-deployed-upstream.ts` against the maintainer's deployed registry. Bundled skills (already stamped via Script 1) are skipped; ambiguous user-skills prompt for confirmation.

## Open questions

1. **skills.sh API surface.** Does it expose a "latest version of package X" query cheaper than running npx? Fallback: shell out `npx skills info <pkg>` or `--dry-run <pkg>` and parse. Research before committing to the probe implementation.
2. **`npx skills add` exit semantics.** Parseable result? JSON output? Distinct exit codes for "already up to date" vs "updated" vs "not found"? Needed for clean result surfacing.
3. **Probe rate limiting.** A user with 100 skills with upstream pointers means 100 requests per probe cycle. Skills.sh's rate-limit posture isn't documented in our code. Cache aggressively; batch probes if the API supports it.
4. **Bundled-curation pipeline.** Script 1 requires `scripts/bundled-upstream-mapping.json` to be hand-maintained. The mapping is small (one entry per bundled skill) and stable, but the maintainer's existing bundled-curation tool needs to know about it. Defer the curation-tool integration until after Script 1 is proven in a one-off run.
