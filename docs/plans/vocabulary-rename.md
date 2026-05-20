# Vocabulary rename + persona collapse (planned, v1.3)

Phase 2 of the post-v1.0 roadmap. Single PR against
`Tyler-Reagan/skills-bank`. Mechanical sweep — no new product
surface — but it cleans up vocabulary that no longer reflects the
shipped concepts and removes the first-launch persona fork that
Phase 1 implicitly retired.

## Depends on

- v1.2.0 shipped (curation-layer-reset).
- No hard dependencies on Phase 3+ work.

## Goals

1. **Source axis rename** at every layer (TypeScript enum, JSON wire
   format, UI copy, docs): `bundled` → `curated`, `yours` → `user`.
   "Bundled" implied "shipped in the app binary" — which has never
   been true; the curated set ships from the linked repo (or its
   default, `Tyler-Reagan/skills-bank`). "Curated" is the actual
   semantic. "Yours" → "user" trims the second-person framing that
   reads awkwardly in tooltips and badges.
2. **Drop the `YOURS` badge.** The presence of a per-skill provenance
   chip alongside the source filter is redundant; the filter is the
   source of truth for "what kind of skills am I looking at."
3. **`SkillSource.upstream` JSON field → `origin`.** The v0.11.10
   origin-rename pass renamed the TypeScript surface but deferred
   the wire-format change to preserve ADR-0002 stability. Phase 2
   amends ADR-0002 and lands the wire rename behind a one-minor-
   cycle tolerant-read window.
4. **`acceptDriftSeverUpstream` → `unlinkOrigin`.** Function name
   never made it through the v0.11.10 rename; lands here as a
   one-line export rename + IPC handler import update.
5. **Persona collapse.** Remove the first-launch persona picker.
   Every user starts on the bundled-default (linkedRepo = null);
   GitHub linking moves to Settings as a one-click opt-in. The
   `registrySource: "local" | "github"` legacy alias on `AuthStatus`
   stops being read by the renderer; deprecated for one minor cycle
   then removed in v1.4.
6. **Manifest `schemaVersion` v1 → v2.** Bumps to accommodate
   renamed source values. v1 exports remain importable via a
   tolerant-read migration in `importRegistryManifest`. Exports
   always write v2.
7. **Documentation collapse.** `docs/personas.md` folds into
   `docs/concepts.md` since the persona distinction disappears from
   first launch.

## Non-goals

- **Bank-mode-persistence** (Phase 3 owns it).
- **Discover install flow** (Phase 4).
- **In-app publish + bulk safekeeping** (Phase 5).
- **CLI minimal sweep** (Phase 6 housekeeping).
- **Eager rewrite of every `.skills-bank.json` on disk** to the new
  wire format. Tolerant reads handle the read side for one minor
  cycle; writes use the new form, so files get migrated as the user
  naturally touches them. A single pass-through script
  (`scripts/migrate-source-markers.ts`) lands for maintainer use,
  not auto-invoked.

## Scope

### 1. `SkillOrigin` type + value rename

```ts
// packages/core/src/source.ts
export type SkillOrigin = "curated" | "user";
```

The literal-string sweep touches ~50 non-test call sites across
`packages/core/src/`, `packages/desktop/src/main/`, and
`packages/desktop/src/renderer/`. Mechanical find-replace; the
renderer's filter chips and the drift-detection gate in `build.ts`
are the only non-trivial reviews.

**SDK-surface backcompat.** `SkillOrigin` is an `export`ed type in
`@skills-bank/core`. Post-1.0 discipline requires a one-minor-
cycle deprecation alias. Ship:

```ts
/** @deprecated v1.3 — renamed to "curated". Drop in v1.4. */
export type SkillOriginLegacy = "bundled" | "yours";
```

Doesn't satisfy callers that branched on the literal strings — they
get a TS compile error and the message is the migration prompt. That's
the right outcome: the rename is meant to be visible. The deprecation
type exists for callers that imported the type itself.

### 2. Source axis read-tolerance + eager-write migration

`readSkillSource` (`packages/core/src/source.ts:85`) tolerates both
old and new values on read, normalizes to the new form in memory:

