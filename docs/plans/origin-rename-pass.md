# Origin internal rename (v0.11.10)

Single coordinated rename pass that catches the codebase's internal vocabulary up to the v0.11.2 user-facing paradigm shift. Source: `docs/audits/v0.11.4-language-sweep.md` + `docs/audits/v0.11.4-architecture.md` §5.

Theme: **internal identifiers say what user-facing copy already says — "Origin", not "upstream".**

Stays in the v0.11.x series. The shape change to `@skills-bank/core` types is real but pre-1.0 contracts are negotiable — the project's "cut hard" convention applies. Ship deprecation aliases for one minor cycle anyway as a courtesy to the CLI + any future SDK users, then drop them in v0.12.0.

## Renames

### Core types

- `SkillSource.upstream` field → `origin`
- `UpstreamPointer` type → `OriginPointer`
- `UpstreamKind` → `OriginKind`
- `RegistryEntry.upstreamUpdateAvailable` → `originUpdateAvailable`

### Capability flags + actions

- `DrawerCapabilities.canTakeUpstream` → `canResetToOrigin` (matches the user-facing "Reset to origin" action verb that's already canonical)
- `DrawerCapabilities.canAcceptDrift` — **keep**. Glossary explicitly carves out the capability flag from the action verb. The action label "Unlink origin" already shipped in v0.11.2.
- `heal.ts` heal-action names — `acceptDriftKeepLocal` / `acceptDriftSeverUpstream` / `acceptDriftTakeCanonical` → align with the three Origin operations the glossary blesses (Unlink origin, Update + drop-baseline, hybrid).

### IPC methods

- `upstreamProbe` → `originProbe`
- `upstreamUpdate` → `originUpdate`
- `upstreamSetManual` → `originSetManual`
- `UpstreamProbeCompleteEvent` → `OriginProbeCompleteEvent`
- `UpstreamProbeResult` → `OriginProbeResult`
- `UpstreamLastCommit` → `OriginLastCommit`
- `UpstreamManualChoice` → `OriginManualChoice`
- `UpstreamRepoMetadata` → `OriginRepoMetadata`

### React internal state

- Action-state string `"taking-upstream"` → `"resetting-to-origin"` (matches the "Reset to origin" button label)
- Settings field `showUpstreamActivity` → `showOriginActivity`

### Drawer state enum

- `bundled-skill-edited` → `edited-without-origin` (matches glossary's canonical drift-state name)
- `user-edited-with-upstream` → `edited-with-origin`

### Functions

- `probeRepoTree` → `probeOriginTree`
- `mirrorSkillFolder` → keep (the function does folder mirroring; doesn't reference upstream)
- `applyUpstreamUpdate` → `applyOriginUpdate`
- `scanAndStampUpstreamFromLock` → keep (`stamp` is the glossary-blessed internal verb for the automatic lock-file scanner)

### Comments + docstrings

Code comments still reference "upstream" in many places where v0.11.4 renamed only the user-visible copy. Update alongside the identifier renames — keeping them in sync in a single PR is the whole point of the coordinated pass.

## Strategy

1. **Codemod-driven.** Write `scripts/codemod-origin-rename.ts` (or use `ts-morph`) that rewrites identifiers + imports + string-literal action states across the monorepo in one pass. Manual review of the diff before commit.
2. **Deprecation aliases for one minor cycle.** Export the old type names as `export type UpstreamPointer = OriginPointer` for one minor version with a `@deprecated` JSDoc, then remove in v0.12.0. (Pre-1.0 convention says "cut hard," but this is the one place where downstream-consumer kindness wins — the CLI and any future SDK users get a soft landing.)
3. **Plan dependency.** Sequence after v0.11.9 so the rename hits the post-consolidation module layout, not pre-consolidation.
4. **Single PR.** No split. The whole point is one coherent diff.

## Conflict audit

- **vs v0.11.5–v0.11.8.** None — those touch different surfaces (a11y, renderer state, tests, security) and use the existing identifier names. The codemod can mechanically catch up.
- **vs v0.11.9 core refactor.** v0.11.9 lands first so the rename hits the consolidated `SkillRecord` module rather than the pre-consolidation triad of heal/source/canon.

## Risk

Medium. The mechanical risk is low — codemod + typecheck catches mismatched refs. The coordination risk is real — if a downstream consumer (e.g. anyone forking the CLI) doesn't update, the deprecation aliases buy one cycle but no more.

## Exit criteria

- Zero occurrences of `upstream` as an identifier in `packages/core/**` or `packages/desktop/src/main/**` (case-sensitive). User-facing copy keeps "Origin" as already canonicalized in v0.11.4.
- Deprecation aliases exported for the renamed core types with `@deprecated` JSDoc pointing to the new name.
- `CHANGELOG.md` / release notes call out the breaking-style rename + the deprecation window.
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm test && pnpm knip && pnpm build` clean across the monorepo.
