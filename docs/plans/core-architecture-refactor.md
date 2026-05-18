# Core architecture refactor (v0.11.9)

Lands the consolidation + extraction work from the v0.11.4 architecture audit (`docs/audits/v0.11.4-architecture.md` §2, §3). Theme: **`packages/core` becomes the canonical seam; `main.ts` shrinks.**

Gated on v0.11.7 — the test foundation has to land first so this load-bearing refactor has a safety net.

## Milestones

1. **`SkillRecord` consolidation.** `heal.ts` + `source.ts` + `canon.ts` jointly own the on-disk Skill state record (three sidecars). Today they're three modules without a unifying interface; consumers in `build.ts` and `sync.ts` reach into each individually. Collapse under a `SkillRecord` module that exposes the unified read/write surface. Tests from v0.11.7 lock the existing behavior.
2. **Extract probe scheduler to core.** `runUpstreamProbe`, `buildFolderHashMap`, `repoProbeCache`, `probedUpdates`, `augmentWithProbedUpdates` → `packages/core/src/upstream-probe.ts`. Currently in `main.ts` only because of the `repoProbeCache` `Map`, which is just module-level state — equally welcome in core.
3. **Extract folder diff engine to core.** `computeFolderDiff`, `walkFiles`, `readTextIfSmall`, `looksBinary`, `DIFF_BYTE_BUDGET` → `packages/core/src/diff.ts`. Pure, node-only, identical seam to `hashSkillFolder`.
4. **Extract `applyUpstreamUpdate` to core.** Belongs alongside `mirrorSkillFolder`. Currently lives in `main.ts` because it needs `getStoredToken` and `registryRoot`; both injectable as function arguments.
5. **Conflict-resolution unification.** Same `ConflictAction` enum, same rename-target resolver, same decision-application switch — duplicated across `sync.ts` and `merge.ts` today. Build a shared `applyConflictDecision(entry, decision, stampAs)` primitive that the two callers parameterize.
6. **Extract `computePublishStates` to its own module.** `build.ts` is otherwise pure file-walking; this function shells out via `execSync` to `git status` / `git rev-list` / `git log`. Move to `packages/core/src/publish-state.ts` and let `buildRegistryIndex` accept a `publishStates?: Map<…>` injection. Tests for the file-walker no longer have to stub `child_process`.
7. **Persistent probe cache.** Today `repoProbeCache` is rebuilt every launch. Move TTL + persistence semantics into `paths.ts`-style locator so the cache survives between sessions. Cross-references the `bank-mode-persistence` plan, which will want the same primitive.
8. **Split `replaceRegistryWithRepo` (≈80 lines).** Three concerns at three different layers: (a) clone-or-pull the chosen GitHub repo into userData; (b) write Origin pointer seeds across cloned skills; (c) flip `AppConfig.registrySource` + `linkedRepo`. The middle one is the only piece that needs glossary vocabulary; the other two are infrastructure. Splitting gives the Origin stamper a real test surface.

## Recommended execution order

M1 first (it's the foundation other modules depend on). Then M2, M3, M4 in parallel (independent extractions). M5 after the test net is solid. M6, M7, M8 can fan out independently.

## Conflict audit

- **vs v0.11.7 core tests.** v0.11.7 lands first. Every refactor here runs against the test suite.
- **vs v0.11.8 security.** Both touch `main.ts`. Sequence v0.11.8 → v0.11.9 so the security hardening is in the baseline when handlers move around.
- **vs v0.12.0 Origin rename.** v0.12.0 ships after v0.11.9 so the rename codemod targets the post-consolidation module layout. Renaming pre-consolidation forces double-work.

## Risk

High. Load-bearing refactor of the registry/install seam shared by desktop and CLI. v0.11.7's tests are the safety net; if a regression escapes the tests, fall back to revert-per-milestone.

## Exit criteria

- `main.ts` ≤1,500 lines (down from 2,906).
- `packages/core/src/index.ts` exposes the consolidated `SkillRecord` API.
- `applyConflictDecision` is the only place conflict logic lives.
- Probe cache persists between sessions (verify: launch app, probe, quit, relaunch — no immediate re-probe).
- All v0.11.7 tests green.
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm test && pnpm knip && pnpm build` clean.
