> **Transient handoff doc — delete before merge** (along with `PLAN-skill-invocation-tracking.md`).
> Committed so a future session — possibly on another machine — can resume
> implementation in *this same branch and PR*.

# Handoff: implement skill-invocation tracking + Metrics dashboard

## Goal of the next session

Implement the design in **`PLAN-skill-invocation-tracking.md`** (same directory),
committing the implementation **into this branch** (`feat/skill-invocation-tracking`)
and the **same PR** ([#139](https://github.com/Tyler-Reagan/skills-bank/pull/139),
currently a draft). Delete this file and the plan file before merge; mark the PR
ready when implementation + verification pass.

The plan is the source of truth for *what* to build and *why* (every design decision
was settled in a grilling session and recorded there, including rejected alternatives
and deferred follow-ons). This doc only covers *state* and *how to resume* — it does
not restate the design.

## Current state

- **Branch:** `feat/skill-invocation-tracking`, based on `main` @ `3e799e6` (latest at
  handoff time).
- **Commits on branch:** one — `docs: plan for skill-invocation tracking…` (`2be4b43`).
  Plan doc only; **no implementation code yet.**
- **Provisional scratch was discarded.** Early in the session I'd started
  `packages/core/src/metrics/{invocations,hook-config}.ts`; those were *not* committed
  (removed before syncing to main). Re-create from the plan. They were partial and
  predate two late design refinements — don't go looking for them.
- **Issue [#138](https://github.com/Tyler-Reagan/skills-bank/issues/138)** (dev-sink
  hardening) is filed; the real-path carve-out this feature relies on is its context.

## Resume prompt (paste into a fresh session on this branch)

> Implement `PLAN-skill-invocation-tracking.md` in this repo. Work in the current
> branch `feat/skill-invocation-tracking` and push to the existing PR #139 (flip it
> out of draft when done). Build in this order: (1) core `metrics/{invocations,
> hook-config,coverage}.ts` + vitest tests under `metrics/test/`; (2) main-process
> `skill-tracking.ts` + the three IPC handlers; (3) `shared/ipc.ts` + `preload.mts`;
> (4) renderer `MetricsTab.tsx` + `Tabs.tsx`/`App.tsx`/`SettingsModal.tsx`; (5) docs
> (CHANGELOG, the one-line CLAUDE.md dev-isolation note). Then run the verification
> in the plan. Delete `PLAN-*.md` and `HANDOFF-*.md` before marking ready. Read the
> plan's "Decisions locked" section first — do not relitigate settled choices.

## Gotchas for the implementer

- **Main moved under the plan.** PRs #136 (function-oriented label taxonomy) and #137
  (CategorySelect combobox) reworked the **labels/category** system. The plan's
  Metrics-tab "light registry cross-reference" reads `RegistryEntry` name + description
  — **verify `RegistryEntry`'s shape against current `@skills-bank/core`** before wiring
  it; don't trust the plan's field assumptions blindly.
- **Real paths, on purpose.** Metrics code uses `os.homedir()` (real `~/.skills-bank`,
  real `~/.claude/settings.json`) and deliberately ignores `SKILLS_BANK_HOME_OVERRIDE`.
  This is the documented carve-out (#138) — not a bug to "fix" into the dev sink.
- **The risky write is unit-tested, not toggled.** Prove the `settings.json` merge
  against temp dirs (`SKILLS_BANK_METRICS_DIR`); real end-to-end toggling touches real
  config and is the maintainer's manual call.
- **Conventions:** follow `CLAUDE.md` — `pnpm typecheck && test && build` before done;
  test files under `src/*/test/*.test.ts` (scratch under `os.tmpdir()`); no gratuitous
  comments.

## Suggested skills to load next session

- **`verify`** or **`run`** — to exercise the toggle + dashboard in the running app.
- **`code-review`** — before flipping the PR to ready.
- (`write-a-skill` is *not* relevant — this is app code, not a skill authoring task.)
