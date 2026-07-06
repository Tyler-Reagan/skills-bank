# ADR-0014 — Centralize OS home resolution in shared/home.ts

**Status:** Accepted (v1.24.0)

## Context

Unpackaged runs (`pnpm dev` / `pnpm start`) redirect every persistent side
effect into `~/.skills-bank-dev/` via the `SKILLS_BANK_HOME_OVERRIDE`
environment variable, so dev sessions never touch a developer's real
`~/.claude/skills/` or app data. The isolation check —
`process.env.SKILLS_BANK_HOME_OVERRIDE ?? os.homedir()` — was re-implemented
inline at each path-resolution call site instead of living in one place.

That duplication produced a real bug: `defaultSkillLockPath()` in
`skill-lock.ts` called `os.homedir()` directly, bypassing the override. In a
dev session this pointed the CLI lock file at the wrong tree, which could
attribute upstream sync state to the wrong home. There was no structural
guard against a call site getting this wrong — only code review.

A handful of call sites are deliberate exceptions and must always resolve
the _real_ home regardless of dev/packaged mode: the skill-usage metrics
hook and invocation log, and the real `~/.claude/settings.json` entry the
hook installs into (the `PreToolUse` hook fires from the user's one real
Claude Code, not a dev sandbox). Before this change, "real path on purpose"
and "real path by omission" looked identical at the call site — both were
just `os.homedir()`.

## Decision

Introduce two functions in `packages/core/src/shared/home.ts`:

```ts
/** Effective home for the current run — dev-redirected when SKILLS_BANK_HOME_OVERRIDE is set. */
export function getIsolatedHome(): string {
  return process.env.SKILLS_BANK_HOME_OVERRIDE ?? os.homedir();
}

/**
 * The real OS home, regardless of isolation. Use ONLY for intentional
 * real-path carveouts: metrics, Claude settings. Calling this from
 * any other path-resolution code is the pattern this module exists to prevent.
 */
export function getRealHome(): string {
  return os.homedir();
}
```

Every path-resolution function that should honor dev isolation calls
`getIsolatedHome()`. The handful that intentionally do not — `getMetricsDir()`,
`claudeSettingsPath()`, and `defaultSkillLockPath()` — call `getRealHome()`
explicitly. The two names make the distinction visible at the call site
instead of requiring the reader to know which of the two meanings a bare
`os.homedir()` call intends.

`defaultSkillLockPath()` was fixed to call `getRealHome()` — intentional,
since the CLI lock file must always point at the real `~/.agents/` regardless
of which app instance (dev or packaged) is running.

Both functions are re-exported from the core barrel
(`export * from "./shared/home.js"` in `packages/core/src/index.ts`).

## Alternatives rejected

**Full `PathContext` dependency-injection pattern** — threading a context
object through every function signature that resolves a path, with the
isolated/real home supplied at the top of the call stack. Rejected as
overengineered for a binary dev/packaged concern: `SKILLS_BANK_HOME_OVERRIDE`
is already the established seam (existing tests already set the env var to
isolate fixtures), and rewriting every path-resolution signature to accept a
context parameter is far more disruption than a two-function module warrants.

## Consequences

- New path-resolution code has an unambiguous default to reach for
  (`getIsolatedHome()`) and an explicit opt-out for real-path carveouts
  (`getRealHome()`), instead of `os.homedir()` meaning two different things
  depending on unstated intent.
- The `defaultSkillLockPath()` isolation leak is closed.
- Reviewers can flag any new call site that reaches for `os.homedir()`
  directly instead of one of the two named functions — a lint rule is not
  currently justified for two call sites, but is the natural next step if a
  third leak occurs.
