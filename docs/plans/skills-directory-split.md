# Skills directory split (planned, v0.11.3)

Spatially separates self-authored skills from harvested ones by introducing two subdirectories under `skills/`:

```
skills/
  personal/
    <self-authored>/SKILL.md
  vendored/
    <harvested>/SKILL.md
```

Today's structure is flat — 66 sibling folders with no visual signal about whether a given skill was authored by the maintainer or vendored from an external author. Markers (post-v0.11.2) carry the authoritative-origin info but it's only visible when you open `.skills-bank.json`. This plan promotes that distinction to the directory level.

## Depends on

`origin-paradigm-reframe` (v0.11.2, already merged). Markers now point at authoritative upstreams, so categorizing by "is this self-authored or harvested?" is a deterministic read of `upstream.repo === BUNDLED_REPO` for the bundled-default registry.

## Goals

1. Every skill in this repo lives under exactly one of `skills/personal/<name>/` or `skills/vendored/<name>/`. No skill at the flat `skills/<name>/` level.
2. Every code site that walks `<root>/skills/<name>/` is refactored to descend through the bucket level — exactly once, via a single shared helper.
3. Names remain globally unique across buckets (a skill named `foo` can only exist in one bucket). Validation surfaces collisions at index-build time.
4. The maintainer-facing `pnpm vendor:skill` defaults to writing into `skills/vendored/`; future self-authoring goes into `skills/personal/`.
5. Forward-compatible to the eventual `Tyler-Reagan/personal-skills` repo split: `git subtree split --prefix=skills/personal -b personal-skills` extracts the personal subtree in one command.

## Non-goals

- No `skills/archived/` bucket. Tracked in the plan as v0.12+ but explicitly out of scope here.
- No backwards-compatibility shim for the flat layout. We're pre-1.0; cut hard per CLAUDE.md.
- No skill renames or content changes. Pure spatial reorganization.
- No deprecation logic for the manual picker. The picker validates against GitHub regardless of bucket; the only new constraint is bucket selection on save (defaults to `personal` since that's typically the user's intent when picking manually).
- No CLI-installed-skill bucket. `npx skills` writes to `~/.agents/skills/<name>/` (flat by its own convention); we don't restructure their tree.

## Categorization rules

A skill belongs in `skills/personal/` iff one of:

1. Its `.skills-bank.json` has `upstream.repo === BUNDLED_REPO` (self-referential — the maintainer authored it in this repo).
2. Its `.skills-bank.json` has `upstream.kind === "none"` (explicitly self-authored, no upstream).
3. No marker exists yet AND the skill is bundled — assumed self-authored until proven otherwise (rare given v0.11.2's backfill, but possible for hand-added new skills before they're vendored).

Otherwise → `skills/vendored/`.

For the 66 existing bundled skills, the categorization is mechanical: rule (1) catches the 4 self-referential markers (`gitlab-ci-inspector`, `gitlab-mr-writing`, `pretty-mermaid`, `terraform-plan-summary`); everything else goes to `vendored/`.

The 6 currently-untracked locally-installed skills (`caveman`, `convert-web-app`, `grill-me`, `grill-with-docs`, `improve-codebase-architecture`, `zoom-out`) all have markers pointing at `mattpocock/skills` (or `modelcontextprotocol/ext-apps` for `convert-web-app`) — they go to `vendored/`.

## Scope

### 1. Shared walker — `walkSkills`

New function in `packages/core/src/registry.ts`:

```ts
export type SkillBucket = "personal" | "vendored";

export interface SkillFolderRef {
  name: string;
  bucket: SkillBucket;
  /** Absolute path to the skill folder on disk. */
  dir: string;
  /** Relative path from registryRoot — e.g. "skills/vendored/foo". */
  relPath: string;
}

export function walkSkills(registryRoot: string): SkillFolderRef[];
```

Reads `<registryRoot>/skills/personal/*` and `<registryRoot>/skills/vendored/*`. Filters to directories. Returns flat list with bucket attribution. Collision detection: if a name appears in both buckets, walk throws an error listing the colliding name and both paths. Index-build can choose to throw or warn-and-skip; default behavior is throw (CI catches the case).

Every existing `fs.readdirSync(skillsDir)` caller migrates to `walkSkills(registryRoot)`. The list is ~10 call sites identified in pre-plan audit (`build.ts`, `installed.ts`, `skill-lock.ts`, plus scripts and main.ts).

### 2. Bucket-aware path resolution

`resolveEntryPath` already reads `entry.path`, so it works transparently if `buildRegistryIndex` writes the bucket-included relative path. `entry.path` becomes `skills/personal/foo` or `skills/vendored/foo` instead of `skills/foo`. Mechanical change in `build.ts`.

`RegistryEntry` gets a new derived field:

```ts
export interface RegistryEntry {
  name: string;
  path: string;          // "skills/<bucket>/<name>"
  bucket: SkillBucket;   // NEW — derived from path during walk
  // ...existing fields
}
```

Consumers that want to filter / group / display by bucket read `entry.bucket` directly. Renderer can use this for the Browse tab grouping (future enhancement, not this plan).

### 3. The `git mv` sweep

Move every checked-in skill to its categorized bucket via `git mv` (preserves history per file):

