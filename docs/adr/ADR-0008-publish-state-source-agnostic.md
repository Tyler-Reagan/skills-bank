# ADR-0008 — Publish-state computation: dual-mode, compute-on-call

**Status:** Proposed (post-v1.0)

## Context

The in-app Publish flow (planned post-v1.0) has multiple consumers of
the per-skill `publishState` value:

- **The canon gate** in `canon.ts` derives the runtime `canon` boolean
  partially from `publishState === "pushed"` (per `docs/personas.md`).
- **The classifier** `classifySkillForPublish` (per the architecture
  pass — candidate #5) reads `publishState` to route a skill into one
  of the three publish sub-flows (new / safekeeping / fork).
- **The drawer chip** (candidate #6) renders `publishState` next to
  the Publish button as the user's pre-flight state signal.

Today `publishState` is computed by `computePublishStates` in
`publish-state.ts` — a function that shells out to `git` via
`execSync` and reads `git log --porcelain` plus
`git rev-list <upstream>..HEAD`. The result is cached on
`RegistryEntry.publishState` at index-build time.

This breaks in the packaged Electron app, for the same reason
ADR-0003 forbids shelling out to `npx`: GUI-launched apps on macOS
don't inherit the user's shell `$PATH`, so `git` isn't reliably
available. In packaged-app instances, `publishState` falls back to
`unknown` for every skill, and:

- The canon gate misbehaves — `canon` never derives, destructive
  actions are ungated for canon skills.
- The classifier can't accurately decide between sub-flows.
- The chip would show `unknown` permanently, defeating its purpose.

The architecture pass identified this as the second-most-important
deepening candidate (after the GitHub-API trio in candidate #1).
Resolving it requires two computation paths — git for dev mode,
GitHub REST API for packaged mode — under one stable interface.

## Decision

Seven pinned invariants for the new dual-mode computation.

### Invariant 1 — Vocabulary unchanged

`publishState` remains a four-value discriminated union:

```ts
type PublishState = "pushed" | "draft" | "untracked" | "unknown";
```

The chip composes `publishState` with a separately-queried "has open
PR" signal at the render layer. The PR-state question doesn't enter
the vocabulary; it remains an orthogonal signal.

### Invariant 2 — "Pushed" is the git interpretation

`pushed` means: **the linked repo's default branch contains the
skill's latest local commit.** Skills with an open PR but unmerged
content are `draft`, not `pushed`. Once the PR merges and the local
working copy tracks the merged content, the skill becomes `pushed`.

This interpretation stays stable across both computation modes:

- **Git mode** answers directly via `git rev-list <upstream>..HEAD`.
- **Remote-API mode** answers by comparing the local skill folder's
  hash against the linked repo's default-branch tree at the same
  path. Match → `pushed`; differ → `draft` (or `untracked`; see
  Invariant 6).

### Invariant 3 — Two pure functions + a thin auto-detector

`packages/core/src/publish-state.ts` exports three primitives:

```ts
export function computePublishStatesFromGit(
  registryRoot: string,
): Map<string, PublishState>;

export function computePublishStatesFromRemote(opts: {
  registryRoot: string;
  repo: string; // "owner/name" of the linked repo
  token: string | null;
  baseBranch?: string; // defaults to "main"
}): Promise<Map<string, PublishState>>;

export type PublishStateMode =
  | { kind: "git" }
  | { kind: "remote"; repo: string; token: string | null };

export function detectPublishStateMode(
  registryRoot: string,
  ctx: { linkedRepo: LinkedRepoMetadata | null; token: string | null },
): PublishStateMode | null; // null when neither mode is viable
```

`detectPublishStateMode` is the single place that decides which path
to take. Consumers call it once at startup (or on linked-repo change)
and cache the result. The pure functions are each testable in
isolation; the auto-detector is testable against fixtures of
`{ registryRoot, linkedRepo, token }` triples.

No try-git-fall-back-to-API magic. A transient git failure in dev
mode doesn't silently flip the consumer to the remote path — that
would dress up a regression as resilience.

### Invariant 4 — API path: single tree probe + per-skill hash compare

`computePublishStatesFromRemote` makes **one** GitHub API call (the
linked repo's recursive tree probe via the existing `probeOriginTree`
in `upstream.ts`) and then performs per-skill folder-hash comparisons
locally via the existing `hashSkillFolder` in `heal.ts`.

For each `<bucket>/<name>` in `walkSkills(registryRoot)`:

- Compute `localHash = hashSkillFolder(<registryRoot>/skills/<bucket>/<name>/)`.
- Find `remoteHash = findFolderHash(probedTree, "skills/<bucket>/<name>")`.
- If `remoteHash === null` → folder not on remote → `draft` (or
  `untracked` per Invariant 6).
- If `localHash === remoteHash` → `pushed`.
- Otherwise → `draft` (or `untracked`).

Cost: one `GET /repos/<owner>/<repo>/git/trees/<sha>?recursive=true`
plus N local hash computations (typically ≤ 80 skills with ≤ 10 files
each). API budget impact: ~1 call per 5 minutes of active session
under the cache TTL (Invariant 7), negligible against the
authenticated 5000/hr ceiling.

### Invariant 5 — Truncated tree returns all `unknown`

When `probeOriginTree` reports `truncated: true`, the function
returns a map of every walked skill name to `"unknown"` and surfaces
a structured warning to the caller (matching `mirrorSkillFolder`'s
existing truncation discipline — refuse rather than guess). The chip
falls back to `○ Unknown`; the canon gate treats `unknown` as
not-pushed (preserves the gate's "default to safe" stance).

### Invariant 6 — Packaged-app `draft`/`untracked` collapse

Without a git working tree, the remote-API path cannot distinguish
"committed but unpushed" from "uncommitted local edit." Both
collapse to `draft`. The vocabulary stays at four values; one path
emits three of them (`pushed`, `draft`, `unknown`) and the other
emits all four. Consumers treating the values uniformly suffer no
harm — the four-value union remains the API contract.

This is the honest tradeoff; surfacing it explicitly here so future
maintainers don't try to "fix" the collapse by inventing a fifth
value or reaching for an in-process git library inside packaged
Electron.

### Invariant 7 — Compute-on-call with a 5-minute tree cache

`publishState` is **not** stored on `RegistryEntry`. Every consumer
that needs the value calls the appropriate function (via IPC for
renderer consumers; directly for main-process consumers).

The expensive part — the linked-repo tree probe in the remote-API
path — is cached in main-process memory with a 5-minute TTL. The
cache is invalidated proactively on:

- A successful `pushSkillFolder` invocation (we changed the tree
  ourselves; next read should fetch fresh).
- A user-initiated rescan (`pnpm build:index` in dev; the Rescan
  button in the app).

Other mutations (`applyOriginUpdate`, `forkSkill`, `installSkill`)
don't change the linked repo's tree, so the cache stays valid through
them.

The git path doesn't need a cache — `execSync` is fast and the source
of truth is right next to the process.

Dropping the `RegistryEntry.publishState` field tightens
`RegistryEntry` to its static state (name, description, tags, source
marker, bucket). Dynamic linked-repo state lives in
`publish-state.ts` and is asked-for, not cached on the entry.

## Test foundation extension

Suite 8 in `packages/core/src/publish-state.test.ts`, extending
ADR-0001's foundation per the precedent set by Suite 6 (ADR-0006)
and Suite 7 (ADR-0007).

Coverage:

- **Git path** — fixture-driven test of `computePublishStatesFromGit`
  for the four-value emission across the existing
  `untracked` / `draft` / `pushed` / `unknown` cases the prior
  implementation already covered. The fixtures live in a
  `tmpdir + git init + git commit` setup matching the existing
  pattern in `heal.test.ts`.
- **Remote-API path** — fixture-driven test of
  `computePublishStatesFromRemote` using a mock `probeOriginTree`
  result. The local hashes come from `hashSkillFolder` against a
  fixture directory. Cases:
  - All hashes match → all `pushed`.
  - One folder missing on remote → that skill `draft`, others `pushed`.
  - One folder hash differs → that skill `draft`, others `pushed`.
  - Probe returns `truncated: true` → all `unknown`.
  - Probe returns error → propagated as error (not silently `unknown`
    — caller distinguishes "transient failure" from "definitive
    not-pushed").
- **Auto-detector** — `detectPublishStateMode` returns the correct
  mode for the cross product of (git available y/n, linkedRepo
  present y/n, token present y/n). Includes the `null` case (no mode
  viable: not in git, not linked, no token).
- **Cache invalidation** — the tree cache invalidates on push
  success and on rescan; survives other mutations. Tests use a
  fake clock to verify the 5-minute TTL.

## Consequences

- `RegistryEntry.publishState` is removed from `types.ts`. The
  `computePublishStates` field on `BuildOptions` and the
  `publishStates` plumbing in `build.ts` go with it.
- `canon.ts`'s canon-derivation that reads `entry.publishState` is
  rewritten to take a `PublishState` lookup as input. The canon
  module shouldn't know which mode produced the value.
- A new IPC channel `getPublishState(name)` (or batch:
  `getPublishStates(names[])`) returns the current value to the
  renderer. The chip and classifier call this; main-process
  consumers (canon gate, IPC handlers) call the functions directly.
- `LinkedRepoMetadata` becomes load-bearing as input to the
  auto-detector. The detector lives in `core` and accepts it as a
  plain interface; `core` doesn't import from `main`.
- The git path's `execSync` calls remain unchanged. Behavior in
  dev mode is bit-equivalent to today's — the existing maintainer
  workflow doesn't notice the refactor.
- Packaged-app instances start computing `publishState` correctly
  for the first time. Canon gate behavior changes for canon skills
  whose remote state previously read as `unknown` and now reads as
  `pushed` — this is the bug fix the ADR exists to ship.

## Re-opening this decision

The "compute-on-call + cache the tree" strategy might bite if a
future consumer requires per-skill freshness at sub-5-minute
granularity (e.g. a live status indicator that updates as a
collaborator pushes to the linked repo). Three options when that
comes:

1. Lower the TTL. Cheap; trades API quota for freshness. Within the
   5000/hr authenticated budget, the TTL can drop to 1 minute before
   meaningful pressure.
2. Add a push-notification channel — GitHub webhooks delivered to a
   local listener, or polling the `Last-Modified` header on the tree
   endpoint. Significant infra change; defer until concrete need.
3. Re-introduce the cached `RegistryEntry.publishState` field with
   explicit invalidation on every mutation path. Reverses this ADR's
   tightening; would require this ADR to be amended.

Option 1 is the cheapest path if the need arises. Do not preemptively
lower the TTL or reintroduce the field.
