# ADR-0003 — Direct-fetch Update vs `npx skills update`

**Status:** Accepted (v0.11.7, ratifying v0.11.2 decision)

## Context

When a per-skill upstream probe surfaces a new commit (`upstreamUpdateAvailable === true`),
the user clicks **Update** on the drawer. v0.11.2 implemented this as a
**direct GitHub tarball fetch into a temp scratch dir, atomic swap into
the registry**. The obvious alternative was to shell out to the
`@skills-team/skills` CLI (`npx skills update <name>`), which already
knows how to fetch an authoritative skill from its declared upstream.

The "just use the CLI" path has resurfaced as a refactor suggestion at
least twice. Pinning the v0.11.2 decision so the next person who asks
reads the prior reasoning instead of relearning it.

## Decision

The Update path **does not** shell out to `npx skills update`. It
fetches the GitHub tarball directly via `mirrorSkillFolder`, with the
partial-failure-no-mutation invariant pinned by the test suite (v0.11.7
Suite 4).

## Consequences

The load-bearing reason: **`npx` is broken inside the packaged Electron
app.** When the desktop app runs as a `.dmg`-installed binary:

- The bundled Node runtime that ships with Electron isn't on `$PATH`
  for child processes.
- The user's shell `$PATH` (which would normally find `npx`) isn't
  inherited — login shells aren't sourced by GUI-launched apps on
  macOS.
- Even when `npx` _is_ findable, the npm cache, registry config, and
  per-user `~/.npmrc` may not match the maintainer's dev environment,
  producing silent install drift.

These failure modes don't appear in `pnpm dev` (dev server inherits the
maintainer's shell), only in packaged-app testing. That's why this
keeps coming back as "let's just use the CLI" — it works fine until
the app is shipped.

Other consequences of the direct-fetch approach:

- **Authentication path.** Update reuses the same Device Flow token
  the registry probe already obtained. No second auth pipeline for the
  CLI to drag in.
- **Atomic swap.** `mirrorSkillFolder` writes to a scratch dir first;
  the partial-failure-no-mutation invariant (Suite 4) is the entire
  reason an interrupted Update doesn't leave the registry in a torn
  state.
- **No CLI version coupling.** A user with a stale globally-installed
  `@skills-team/skills` would otherwise get different behavior than a
  user with a fresh install. Direct fetch is version-stable across
  installs.

## Re-opening this decision

A future refactor _could_ be valid if all three are true:

1. `npx` (or some equivalent) becomes reliably available inside a
   packaged Electron app on every supported platform.
2. The CLI gains a no-network, no-cache mode the desktop can drive
   without `~/.npmrc` lookups.
3. Suite 4's partial-failure invariant is encoded into the CLI's
   contract (not just the desktop's caller).

Otherwise: direct fetch stays.
