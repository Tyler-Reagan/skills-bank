# Bug: in-app Origin Update commits new baseline hash without schema-validating the mirrored content

**Observed:** 2026-05-19 on `feat/skills-flow-fixes` while clearing the post-session working tree (commit `07a8ff4`).

## Symptoms

The in-app Update action on `skills/vendored/impeccable/` succeeded and refreshed the local content from `pbakaus/impeccable`. The Update toast reported success; the new `skillFolderHash` was written into `.skills-bank.json` as the post-update baseline.

But the upstream's `meta.json` arrived with an empty `description` field:

```json
{
  "name": "impeccable",
  "description": "",
  "tags": ["UI"]
}
```

`pnpm validate` fails on this:

```
✖ skills/vendored/impeccable: schema violations
    /description must NOT have fewer than 1 characters
```

The Update path committed the bad state without surfacing the validation failure. The bank's invariant ("every skill validates against `docs/meta-schema.json`") was silently violated.

## Why it matters

- Same invariant-violation pattern as the meta.json-synthesis bug ([2026-05-19-origin-update-missing-meta-synthesis.md](2026-05-19-origin-update-missing-meta-synthesis.md)), but harder to spot: the file exists, has the right shape, and only fails a content-level schema check.
- The maintainer notices when running `pnpm validate` before commit. A user running the packaged app against their own linked repo would never see this surface — there's no manual validate step in their workflow. They'd just have a skill that quietly fails to load if/when something downstream requires a non-empty description.
- The fresh baseline hash recorded into `.skills-bank.json` makes the bad state "official": the next drift probe sees the broken meta.json as the *new* canonical state, so drift detection won't help recover.

## Hypothesis

`applyOriginUpdate` in `packages/core/src/upstream.ts` calls `mirrorSkillFolder` (per ADR-0003) to wipe + recopy the skill folder atomically, then writes the new `skillFolderHash` baseline. The "writes the new baseline" step happens unconditionally — there's no schema-validate gate before commit.

Suspect contract:

```ts
// After mirrorSkillFolder succeeds:
writeSkillSource(skillDir, { ...source, upstream: { ..., skillFolderHash: newHash } });
// Missing: validate meta.json against schema before persisting the new baseline.
```

## Fix sketch

Add a post-mirror validation gate to `applyOriginUpdate`:

```ts
// After successful mirror, before writing the new baseline:
const validation = validateSkillFolder(destDir);
if (!validation.ok) {
  // Roll back the mirror by restoring from the pre-mirror snapshot
  // (which mirrorSkillFolder kept in a scratch path per ADR-0003).
  // Surface the error to the user: "Update failed validation: <reason>.
  // Local content restored."
  return { ok: false, message: validation.reason };
}
writeSkillSource(skillDir, ...);
```

The validation helper already exists informally in `scripts/update-skill.ts` (which validates source folders before publishing). Extract it into `packages/core/src/registry.ts` so both paths share a single contract.

The rollback-on-failure piece interacts with `mirrorSkillFolder`'s atomic-swap design (ADR-0001 Suite 4): the mirror has to keep the pre-mirror copy around long enough for the validation to run. Today the mirror's atomic swap is "wipe-and-recopy"; a "stage-then-validate-then-commit" variant would need design work — likely the same scratch-dir pattern `forkSkill` uses (ADR-0006 Invariant 1).

## Workaround until fixed

For maintainers in dev mode: run `pnpm validate` after every Update action. If a violation surfaces, `git restore` the skill folder and surface the specific upstream-side issue to the upstream's maintainer.

For users running packaged app: no workaround. The Update path needs the validation gate to defend non-maintainer users from broken upstream content.

## Related

- [2026-05-19-origin-update-missing-meta-synthesis.md](2026-05-19-origin-update-missing-meta-synthesis.md) — companion bug: the same call path doesn't synthesize a meta.json when upstream lacks one entirely.
- The fix for both bugs probably wants to land together as a "post-mirror invariants check" pass in `applyOriginUpdate`. Synthesis + validation can be sequential steps in the same gate.
- ADR-0001 Suite 4 (mirrorSkillFolder partial-failure invariant) sets the precedent for atomic-on-validation; this fix extends that discipline to one layer up.
