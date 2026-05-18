# Core test foundation + ADRs (v0.11.7)

`packages/core` has zero `.test.ts` files. v0.11.4's architecture audit (`docs/audits/v0.11.4-architecture.md`) identified five high-stakes contracts that should be the first tests. This release lays the test foundation, lands the three ADRs the audit recommended, and fixes the `fetchedAt` runtime-noise bug (`docs/bug-reports/2026-05-18-fetchedAt-churn.md`).

Theme: **`packages/core` gets its first tests and decision records.** Unblocks v0.11.8 (security can refactor with confidence) and v0.11.9 (architecture refactor can refactor without fear).

## Milestones

1. **Test runner wiring.** Pick a test framework (`vitest` is the natural fit alongside Vite) and add the `pnpm test` script + CI gate. Add `pnpm test` to the agent-facing scripts table in CLAUDE.md.
2. **`hashSkillFolder` test suite.** Cover: normal byte-equal hashing, the 8 MB `HASH_BYTE_BUDGET` fallback (returns `null`), symlink hashing (link content not realpath), the two sidecar exclusions (`.skills-bank.json`, `.skills-bank-hash`).
3. **`applyCanonicalSync` test suite.** All five conflict-resolution branches (no-collision upsert; bundled→bundled overwrite; `keep-mine`; `use-canonical`; `rename-mine`) and the orthogonal meta.json tag-preservation splice.
4. **`mergeImportRegistry` test suite.** Same conflict-resolution surface as Sync, plus the divergent stamping (`source: yours`) and the canon-cache invalidation. Pin where Sync and Merge differ so a future consolidation can't silently regress.
5. **`mirrorSkillFolder` partial-failure invariant.** Simulate one failing blob fetch (last-blob-fails is the worst case); assert no disk mutation. The entire safety story of the direct-fetch Update path rests here.
6. **`classifyDrawerState` table-driven tests.** Each `DrawerState` ↔ `PrimaryAction` ↔ capability triple. Catches any future capability-flag drift.
7. **`docs/adr/` directory + three ADRs.**
   - **ADR-0001 — Test entry criteria for `packages/core`.** State what's in scope, what's deferred. Pins so future architecture reviews don't re-suggest "add tests" without traction.
   - **ADR-0002 — Sidecar files are the Skill record.** `.skills-bank.json` + `.skills-bank-hash` + optional `meta.json` together carry Source + Origin pointer + Baseline + tags. Record the decision to keep them as separate files (vs unifying) and the rule that no fourth sidecar lands without revisiting.
   - **ADR-0003 — Direct-fetch Update vs `npx skills update`.** Pin the v0.11.2 decision so a future "let's just use the CLI" refactor reads the prior reasoning. Capture the npx-in-packaged-Electron load-bearing-broken finding.
8. **`fetchedAt` probe-path bug fix.** Move `fetchedAt` out of `.skills-bank.json` and into the gitignored `.skills-bank-hash` sidecar (or its sibling). Eliminates the recurring `M skills/**/.skills-bank.json` working-tree churn the maintainer sees after every app launch. Test coverage from M2 + M5 makes this safe.

## Conflict audit

- **vs v0.11.5 a11y, v0.11.6 renderer state.** Different surfaces (core vs renderer). Independent.
- **vs v0.11.8 security.** Security can now refactor IPC handlers with the core test net underneath. Land v0.11.7 first.
- **vs v0.11.9 core architecture refactor.** v0.11.9 is gated on v0.11.7. The consolidation/extraction work in v0.11.9 is high-risk without these tests.
- **vs v0.12.0 Origin rename.** Tests will rename identifiers via the codemod alongside. No conflict.

## Exit criteria

- `pnpm test` exists, is on the CI gate, runs the five suites green.
- `docs/adr/` exists with ADR-0001, ADR-0002, ADR-0003.
- `.skills-bank.json` files no longer churn on app launch (manual smoke: open the app twice, `git status` stays clean for the markers).
- `pnpm typecheck && pnpm validate && pnpm build:index && pnpm test && pnpm knip && pnpm build` clean.