```ts
const source: SkillOrigin =
  raw.source === "curated" ? "curated" :
  raw.source === "bundled" ? "curated" :  // tolerant alias
  raw.source === "user"    ? "user" :
  "user";                                  // default + tolerant alias for "yours"
```

`writeSkillSource` always writes the new values. Net effect: every
`.skills-bank.json` the app touches drifts toward the new form
silently. A maintainer migration script
(`scripts/migrate-source-markers.ts`) does an eager pass for the
curation-layer repo so its committed markers settle in one PR
rather than dripping through.

### 3. `SkillSource.upstream` → `origin` (JSON wire format)

ADR-0002 amendment lands in this PR. The TypeScript surface already
uses "origin" in prose (v0.11.10 origin-rename-pass.md). The JSON
field changes:

```ts
// packages/core/src/source.ts
export interface SkillSource {
  source: SkillOrigin;
  syncedFromCommit?: string;
  syncedAt?: string;
  origin?: OriginPointer;  // was: upstream?: OriginPointer
}
```

`parseOrigin` (the wire parser, `source.ts:109`) tolerates both
`upstream` and `origin` keys for one minor cycle. `writeSkillSource`
emits only `origin`. The `OriginPointer` shape itself is unchanged
— this is a rename of the containing field name, not a schema
expansion.

**Renderer impact.** `SkillDetailDrawer.tsx` has 19 references to
`source.upstream`. Mechanical sweep. No semantic changes; the
property name just flips.

**Test impact.** 24 references in `manifest.test.ts`, 8 in
`skill-state.test.ts`, 6 in `merge.test.ts`. The tolerant-read
path gets its own coverage in a new `source.test.ts` (or extension
of existing): a marker file with the legacy `upstream` key reads
back with `origin` set, and a re-write produces only `origin`.

### 4. `acceptDriftSeverUpstream` → `unlinkOrigin`

```ts
// packages/core/src/heal.ts
export function unlinkOrigin(skillDir: string): void { ... }

/** @deprecated v1.3 — renamed to unlinkOrigin. Drop in v1.4. */
export const acceptDriftSeverUpstream = unlinkOrigin;
```

One active call site (`packages/desktop/src/main/main.ts:1511`)
gets the new name; the deprecated alias keeps SDK callers compiling.

### 5. UI: drop `YOURS` badge + filter chip relabel

- `SkillCard.tsx:395-402` — delete the `YOURS` badge branch. The
  filter is the surface for "show me only my skills."
- `RegistryFilters.tsx:82,88` — rename the filter chip label
  ("Yours" → "Mine" is the user-visible copy; the underlying match
  uses the new source axis value `"user"`).
- `SkillCard.tsx:385` — `PublishBadge` priority hierarchy retains
  MISSING > EDITED > UPDATE > CURATED. The `BUNDLED` rung becomes
  `CURATED`; the `YOURS` rung is gone.

### 6. Persona collapse

`LoginScreen.tsx` first-launch fork goes away. Every user lands on
the same starting state: bundled-default (linkedRepo = null), no
auth required, Refresh works at the GitHub unauth rate ceiling.
GitHub linking is a single button in **Settings → Account → "Link a
GitHub repository"** that opens the existing `RepoPickerModal`.

`AuthStatus.registrySource` becomes a derived getter:
`registrySource = linkedRepo !== null ? "github" : "local"`. The
renderer stops reading it; the field stays on the wire as a
@deprecated alias for one minor cycle.

The `null` case of `registrySource` (which today routes to
`LoginScreen`) is unreachable post-collapse — a freshly-installed
user is immediately on `local` (bundled-default). The renderer
gate at `App.tsx:1012-1029` collapses to a no-op pass-through.

**Header chrome.** `Header.tsx:91-97` already derives
`isBundledDefault` from `linkedRepo`. Unchanged.

**AccountModal.** `AccountModal.tsx:51-98` continues to show
linked-repo identity. The "Link a different repo" button is the
sole entry point for swapping repos post-collapse (previously also
reachable via the LoginScreen flow on fresh installs).

