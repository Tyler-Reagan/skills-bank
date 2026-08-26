# ADR-0023 — Compatible Lock writer; never spawn npx

**Status:** Accepted (supersedes [ADR-0003](./ADR-0003-direct-fetch-update-vs-npx-skills.md))

The packaged Electron app cannot spawn `npx` reliably, and the `skills` package requires Node >= 22 while Electron 32 ships Node 20. Skills Bank mutates the Store through one `packages/core` on-disk adapter: plain `fs`, injected home, no spawn, and no import of the `skills` package. Callers get Add, Delete, and list. Fetch is a caller of Add, not Add itself.

## Consequences

- The path is always `{home}/.agents/.skill-lock.json` and `{home}/.agents/skills`. Ignore `XDG_STATE_HOME`. Unpackaged runs inject the isolated home. Packaged runs inject the real home. This withdraws [ADR-0014](./ADR-0014-centralize-home-resolution.md)'s `defaultSkillLockPath()` → `getRealHome()` carveout. The isolated/real seam in that ADR stays. Metrics home is [ADR-0032](./ADR-0032-metrics-home-harness-consumer.md).
- One Skill write is atomic: scratch folder, lock via temp-file plus rename, then swap. On failure, keep the previous folder and lock. If npx changed the lock after we read it, merge-retry, then fail closed. Do not take an OS file lock.
- `skillFolderHash` is SHA-256 of the files we wrote. A missing lock is an empty Store. A lock that exists but is not v3, or does not parse, is an error — do not wipe it. Keep `dismissed`, `lastSelectedAgents`, and unknown keys.
- Projection is not on this interface. First-boot is a caller of Add, not a second writer.
- Atomicity and merge-retry are named contracts under [ADR-0001](./ADR-0001-core-test-entry-criteria.md).