```
git mv skills/<name>/ skills/<bucket>/<name>/
```

For the ~60 tracked skills, scripted in a single migration script run once locally (not committed):

```ts
// scripts/migrate-bucket-split.ts (one-shot; deleted after run)
for each tracked skill folder:
  determine bucket via the rules above
  git mv it
```

Run once on this branch, verify the resulting tree, commit.

For the 6 currently-untracked locally-installed skills: they get added to `skills/vendored/` AS PART OF THIS PLAN (the directory split is the natural point to formalize them in the bundle). Their `.skills-bank.json` files already exist on disk from earlier maintainer work — they get committed alongside content.

### 4. Bucket selection in `vendor:skill`

`scripts/vendor-skill.ts` defaults destination to `skills/vendored/<name>/`. Add a `--personal` flag for the (rare) case of using vendor:skill on something the maintainer authored elsewhere and is now folding into the personal bucket.

Marker writes from vendor:skill keep their current shape; bucket isn't stored in the marker, only in the path. (If we later move a skill between buckets, only path changes — markers don't need updating.)

### 5. `stamp:self-authored` and `discover:bundled --apply`

`stamp:self-authored` walks only `skills/personal/*/` going forward (since by definition self-authored markers belong there). When invoked, it's stamping skills that already live in `personal/` but haven't yet had their `.skills-bank.json` marker written.

`discover:bundled --apply` walks only `skills/vendored/*/` (discovered upstreams are by definition harvested).

Both scripts get an early-exit if invoked against a registry whose `skills/` subtree doesn't have the bucket layout, with a clear message pointing at this plan.

### 6. `validate-all` + `build:index` updates

`scripts/validate-all.ts` uses `walkSkills` instead of its own folder iteration. Bucket info goes into validation errors for context (e.g. `✖ skills/vendored/foo: missing meta.json`).

`scripts/build-index.ts` similarly uses `walkSkills`. The output `index.json` now includes `bucket` on every entry.

### 7. CLAUDE.md update

Document the new layout under "Repo orientation." Add a note in the agent-facing scripts table that `vendor:skill` defaults to `vendored/` and `--personal` overrides.

## Schema audit (no change)

The `UpstreamPointer` and `SkillSource` schemas are unchanged. Bucket is *not* a marker field — it's purely a path-level concept derived from where the folder lives.

`RegistryEntry.bucket` is new but additive; existing consumers ignoring the field continue to work.

## Execution order

Single PR. The sweep is atomic — partial completion would leave the codebase in a broken state where some skills are at flat paths and some aren't.

Commit order within the PR:
1. **`walkSkills` + bucket type** — pure addition, no callers yet.
2. **`RegistryEntry.bucket` field + `buildRegistryIndex` bucket-awareness** — index walk now uses `walkSkills`.
3. **Refactor every consumer** — migrate `installed.ts`, `skill-lock.ts`, `import.ts`, `main.ts`, scripts. Each commit ~1-2 files.
4. **One-shot `git mv` migration** — moves all 60 tracked skills + commits the 6 currently-untracked ones into `vendored/`. Single commit, ~70 file renames.
5. **CLAUDE.md + glossary update** — document the new layout, add `Bucket` term to `UBIQUITOUS_LANGUAGE.md`.

Total: ~5-7 commits, one PR.

## Verification

- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm build` clean.
- `pnpm knip` no new unused exports.
- `git ls-files skills/` shows zero entries directly under `skills/<name>/` — every entry is under `skills/<bucket>/<name>/`.
- Spot-check: open the app, browse skills tab, every skill should still render. Open a drawer — content matches what was at the old flat path.
- `find skills -name SKILL.md | wc -l` = 66 (or +6 = 72 if we commit the previously-untracked).
- `git subtree split --prefix=skills/personal -b _test-extract && git branch -D _test-extract` proves the future repo split is one command.

## Open / deferred questions

- **`skills/archived/` bucket** — tracked for v0.12+. Will hold deprecated skills the maintainer wants to retain history of but doesn't ship. Triggered by either a `.skills-bank.json` flag or a manual `git mv` to the bucket.
- **Bucket transitions** — if a vendored skill becomes maintainer-owned (e.g. you forked it and severed the upstream), should the app prompt to move it to `personal/`? Out of scope. Maintainer does this manually with `git mv` when ready.
- **End-user bucket UI** — should the Browse tab visually distinguish personal vs vendored on the maintainer's machine? Eventual feature; not part of this plan. The data is there (`entry.bucket`) when wanted.

## Conflict audit

- **`in-app-install-from-discover` (plan 05)** — new installs from Discover will need a default destination bucket. Mirror `vendor:skill`'s default: `vendored/` for anything coming from an external repo via the Discover tab.
- **`bank-mode-persistence` (plan 04)** — snapshot cache will need to record the bucket alongside content for restore. Trivial addition since bucket lives in path.
- **Existing `RegistryEntry.path`** — value format changes from `skills/<name>` to `skills/<bucket>/<name>`. Anything in the renderer that string-manipulates this path (rather than treating it as opaque) needs review. Pre-plan grep showed no string-parsing of `entry.path` in the renderer; it's only passed to `resolveEntryPath`.