### 7. Manifest `schemaVersion` v1 → v2

```ts
// packages/core/src/manifest.ts
export const MANIFEST_SCHEMA_VERSION = 2 as const;

interface ManifestSkill {
  name: string;
  source: SkillOrigin;  // now "curated" | "user"
  origin: ManifestOrigin;
  tags: string[];
  dismissed: boolean;
  hidden: boolean;
  lastInstalledOn: AgentId[];
}
```

`importRegistryManifest` adds a v1→v2 migration head:

```ts
if (manifest.schemaVersion === 1) {
  manifest = migrateManifestV1ToV2(manifest);
} else if (manifest.schemaVersion !== 2) {
  return { ok: false, message: `unsupported schemaVersion ${manifest.schemaVersion}` };
}
```

`migrateManifestV1ToV2` is a pure transformer: `"bundled"`/`"yours"`
on each skill's `source` axis map to `"curated"`/`"user"`. Tests
pin the migration produces a structurally identical manifest with
renamed values only.

Exports always write v2 going forward. The IPC handler in main.ts
already gates on `schemaVersion !== 1` for the unsupported-version
error message — this widens to `=== 1 || === 2`.

### 8. ADR-0002 amendment

Append a "Phase 2 amendments" section to
`docs/adr/ADR-0002-sidecars-are-the-skill-record.md`:

- The `upstream` JSON key on `.skills-bank.json` is renamed to
  `origin`. Tolerant reads accept both for one minor cycle (v1.3
  through v1.3.x); writes use only `origin` from v1.3 onward.
- The `source` axis values on `.skills-bank.json` rename from
  `bundled`/`yours` to `curated`/`user` under the same tolerance
  window.
- The ADR's stability claim now reads "stable across renames via
  tolerant-read windows" rather than "stable absolutely." This is
  a deliberate softening of ADR-0002's original framing to match
  the post-1.0 backcompat-conscious discipline.

### 9. Documentation collapse

#### `docs/concepts.md` (rewrite)

- **Source axis section** (lines 133–156): values rename to
  `curated`/`user`; example badge copy updated.
- **Card badges section** (lines 147–156): drop the `YOURS` rung;
  rename `BUNDLED` to `CURATED`.
- **Persona section** (lines 122–131): rewrite as historical note,
  point at this plan as the collapse moment. The bundled-default
  vs. linked-repo distinction stays as a configuration spectrum,
  not a persona fork.

#### `docs/personas.md` (delete)

Fold the still-relevant content (linked-repo vs bundled-default
configuration semantics; canon-axis explanation) into `concepts.md`.
Drop the persona-comparison table; the surface no longer has two
flows.

#### `UBIQUITOUS_LANGUAGE.md`

- **`SkillOrigin`** entry: values renamed.
- **`Bucket`** entry: unchanged (Phase 1 already narrowed it).
- **`Origin pointer`** entry: clarify the JSON wire field name is
  now `origin` (was `upstream`).
- **`Persona`** entry: deprecated; folded into `Linked repo` /
  `Bundled default` (no separate UL term for the picker).

#### `CLAUDE.md`

Brief note in the orientation paragraph: "Source axis values are
`curated`/`user` post-v1.3; legacy `bundled`/`yours` markers read
tolerantly through v1.3.x and rewrite to the new form on next
touch."

#### `CHANGELOG.md`

v1.3.0 entry covers all of the above with explicit migration notes
for SDK consumers (anyone importing `SkillOrigin` literal-string
types).

## Test plan

Pre-merge gate (unchanged from Phase 1):

```
pnpm typecheck && pnpm test && pnpm validate && pnpm build:index && pnpm build
```

New / updated test coverage:

- `packages/core/src/source.test.ts` (new or extended):
  - Read of a marker with legacy `source: "bundled"` returns
    `{ source: "curated" }` in memory.
  - Read of a marker with legacy `source: "yours"` returns
    `{ source: "user" }`.
  - Read of a marker with legacy `upstream` key returns
    `{ origin: <pointer> }`.
  - Write of `{ source: "curated", origin: ... }` produces a JSON
    file with only the new key names; re-read round-trips.
  - Write of a `SkillSource` does not emit any legacy keys.
