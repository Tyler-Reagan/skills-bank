# ADR-0015 — SkillRecord: unified per-skill sidecar reader

**Status:** Accepted (v1.25.0)

## Context

A skill folder carries three independent sidecar files:

| File | Reader | Writer |
|---|---|---|
| `.skills-bank.json` | `readSkillSource` | `writeSkillSource` |
| `.skills-bank-hash` | `readSyncedHash` | `writeSyncedHash` |
| `.skills-bank-runtime.json` | `readRuntimeState` | `writeRuntimeState` |

`buildRegistryIndex` was calling all three separately per skill in the same loop
iteration — `readSyncedHash` for drift detection and `readRuntimeState` for
origin-unreachable classification — producing redundant I/O and making it
non-obvious that the three values were semantically related.

Adding a fourth sidecar in the future (e.g. a per-skill config blob) would
require every caller that reads combined state to be updated individually.

## Decision

Introduce `SkillRecord` in `packages/core/src/registry/skill-record.ts`:

```ts
interface SkillRecord {
  source:     SkillSource;
  syncedHash: string | null;
  runtime:    RuntimeState;
}
```

`readSkillRecord(skillDir)` reads all three sidecars in one call.
`writeSkillRecord(skillDir, update)` accepts a `Partial<SkillRecord>` and
delegates each present field to its individual writer — a partial update
writes only the specified sidecars.

Callers that already read multiple sidecars for the same skill dir in the same
code path are migrated to `readSkillRecord`. The primary migration target is
`buildRegistryIndex`, which collapsed two separate reads (L143 + L154 in the
pre-migration file) into a single hoisted `readSkillRecord` call.

`SkillRecord` / `readSkillRecord` / `writeSkillRecord` are re-exported from
`packages/core/src/index.ts` as part of the public SDK surface.

## Alternatives rejected

**Replace individual writers with `writeSkillRecord` everywhere.** Callers that
update a single sidecar (e.g. `probe.ts` bumping `probeFailureCount`, `sync.ts`
writing the hash) would be forced to read the other sidecars just to satisfy
the partial-write interface. This couples unrelated operations and adds I/O with
no benefit. Multi-sidecar atomicity belongs in an op journal (issue #148), not
in the record writer — `writeSkillRecord` is a convenience wrapper over the
existing individual writers, not a transaction primitive.

**Merge the three sidecar files into one.** The separation has intentional
semantics: `.skills-bank.json` is committed to the registry repo
(deterministic, user-readable); `.skills-bank-hash` and
`.skills-bank-runtime.json` are gitignored (volatile, local). Merging them
would re-introduce the `fetchedAt` churn that ADR-0002 resolved.

## Consequences

- Callers that need a combined view of all three sidecars call one function
  instead of three; adding a fourth sidecar extends `SkillRecord` without
  touching existing call sites.
- Individual writers remain the canonical path for single-field updates —
  the discipline of "one writer per sidecar" is preserved.
- `writeSkillRecord` with `syncedHash: null` is a no-op for the hash field
  (null means "no baseline to write", not "delete the hash file").
