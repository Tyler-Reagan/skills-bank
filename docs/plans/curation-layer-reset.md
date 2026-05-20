# Curation-layer reset + registry manifest (planned, v1.1)

This is Phase 1 of the post-v1.0 roadmap. A single PR against
`Tyler-Reagan/skills-bank`, plus the external creation of
`Tyler-Reagan/skills` from a `git subtree split` of the same PR's
working tree.

The plan resets the curation layer to a deliberately minimal **Bundled
set** (just `find-skills`), extracts the maintainer's authored skills
into their own **Origin repo** (`Tyler-Reagan/skills`), and ships a
new metadata-only **Registry manifest** mechanism with `userData`
auto-snapshots. The terminology used in this plan matches the v1.1
codebase; Phase 2 renames the `bundled`/`yours` source-axis values to
`curated`/`user`, but that's out of scope here.

## Depends on

- v1.0.0 shipped.
- No hard dependencies on Phase 2+ work in this repository.
- External: a new GitHub repo `Tyler-Reagan/skills` must be created
  (one-time, by hand) so the subtree-split branch has a destination
  to push to. This happens during Phase 1 execution, not before.

## Goals

1. The curation layer ships a deliberately curated, minimal **Bundled
   set** — MVP is `find-skills` alone.
2. The maintainer's authored skills live in their own **Origin repo**
   (`Tyler-Reagan/skills`), not in a sub-bucket of the curation
   layer.
3. **Registry portability** across machines via a new metadata-only
   **Registry manifest** export/import path, usable with or without a
   **Linked repo**.
4. Zero-effort backup via `userData` auto-snapshots (rotating last
   five), so the manifest concept lands for every user — including
   those with no linked repo.
5. The bucket layout (`skills/{personal,vendored}/<name>/`) is an
   **app-internal** convention used by the active registry root the
   app manages. Remote repos — origin repos, linked repos, the
   curated/bundled repo itself — may use any layout. The app
   discovers skills in remotes by file convention (presence of
   `SKILL.md` and/or `meta.json`) and mounts each into the local
   registry under the appropriate bucket on link. A linked repo that
   pre-existed Skills Bank does not have to reshape its tree to be
   linkable.

## Non-goals

- **Vocabulary rename** (`bundled` → `curated`, `yours` → `user`,
  drop `YOURS` badge). Phase 2 owns this.
- **Persona-collapse** (remove first-launch persona fork; move
  GitHub-linking to Settings). Phase 2 owns this.
- **Renaming `acceptDriftSeverUpstream` → `unlinkOrigin`** and
  **`SkillSource.upstream` → `origin`** (JSON wire field). Folded
  into Phase 2's vocabulary cleanup pass.
- **Content-bearing registry export.** The existing `exportRegistry`
  (content `.zip`) is `@deprecated` post-v1.1; removal lands one
  minor cycle later per post-1.0 backcompat discipline. The new
  registry-level concept is the **Registry manifest**.
- **Multi-linked-repo support** for the maintainer. The maintainer
  operates the curation layer via scripts; the app's linked repo is
  for end-user use, pointing at `Tyler-Reagan/skills`.
- **Bulk publish / bulk safekeeping.** Phase 5 owns this; it's also
  where the maintainer's personal-continuity migration of the 62
  displaced vendored skills happens.

## Scope

### 1. Curation-layer reset

Delete 62 of 63 directories under `skills/vendored/`. Keep only
`find-skills`. The deletion is a content change, not a structural
one — `walkSkills` continues to walk `skills/vendored/*` and yields
the single remaining entry.

Rationale: today's vendored set was accumulated through maintainer
curation over time. It was implicitly the **Bundled set**, but it's
effectively the maintainer's personal working set. A deliberate MVP
(`find-skills` only) cleanly separates "what the app ships by
default" from "what the maintainer happens to use." `find-skills`
itself is the right MVP because its purpose — helping users find
skills — is the right out-of-box experience for new users who will
then install other skills via Phase 3's Discover flow.

The 62 deleted skills retain their upstream-origin validity: their
content lives at its actual origin (a third-party GitHub repo).
They are reinstallable via Discover (Phase 3). Until Phase 3 ships,
they are not reachable through the app, which is acceptable because
no external users exist at this point.

### 2. Origin extraction

