# Organization audit — module depth, path isolation, docs foundation

**Date:** 2026-06-26 through 2026-06-29 · re-verified 2026-07-01 · repo state: v1.24.0 → v1.25.0

A three-lens codebase review conducted ahead of a planned published-docs
overhaul: where module interfaces were too wide, where the dev/packaged path
boundary could leak, and what internal reference docs needed to be current
before the public docs site could safely be rewritten from them. All findings
below are resolved; this record exists so the reasoning isn't lost outside
the repo.

## Outcome

Every finding raised by the review is closed. Four PRs (#151, #153, #154,
#155) plus two docs commits (`e6e0b88`, `93ac935`) and one docs PR (#152)
carried the work:

| Finding                                                                                                                                                                                   | Resolution                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `main.ts` was a 3,715-line, 67-handler monolithic IPC dispatcher                                                                                                                          | Split into 8 domain files (`ipc-auth`, `ipc-github`, `ipc-labels`, `ipc-manifest`, `ipc-metrics`, `ipc-registry`, `ipc-repos`, `ipc-shell`) + `main-state.ts`; `main.ts` is now boot/lifecycle only, 284 lines. [#141](https://github.com/Tyler-Reagan/skills-bank/issues/141) |
| Three JSON sidecars per skill (`.skills-bank.json`, `.skills-bank-hash`, `.skills-bank-runtime.json`) forced every caller to know the three-file layout                                   | `readSkillRecord`/`writeSkillRecord` in `packages/core/src/registry/skill-record.ts` compose/decompose the three sidecars behind one interface. [#144](https://github.com/Tyler-Reagan/skills-bank/issues/144), [ADR-0015](../adr/ADR-0015-skill-record-unified-reader.md)     |
| Multi-step registry operations (`moveSkillBucket`, `detachOrigin`) had no recovery path from a crash mid-write                                                                            | All three sidecar writers use write-then-rename (POSIX atomic); an op journal (`op-journal.ts`) brackets multi-sidecar operations and `heal.ts` resolves stale journals on boot. [#148](https://github.com/Tyler-Reagan/skills-bank/issues/148)                                |
| Five separate conflict-modal components duplicated the same resolve/cancel shell                                                                                                          | `ConflictModal.tsx` is now a stateless shell driven by a `ConflictAdapter`; the other four modals build an adapter and delegate rendering to it. [#150](https://github.com/Tyler-Reagan/skills-bank/issues/150)                                                                |
| The core barrel (`packages/core/src/index.ts`) re-exports all five domains, several with Node-only imports the renderer can't bundle                                                      | Formalized as intentional, not restructured: `import type {…}` from the root barrel is always renderer-safe (erased before bundling); runtime values go through named subpaths. Documented in [CLAUDE.md § Core / renderer import boundary](../../CLAUDE.md).                  |
| `SKILLS_BANK_HOME_OVERRIDE` dev-isolation logic was reimplemented inline per call site, and `defaultSkillLockPath()` got it wrong                                                         | `getIsolatedHome()` / `getRealHome()` in `shared/home.ts` make the isolated-vs-real distinction explicit everywhere. [#140](https://github.com/Tyler-Reagan/skills-bank/issues/140), [ADR-0014](../adr/ADR-0014-centralize-home-resolution.md)                                 |
| Metrics tracking and Claude settings intentionally use the real home even in dev builds, with no visible warning that toggling tracking in a dev build affects the real, packaged install | Boot-time `console.warn` in `main.ts` when `!app.isPackaged && getTrackingStatus().state !== "off"`.                                                                                                                                                                           |
| `main/INVENTORY.md`, `SCRIPTS.md`, and `CLAUDE.md` had drifted from the post-split code and were stale relative to the v1.24.0 release                                                    | Reconciled in [#152](https://github.com/Tyler-Reagan/skills-bank/pull/152) ([#145](https://github.com/Tyler-Reagan/skills-bank/issues/145), [#146](https://github.com/Tyler-Reagan/skills-bank/issues/146), [#147](https://github.com/Tyler-Reagan/skills-bank/issues/147)).   |
| `packages/docs` (the published VitePress site) needed a gap audit before the overhaul could be scoped                                                                                     | Closed via [#149](https://github.com/Tyler-Reagan/skills-bank/issues/149); the actual cosmetic overhaul is now its own open item, [#129](https://github.com/Tyler-Reagan/skills-bank/issues/129).                                                                              |
| Two ADR numbers (0006–0008, 0010) were silently absent from the register                                                                                                                  | Stubbed/written — 0006–0008 marked superseded by [ADR-0010](../adr/ADR-0010-heal-fork-publish-removed.md), which is the real tombstone for the v1.22.0 heal/fork/publish removal.                                                                                              |

## What's genuinely left

Nothing from this review blocks anything. Two low-priority items remain,
neither gating:

- **The published docs overhaul itself** ([#129](https://github.com/Tyler-Reagan/skills-bank/issues/129)) — this review's stated purpose was to clear the ground for it; that ground is now clear.
- **Revisiting the core-barrel/subpath pattern** — CLAUDE.md documents the current type-only-vs-subpath split as the intended design. Promoting subpaths to the barrel's primary interface is only worth doing if a fourth or fifth subpath need arises and the pattern starts feeling cramped.

## Process note

An earlier pass of this review (dated 2026-06-29) incorrectly reported
several of the rows above — INVENTORY.md, the ADR gaps, CLAUDE.md headers,
SCRIPTS.md, and the VitePress audit — as still open. They had in fact already
shipped via `e6e0b88`/`3b595bc`/#152 on 2026-06-27, two days before that
review's own stated date. This record reflects the state re-verified against
`main` and the GitHub issue tracker on 2026-07-01, where every issue in the
#140–#150 range is confirmed closed.
