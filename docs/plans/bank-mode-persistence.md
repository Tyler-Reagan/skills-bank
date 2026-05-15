# Bank-mode persistence (planned)

When a skill's upstream becomes unreachable — the maintainer deletes the skills.sh package, transfers their source repo to a private org, or the package is pulled for any reason — the user shouldn't lose access to skills they've installed. This plan adds a registry-local cache: every successful upstream fetch lands content into `<registryRoot>/.skills-bank/cache/<package>/<version>/` alongside its destination. If the upstream later disappears, the cache is the source of truth and the user can promote it to "their own" without losing the skill.

The framing: **skills you've installed stay safe with you, even if their upstream goes dark.** This is the operative meaning of "bank" in the product name — your skills are deposited and held, not just streamed.

## Depends on

Plan 03 (per-skill upstream foundation). Builds on the schema, the update path, and the drift-attribution drawer states.

## Goals

1. Every successful upstream fetch lands a content snapshot in a registry-local cache.
2. If a probe fails persistently for a known-upstream skill, the user gets a recovery surface — keep the local copy, sever the upstream, no data loss.
3. Cache survives `reposReplaceRegistry` (github-mode re-fetch). The cache belongs to the user, not the linked upstream registry repo.
4. Export-registry includes the cache; import-registry restores it. Bank persistence travels with the user across machines.
5. Default-on behavior with a user-visible setting and a cache-management modal so users can inspect and free space when they want.

## Non-goals

- Mirroring skills.sh content wholesale or pre-emptively. We cache content the user has _actually fetched_, not the catalog.
- Recovering skills the user never installed (a "lost" community skill they wanted but never deposited).
- Compression / dedup. Snapshots are uncompressed copies; skills are typically kB-scale.

## Scope

### Schema extension

`packages/core/src/source.ts`:

```ts
interface BankSnapshot {
  cachePath: string; // relative to registry root: ".skills-bank/cache/<pkg>/<ver>/"
  contentHash: string; // SHA-256 at snapshot time
  snapshotAt: string; // ISO-8601
}

interface SkillSource {
  source: SkillOrigin;
  syncedFromCommit?: string;
  syncedAt?: string;
  upstream?: UpstreamPointer;
  bankSnapshot?: BankSnapshot; // NEW
}
```

`readSkillSource` / `writeSkillSource` round-trip the new field.

### Cache primitives

New module `packages/core/src/bank-cache.ts` exports:

- `snapshotPath(registryRoot, pointer)` — pure function returning the canonical cache path for a pointer.
- `writeSnapshot(registryRoot, pointer, sourceDir)` — copies `sourceDir` into the cache; returns a `BankSnapshot` record.
- `readSnapshot(registryRoot, snapshot)` — returns the cache dir path; verifies hash.
- `restoreSnapshot(registryRoot, snapshot, destDir)` — copies the cached content back to `destDir`.
- `listCache(registryRoot)` — returns inventory `[{ package, version, size, snapshotAt }]`.
- `deleteCacheEntry(registryRoot, package, version)` — frees space.

Cache layout:

```
<registryRoot>/.skills-bank/cache/
├── skills-sh/
│   ├── <package>/<version>/   (full skill contents)
│   └── ...
└── git/                       (reserved; no entries until git-upstream support lands)
```

### Snapshot on every successful upstream fetch

Plan 03's update path (`upstream:updateSkill`) writes a snapshot after successful fetch:

```ts
// After npx skills add succeeds and content lands at <destDir>:
const snapshot = bankCache.writeSnapshot(registryRoot, pointer, destDir);
writeSkillSource(skillDir, { ...existingSource, upstream: { ... }, bankSnapshot: snapshot });
```

Gated on the Bank-mode setting (below). If disabled, no snapshot is written; existing snapshots are not deleted (the user can re-enable without losing prior captures).

### Bank-mode setting

Add to Settings → general:

> **Bank mode — keep a local copy of every external skill (default: on).**
> When an upstream becomes unreachable, your local copies stay usable and recoverable.

Persisted in app config. Toggle effect is immediate for future fetches; doesn't retroactively populate or purge.

### Drawer states for upstream-unreachable

Plan 03 doesn't yet handle persistent probe failure. This plan adds:

- **`upstream-unreachable`** (`bankSnapshot` present) — capabilities: `canKeepInBank`, `canRetryProbe`.
- **`upstream-unreachable-no-snapshot`** — capabilities: `canSeverUpstream`, `canRetryProbe`.

Trigger: N consecutive probe failures (suggest 3; tunable). State surfaces a drawer banner: _"The upstream for this skill is no longer reachable. Your bank copy is intact."_ (or, for the no-snapshot case: _"...no cached copy is available; on-disk content is your only copy."_)

### Recovery actions