- `packages/core/src/manifest.test.ts` (extended):
  - v1 manifest import path runs the migration head and yields a
    v2 manifest with renamed values; tags / hide / lastInstalledOn
    pass through unchanged.
  - Unsupported `schemaVersion` (e.g., `3`) surfaces a clear error.
  - Export always emits `schemaVersion: 2`.
- `packages/core/src/heal.test.ts` (extended):
  - `unlinkOrigin` and the `@deprecated acceptDriftSeverUpstream`
    alias both execute identically.

Manual QA in dev-mode (`rm -rf ~/.skills-bank-dev && pnpm dev`):

1. Fresh dev-mode install. No persona picker on first launch; user
   lands directly on the bundled-default registry view.
2. Settings → Account → "Link a GitHub repository" → pick
   `Tyler-Reagan/skills`. Four skills discover + mount under
   `skills/personal/<name>/` (Phase 1 behavior intact).
3. Drawer of any vendored skill shows the new `CURATED` badge
   instead of `BUNDLED`. No `YOURS` chip anywhere; filter chip
   labelled "Mine" works against the new axis value.
4. Export the registry manifest. JSON shows
   `"schemaVersion": 2`, each skill has
   `"source": "curated"` or `"user"`.
5. Wipe dev userData. Re-link. Import a v1 manifest exported from
   a v1.2 dev session — migration head runs silently, restored
   registry uses the new values.
6. Inspect any `.skills-bank.json` after a touch (e.g., add a tag):
   committed marker no longer carries `"upstream"` or
   `"bundled"`/`"yours"` — only the new keys/values.

## Migration story for SDK consumers

The only external consumer surface today is the maintainer (no
external users at this point per Phase 1's clarification). Notes
for future external consumers:

- **TypeScript literal-string callers** (`source === "bundled"`)
  get a TS error post-upgrade. Migration: rename to
  `source === "curated"`. The `SkillOriginLegacy` type alias is a
  one-cycle escape hatch; not a long-term path.
- **JSON wire-format callers** outside the app (anything that
  reads `.skills-bank.json` directly) should switch to the new
  keys (`origin`, `curated`, `user`). Tolerant-read for one minor
  cycle means existing v1.2-written files still parse correctly
  on v1.3, but the rewrite happens on the next mutation.
- **Manifest v1 consumers** continue to import successfully via
  the migration head. Exports always emit v2. Round-trip identity
  is preserved at the value level (renames only, no shape change).

## Consequences

- **For end users:** still none (no external users at this point).
- **For the maintainer:** smoother day-to-day vocabulary; clearer
  badges. Phase 2 does not restore access to the 62 displaced
  vendored skills (Phase 4 / Phase 5 do that).
- **For docs:** persona section retires; `concepts.md` is now the
  single user-facing concept surface.
- **For the manifest schema:** v2 is the long-lived format; future
  bumps (if any) handle the next axis change. v1 readers still
  work through v1.3.x.
- **For the SDK:** a one-minor-cycle deprecation cycle on
  `SkillOrigin` type / `acceptDriftSeverUpstream` function / JSON
  wire keys. v1.4 drops the deprecated aliases.

## Re-opening this decision

- **If `"curated"`/`"user"` don't read better in practice**, the
  rename is recoverable but expensive — every committed marker and
  manifest export carries the new values. A second rename would
  need a v2→v3 manifest bump and a fresh tolerant-read cycle.
  Bias: this rename is the last one. Pick well.
- **If persona-collapse leaves users confused** about where to
  link a repo, Settings → Account is the single entry point. A
  banner / one-time tooltip on first launch may be added as a
  follow-up if telemetry surfaces drop-off (no telemetry today;
  the maintainer is the test population).
- **The wire-format rename is one-shot but reversible.** Tolerant
  reads accept both keys; if `origin` turns out to be a bad name
  (collides with a future concept), the read tolerance can extend
  and writes can switch back without data loss. The rename is not
  irrevocable as long as the tolerant-read window stays open.