```sh
git subtree split --prefix=skills/personal -b skills-export
# (external) create Tyler-Reagan/skills, then:
git push git@github.com:Tyler-Reagan/skills.git skills-export:main
# back in skills-bank:
git rm -r skills/personal/
git branch -D skills-export  # clean up
```

This extracts the four authored skills with full history preserved
at commit level:

- `gitlab-ci-inspector`
- `gitlab-mr-writing`
- `pretty-mermaid`
- `terraform-plan-summary`

Branch/tag topology does not transfer; that's acceptable per
ADR-style "history preserved at commit level" precedent.

After the split, `skills/personal/` no longer exists in the curation
layer. The four skills live at the root of `Tyler-Reagan/skills` —
`<repo-root>/<skill-name>/` — because `git subtree split --prefix`
strips the prefix on extraction. That flat layout is intentionally
preserved: scope item 10 below makes the link/sync flow discover
skills by file convention, so the four skills are findable wherever
the maintainer puts them inside the repo. The **Bucket** UL
definition is being narrowed in this same scope expansion to refer
only to the app-internal layout (per goal #5).

`Tyler-Reagan/skills` is, in UL terms, simultaneously:

- An **Origin repo** (for the four authored skills, each pointing at
  this repo as its own origin).
- A **Linked repo** (when the maintainer connects it as their
  end-user "Your own registry").

Both UL concepts already cover this case; no new term needed.

### 3. Rename references

Six documentary references to `Tyler-Reagan/personal-skills` →
`Tyler-Reagan/skills`. None are load-bearing for code paths
(`origin-paradigm-reframe.md` explicitly confirms `BUNDLED_REPO` in
`packages/desktop/src/shared/ipc.ts` is "never hard-coded into
upstream-resolution logic"):

- `CLAUDE.md` (one line — the `skills/` orientation paragraph).
- `packages/core/src/registry.ts` — already partially updated inline
  during the grill; verify clean.
- `docs/plans/skills-directory-split.md:25` (planning note).
- `docs/plans/origin-paradigm-reframe.md:19`, `:67`, `:213` (three
  occurrences).

### 4. Script narrowing

- `pnpm reset:seed` — narrows to `skills/vendored/` only.
  `skills/personal/` no longer exists, so the seed step skips that
  half entirely.
- `pnpm stamp:self-authored` — decommissioned. No targets remain
  (the four authored skills moved out of the curation layer).
- `pnpm build:index` — no change required; the walker handles
  missing buckets gracefully (verified during grill: `walkSkills`
  tolerates missing bucket directories).
- `pnpm vendor:refresh` — still works against the single remaining
  vendored skill; no code change needed but worth running once to
  verify.

Update `package.json`'s scripts entries and the corresponding files
under `scripts/`.

### 5. Registry manifest primitives

New core code, primarily in `packages/core/src/export.ts` (or a new
sibling file `packages/core/src/manifest.ts` — implementation
discretion).

#### Schema

```ts
interface RegistryManifest {
  schemaVersion: 1;
  exportedAt: string;        // ISO-8601
  sourceBankVersion: string; // e.g. "1.1.0"
  registryRoot?: string;     // optional fingerprint of the source registry, e.g. "Tyler-Reagan/skills"
  skills: ManifestSkill[];
}

interface ManifestSkill {
  name: string;
  source: "bundled" | "yours";  // Phase 2 renames values; Phase 1 ships current values
  origin: ManifestOrigin;
  tags: string[];
  dismissed: boolean;
  hidden: boolean;
  lastInstalledOn: AgentKind[]; // ["claude", "cursor", ...]
}

interface ManifestOrigin {
  kind: "github" | "none";
  repo?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;  // Baseline at export time; included for diagnostic/audit value
}
```

#### Primitives

```ts
export function exportRegistryManifest(
  registryRoot: string,
): RegistryManifest;

export async function importRegistryManifest(
  registryRoot: string,
  manifest: RegistryManifest,
): Promise<ImportRegistryManifestResult>;

export interface ImportRegistryManifestResult {
  outcomes: ImportSkillOutcome[];
  installHints: { name: string; agents: AgentKind[] }[]; // intersected with destination's available agents
}

export type ImportSkillOutcome =
  | { name: string; result: "registered" }
  | { name: string; result: "origin-unreachable"; reason: string }
  | { name: string; result: "collision"; existingOrigin: ManifestOrigin }
  | { name: string; result: "skipped"; reason: string };
```

#### Behavior

- `exportRegistryManifest` is a pure read; never mutates.
- `importRegistryManifest`:
  - For each skill in the manifest, if no local entry exists, mirror
    content from the **Origin** via the existing `mirrorSkillFolder`.
  - Restore tags and dismissed/hidden state from the manifest.
  - **Does not install.** Installation is a separate user-initiated
    action.
  - Returns `installHints`: per-skill `lastInstalledOn` intersected
    with the destination machine's available agent dirs. A skill
    that was installed in `[claude, cursor]` on machine A but
    machine B doesn't have Cursor surfaces as `installHints[name] =
    [claude]`.

#### IPC channels

New channels in `packages/desktop/src/shared/ipc.ts`:

- `bank:exportManifest` — invokes `exportRegistryManifest`, returns
  the JSON object.
- `bank:importManifest` — accepts a parsed manifest, calls
  `importRegistryManifest`, returns the result structure.
- `bank:installFromManifestHint` — accepts `{ names: string[],
  agents: AgentKind[] }`, runs the existing install path for each
  skill in the given agents. User-confirmed; never auto-invoked.

#### Settings UI

Two new entries in the Settings modal:

- **Export registry manifest…** — opens a save-dialog; default
  filename `<sourceBankVersion>-registry.json`.
- **Import registry manifest…** — opens an open-dialog. After
  import, surfaces a single confirm modal: "12 skills restored. 9 of
  them were previously installed in [Claude, Cursor]. Install in
  your agents now?" One button to install the batch; one to skip
  (registry remains restored either way).

### 6. userData auto-snapshots

On every registry change (any path that mutates registry membership
or per-skill metadata), call `exportRegistryManifest` and write the
result to:

```
<userData>/registry-snapshots/snapshot-<timestamp>.json
```

Retain the last five files by mtime; delete older ones atomically.
Implementation lives in the main process near other userData
mutations (`packages/desktop/src/main/main.ts`); the registry-change
hooks already exist.

Per the **userData auto-snapshot** UL entry: "Independent of any
Linked repo; protects against local registry corruption without
user effort." The manifest concept lands for users with no linked
repo via this mechanism alone.

### 7. Option-C install-hint flow

After a successful `importRegistryManifest`, the renderer surfaces
the import-result modal described above. The flow is option C from
the grill: manifest carries `lastInstalledOn`; import surfaces a
single user-confirmed batch install action; never auto-acts. The
batch intersects with the destination machine's available agent
dirs and reports any skipped agents in a summary line.

### 8. `@deprecated` mark on content-bearing `exportRegistry`

The existing `exportRegistry` in `packages/core/src/export.ts` gains
a `@deprecated` JSDoc tag with a comment pointing at
`exportRegistryManifest` as the canonical replacement. Removal
lands one minor cycle later per post-1.0 backcompat discipline.

Per-skill `exportSkill` and `getExportInfo` are untouched —
different surface, different purpose.

### 9. Documentation updates

#### UL (`UBIQUITOUS_LANGUAGE.md`)

Already partially landed inline during the Phase 1 grill:

- **Bucket** definition extended with universality clarification.
- New **Registry manifest** section with `Registry manifest`,
  `Manifest import`, `Manifest export`, `userData auto-snapshot`
  entries.
- **Flagged** section gains two entries — one disambiguating
  `Registry export` from the deprecated content-bearing flow vs.
  the new manifest flow; one disambiguating `Registry snapshot`
  from the various artifacts it could refer to (and noting that
  the previously-planned per-skill `bankSnapshot` cache was retired
  during the Phase 1 grill — see the bank-mode-persistence reframe
  in Phase 5).

#### `packages/core/src/registry.ts`

Already partially updated inline during the grill: the `SkillBucket`
JSDoc reflects the universality of the bucket pattern and references
`Tyler-Reagan/skills` rather than `Tyler-Reagan/personal-skills`.
Verify clean.

#### `CLAUDE.md`

Rewrite the `skills/` orientation paragraph: drop the `personal/`
sub-bucket description (it no longer exists in the curation layer);
note that `skills/vendored/` ships the **Bundled set**. Update the
scripts table to reflect `reset:seed` narrowing and `stamp:self-authored`
decommissioning. Add a brief note documenting the maintainer's
end-user flow: link `Tyler-Reagan/skills` via the "Your own
registry" persona path; daily use of the app for personal skills
runs through this link.

#### `docs/concepts.md`

Verify references to deleted concepts are clean. The Persona section
remains as-is for Phase 1 (Phase 2 collapses it). No proactive
rewrite.

### 10. Discovery-based linked-repo mount

The remote-layout invariant goes away. The link/sync flow walks
whatever tree the remote provides, identifies skill folders by file
convention, and mounts each into the local bucketed registry. A
remote repo that was authored long before Skills Bank existed — or
one with an arbitrary layout (`<name>/`, `skills/<name>/`,
`docs/skills/<category>/<name>/`, anything) — is linkable as-is.

#### New core primitive: `discoverSkillsInTree`

New file `packages/core/src/discovery.ts` (kept separate from
`sync.ts` so the discovery walker has no incidental dependency on
the tarball-fetch surface):

```ts
export interface SkillDiscovery {
  /** Skill name. From meta.json.name if present, else SKILL.md
   *  frontmatter `name`, else the folder basename. */
  name: string;
  /** Absolute path of the skill folder in the source tree. */
  sourceDir: string;
  /** Path relative to the source-tree root. Stamped into
   *  `upstream.skillPath` so updates re-fetch from this location. */
  relPath: string;
  /** Path to SKILL.md within sourceDir, or null when only meta.json
   *  is present. Stored for diagnostic display only. */
  skillMdRelPath: string | null;
}

export interface DiscoveryReport {
  discoveries: SkillDiscovery[];
  /** Skill-name collisions across the tree. Surface — never auto-pick a
   *  winner. */
  collisions: { name: string; paths: string[] }[];
  /** A SKILL.md / meta.json found inside another skill folder. Surface
   *  — refusing to mount silently nested artifacts. */
  nested: { outer: string; inner: string }[];
}

export interface DiscoveryOptions {
  /** Directory basenames to skip. Default: `.git`, `node_modules`,
   *  `dist`, `build`, plus any name starting with `.`. */
  skipDirs?: Set<string>;
  /** Max walk depth. Default 8 — accommodates `docs/skills/<cat>/<name>/`
   *  while still terminating on accidental loops. */
  maxDepth?: number;
}

export function discoverSkillsInTree(
  root: string,
  opts?: DiscoveryOptions,
): DiscoveryReport;
```

A "skill folder" is any directory containing `SKILL.md` and/or
`meta.json`. Discovery stops descending once it finds a skill folder
— the `nested` report catches the case where a downstream walker
would otherwise emit both the outer and inner as separate skills.

#### Refactor `applyCanonicalSync`

`packages/core/src/sync.ts:191` today reads
`<extractedRoot>/skills/` and treats each top-level entry as a skill,
which silently mishandles bucketed remotes (writes `.skills-bank.json`
markers at the bucket-directory level — a pre-existing oddity since
v0.11.3). The refactor:

1. Replace the top-level `readdirSync(canonicalSkillsDir)` with
   `discoverSkillsInTree(extractedRoot)` over the whole extracted
   tarball.
2. Add a new parameter `mountTo: SkillBucket` to
   `applyCanonicalSync` (no default — every caller must declare its
   intent).
3. Compute each skill's destination as
   `<localRoot>/skills/<mountTo>/<discovery.name>/`. Wipe + `cpSync`
   from `discovery.sourceDir` (not from a synthetic
   `canonicalSkillsDir/<name>`).
4. Stamp `source.upstream.skillPath = discovery.relPath +
   "/SKILL.md"` (or `discovery.skillMdRelPath` when that's already
   the full path). Future `applyOriginUpdate` calls now re-fetch
   from the discovered remote location, not a hard-coded
   `skills/<name>/`.

Conflict + tag-preservation semantics carry over unchanged — they
already key off the discovered name, which is what `discoverSkillsInTree`
emits.

Add a discovery-report-aware error path: if the report carries
`collisions` or `nested` entries, abort before any local mutation
and surface them in `SyncReport` for the renderer to display. This
trades a slightly noisier failure mode for a guarantee that a
malformed remote never produces a half-mirrored local registry.

#### IPC call-site updates

Two existing channels pass through `applyCanonicalSync`:

- `IPC.syncCanonical` (the bundled-set sync from the curated repo)
  passes `mountTo: "vendored"`. The curated repo's skills are
  `source: "bundled"` in the local registry; they belong in the
  vendored bucket per the bucket UL.
- `IPC.reposReplaceRegistry` (the user linking their own GitHub
  repo) passes `mountTo: "personal"`. The user's skills are
  `source: "yours"` locally; they belong in the personal bucket.

The discriminator is the call site, not anything stamped in the
remote — both repos look the same to the discovery walker. The
distinction surfaces only in where the mounted skills land and how
`writeSkillSource` stamps the `source` axis.

#### Conflict audit

- **Curated-set sync at the bucketed remote** (today's
  `Tyler-Reagan/skills-bank` — `skills/{personal,vendored}/<name>/`):
  Discovery walks the buckets, emits each skill once with
  `relPath = skills/vendored/<name>` (or whatever bucket the remote
  has it in). Local mounts under `skills/vendored/<name>/` per
  `mountTo: "vendored"`. Round-trip identity preserved; the
  pre-existing `.skills-bank.json`-at-bucket-level oddity stops
  happening.
- **Personal-repo link at a flat remote** (the post-Phase-1
  `Tyler-Reagan/skills` — `<repo-root>/<name>/`): Discovery walks
  the root, emits each top-level skill folder. Local mounts under
  `skills/personal/<name>/` per `mountTo: "personal"`. The four
  authored skills become reachable via the persona flow.
- **Personal-repo link at a nested remote** (e.g., a repo where
  skills live at `docs/skills/<category>/<name>/`): Discovery walks
  deeper, finds each skill, mounts each into
  `skills/personal/<name>/` locally. The remote layout is preserved
  in `upstream.skillPath` for round-trip updates.
- **Maintainer scenario where linkedRepo equals curated repo**: the
  call site decides the bucket. If the maintainer uses
  `IPC.reposReplaceRegistry` to link skills-bank as their personal
  registry, skills mount under `personal/`. If they use
  `IPC.syncCanonical` for the bundled-set workflow, skills mount
  under `vendored/`. Both flows are intentional and surface in the
  UI separately; the user picks.
- **Phase 5 in-app-publish round-trip**: future publishes need to
  decide where in the remote a new skill lands. Out of scope for
  Phase 1; Phase 5 will resolve this by either matching the
  remote's existing convention (if any skills are discovered, use
  the most-common path prefix) or defaulting to `<repo-root>/<name>/`.

#### Tests

Add `packages/core/src/discovery.test.ts`:

- Flat remote (`<root>/<name>/SKILL.md`) → one discovery per skill.
- Bucketed remote (`<root>/skills/{personal,vendored}/<name>/`) →
  every skill discovered exactly once.
- Nested remote (`docs/skills/<cat>/<name>/SKILL.md`) → each skill
  discovered with the deep `relPath`.
- Skill name collision across paths → `collisions` populated, no
  discovery emitted for the colliding name.
- Nested skill (SKILL.md inside another skill folder) → `nested`
  populated, outer emitted as a regular discovery, inner suppressed.
- meta.json-only folder (no SKILL.md) → discovered with
  `skillMdRelPath: null`.
- `.git`, `node_modules`, dot-dirs skipped.
- Depth cap honored (synthetic deeply-nested tree).

Extend `packages/core/src/sync.test.ts` with a `mountTo`-parametrized
suite: one case per call-site (sync = vendored, link = personal),
asserting destination paths and stamped `upstream.skillPath` values.

## Maintainer migration approach

This plan deliberately defers the maintainer's personal continuity
of access to the 62 displaced vendored skills. The migration
happens in Phase 5, via the bulk safekeeping flow shipped there.

During Phases 1–4 development:

- **Daily use:** the maintainer continues using the pre-Phase-1
  installed Skills Bank app, which retains all 62 vendored skills.
- **Dev work:** runs in dev-mode isolation
  (`~/.skills-bank-dev/`), which separates dev userData from
  packaged userData. The packaged app is undisturbed.
- **Phase 5 cutover:** once bulk safekeeping ships, the maintainer
  uses the in-app flow to safekeep the 62 vendored skills into
  `Tyler-Reagan/skills`. The cutover dogfoods Phase 5 against a
  real workload.

This approach validates Phase 5's flow against a meaningful migration
rather than leaving the maintainer's continuity as a one-off manual
task.

## Test plan

Pre-merge gate:

```
pnpm typecheck && pnpm test && pnpm validate && pnpm build:index && pnpm build
```

Manual QA in dev-mode (does not disturb the maintainer's packaged
install):

1. Fresh dev-mode install (`rm -rf ~/.skills-bank-dev && pnpm dev`).
2. Link `Tyler-Reagan/skills` via the "Your own registry" persona
   path. Discovery walks the flat-rooted remote, finds the four
   authored skills, and mounts each at
   `~/.skills-bank-dev/userData/registry/skills/personal/<name>/`.
   Verify all four are visible in the registry view. Verify each
   skill's `.skills-bank.json` carries `upstream.skillPath` pointing
   at the discovered remote location (`<name>/SKILL.md`, since the
   remote is flat).
3. Install one of them in Claude; verify the symlink lands at
   `~/.skills-bank-dev/.claude/skills/<name>` and resolves to the
   `skills/personal/<name>/` mount point.
4. Export the registry manifest from Settings; verify the JSON
   shape matches the schema in this plan.
5. Wipe dev userData; re-link; import the manifest; verify the
   registry restores. Confirm the install-hint modal surfaces
   correctly. Decline the batch install; verify registry restored,
   nothing installed.
6. Repeat step 5, accept the batch install; verify skills install
   in the destination agents (intersected with what's available).
7. Trigger several registry changes (add a tag, dismiss a skill);
   verify `<userData>/registry-snapshots/` accumulates files and
   rotates to last five.

## Consequences

- **For end users:** none (no external users at this point per the
  maintainer's clarification; all phases ship pre-release).
- **For the maintainer:**
  - 62 vendored skills not retrievable via the app until Phase 3
    (Discover) ships. Daily use of pre-Phase-1 install remains
    intact via dev-mode isolation.
  - Two-repo working set during Phases 1–4 (`skills-bank` for
    curation work; `Tyler-Reagan/skills` for end-user content
    development). Dev-mode isolation mitigates state interference.
- **For docs:**
  - Phase 2 renames vocabulary (`bundled`/`yours` →
    `curated`/`user`); Phase 1 docs intentionally use Phase 1
    vocabulary, with `schemaVersion` bumping in Phase 2 to handle
    the manifest-side rename.
  - `personas.md` stays as-is for Phase 1; Phase 2 folds it into
    `concepts.md`.
- **For the manifest schema:** v1 is the first version of a
  never-shipped format. Future migrations via `schemaVersion`
  bumps (Phase 2 will bump to v2 with renamed source values).
- **Manifest reliability** depends entirely on origin reachability
  in this phase. Phase 5's manifest-import fallback to safekept
  content in the linked repo closes the gap before public release.

## Re-opening this decision

- **If the Bundled set needs to expand** beyond `find-skills` before
  Phase 3 (Discover) ships, the curation pass can be rerun as a
  small follow-up PR. Adding skills to `skills/vendored/` is
  cheap; the MVP boundary is not load-bearing.
- **If the manifest schema reveals gaps in practice** during Phase
  1–4 dev, `schemaVersion` bumps handle migration. The maintainer
  will be the one finding gaps; iteration is expected.
- **The subtree split is one-shot but recoverable.** The history of
  `skills/personal/` is preserved in `Tyler-Reagan/skills` even
  after deletion from `skills-bank`. The split is not destructive
  to history; it's a topology change.
- **If the discovery walker's file-convention rule turns out to be
  too lax** (e.g., a third-party repo accidentally surfaces folders
  that aren't really skills), tighten the rule. Candidates: require
  both `SKILL.md` AND `meta.json`; require `meta.json` to validate
  against the schema; gate behind a per-link "include experimental
  matches" toggle. Today's bias is toward inclusivity — the user
  can always Hide what discovery surfaces in error.
- **If a linked repo also has a non-skill `skills/` directory** that
  isn't structured for Skills Bank (e.g., a repo with a `skills/`
  folder for entirely different content), discovery will walk it
  along with everything else. The file-convention rule prevents
  false positives there, but a maintainer with a name collision
  between their own `<some-skill>/` and an unrelated `<some-skill>/`
  in the same repo would hit the collision report. The fix is
  renaming on the user's side; the app surfaces the conflict
  without picking a winner.