- **Keep in bank** (`upstream-unreachable`): clears the `upstream` pointer (preserves a `formerUpstream` audit trail for the user's reference), stamps `source: "yours"`, retains the snapshot in cache. Skill becomes the user's permanently.
- **Sever upstream** (`upstream-unreachable-no-snapshot`): same as Keep in bank but no snapshot to fall back on; on-disk content is the source.
- **Retry probe**: re-runs the probe; clears the unreachable state if the upstream is reachable again.

### BankCacheModal

A modal accessed from Settings → "Manage bank cache". Displays:

- Total cache size.
- Per-entry rows: package + version + skill name + snapshot date + size + Delete button.
- Bulk: **Delete cache entries with no live skill** (snapshots whose corresponding skill is no longer in the registry).

### Cache survives reposReplaceRegistry

`packages/desktop/src/main/main.ts`'s `reposReplaceRegistry` today does:

```ts
fs.rmSync(localSkillsDir, { recursive: true, force: true });
```

That wipes `<registryRoot>/skills/` but leaves `<registryRoot>/.skills-bank/` untouched. The cache lives under `.skills-bank/cache/`, so existing code already preserves it. Add an explicit test asserting cache survives a Choose-registry-repo flow.

### Export / import registry includes cache

`packages/core/src/export.ts` and the corresponding import path: extend the bundle format to include `.skills-bank/cache/`. Import restores it to the destination registry root.

Bundle size grows accordingly; document this in the modal copy.

## Files this PR will touch

- `packages/core/src/source.ts` — `BankSnapshot` type; schema round-trip.
- **New**: `packages/core/src/bank-cache.ts` — cache primitives.
- `packages/core/src/skill-state.ts` — new states + capabilities.
- `packages/core/src/upstream.ts` — wire snapshot writes into the update path; track consecutive probe failures.
- `packages/core/src/export.ts` — include `.skills-bank/cache/` in export bundle.
- `packages/core/src/import.ts` (import-registry side) — restore cache from bundle.
- `packages/desktop/src/main/main.ts` — IPC handlers for `bank:restore`, `bank:cacheList`, `bank:cacheDelete`; Bank-mode setting persistence; failure-count tracking for the probe.
- `packages/desktop/src/shared/ipc.ts` — new channels + types.
- `packages/desktop/src/renderer/components/SkillCard.tsx` — "Upstream unreachable" chip.
- `packages/desktop/src/renderer/components/SkillDetailDrawer.tsx` — unreachable banner + Keep-in-bank / Sever-upstream / Retry actions.
- `packages/desktop/src/renderer/components/SettingsModal.tsx` — Bank mode toggle + "Manage bank cache" entry.
- **New**: `packages/desktop/src/renderer/components/BankCacheModal.tsx` — cache inventory.

## Verification

### Snapshot writes

- Update a skill via the Update action. Verify a snapshot lands at `<registryRoot>/.skills-bank/cache/skills-sh/<pkg>/<new-version>/`.
- The skill's `.skills-bank.json` has a `bankSnapshot` field referencing the cache path.

### Bank-mode off

- Toggle Bank mode off. Update another skill. No snapshot is written; existing snapshots are untouched.

### Unreachable recovery

- Block skills.sh in `/etc/hosts` (or use a test build pointing at a 404 endpoint). Run probes until N consecutive failures register.
- Skill enters `upstream-unreachable`. Drawer shows "Your bank copy is intact." Keep in bank → skill transitions to `source: "yours"`, upstream cleared, snapshot retained.
- Same scenario with Bank mode off and no pre-existing snapshot: skill enters `upstream-unreachable-no-snapshot`; Sever upstream is the only action.
- Retry probe with the upstream restored: state clears, returns to normal.

### Cache survives reposReplaceRegistry

- Install a community skill (Bank mode on). Cache populated.
- Choose registry repo → replace with a different repo's tarball.
- Verify the cache is still present at `<registryRoot>/.skills-bank/cache/`; verify the snapshots reference valid content.

### Export / import

- Export the registry. Verify the bundle contains `.skills-bank/cache/`.
- Import the bundle into a fresh registry root. Verify snapshots restore correctly and skills with `bankSnapshot` references find their cache content.

### BankCacheModal

- Open Settings → Manage bank cache. Modal lists snapshots with sizes.
- Delete an entry; verify the cache dir is gone and the skill's `bankSnapshot` is cleared.
- **Delete cache entries with no live skill** removes orphans correctly.

## Open questions

1. **Failure threshold N.** Three consecutive 6-hourly probes = 18 hours before surfacing unreachable. Is that the right cadence? Faster surfacing risks false positives from transient outages; slower delays user awareness.
2. **Bundle size for export/import.** Including the cache could meaningfully grow export bundles for users with many community skills. Worth a toggle ("Include bank cache in export") if bundles grow uncomfortably large in practice.
3. **Cache cleanup on uninstall.** If a user uninstalls a skill, should its cache entry be deleted automatically? Argument for keeping: re-installing later restores from cache without a re-fetch. Argument for deleting: orphan cleanup. Suggest keeping by default; surface **Delete orphans** in BankCacheModal as the explicit cleanup.
