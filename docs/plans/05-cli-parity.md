# CLI parity (deferred — future PR)

This plan describes the CLI catch-up work needed to make the README's "Same operations through either surface" claim true. Currently the CLI covers a read-side subset (`list`, `installed`, `install`, `uninstall`, `import`, `sync-installed`, `export`, `finalize`); register, unregister, sync, heal, hide, export-registry, and import-registry are renderer-only.

The maintainer's call: the CLI is a less-used surface than the desktop app. UI completeness is the higher-leverage path. Splitting this lets the larger provenance/persona work ship without being blocked on CLI scaffolding.

The active PR that staged the parent provenance-reframe / persona-collapse work motivated this split; the CLI catch-up here is the deferred companion.

## What's in scope when this PR ships

### Promote operations into `@skills-bank/core` services

Today's renderer-only IPC handlers contain business logic mixed with main-process glue. Extract pure-TS service functions for:

- `register(name, opts)` — adopt-or-track decision; metadata pickup; symlink rewrite
- `unregister(name)` — mid-tier destructive; move files for adopted; drop index for non-adopted
- `sync()` — pull bundled upstream; conflict detection; resolution application
- `heal(name, action)` — accept-drift / take-canonical / forget-missing / repoint
- `hide(name)` / `unhide(name)` — bundled-skill-dismissed toggle

These become shared between the main-process IPC layer (a thin wrapper that calls the service) and the new CLI commands.

### New CLI subcommands

Delegate to the new core services:

```
skills-bank register <name> [--adopt | --no-adopt]
skills-bank unregister <name>
skills-bank sync                              # local-bundled only
skills-bank refresh                           # github-linked only (after Bundle 3)
skills-bank heal <name>                       # interactive per-state prompts
skills-bank hide <name>
skills-bank unhide <name>
```

The `sync` command errors clearly on github-linked installs:

> *Refresh from git is the right command for a GitHub-linked registry — use `skills-bank refresh` instead.*

### Rename `sync-installed` → `relink-installed`

The current `sync-installed` command swaps foreign symlinks for registry-managed symlinks after a registry pull. It shares vocabulary with the desktop's `Sync skills` button but does an entirely different thing (no upstream fetch, no upsert). Renaming to `relink-installed` removes the collision.

Ship with a one-release alias: invoking `sync-installed` prints a deprecation warning and runs `relink-installed`. Remove the alias in the following release.

### CLI persona detection

The CLI needs to know which registry root it's operating on. Resolution order:

1. `--root <path>` flag if passed.
2. `SKILLS_BANK_ROOT` environment variable if set.
3. Nearest ancestor directory containing a `skills/` subdirectory.

If none of these resolve, error with a clear message pointing at `--root`.

### README CLI section update

Replace today's CLI block with the full command set. Soften the "Same operations through either surface" claim honestly: Discover (embedded skills.sh browser) and Device Flow (interactive token grant) remain UI-only because they require interactive surfaces the CLI can't provide.

## Files this PR will touch

- `packages/core/src/register.ts` — new
- `packages/core/src/unregister.ts` — new
- `packages/core/src/sync-service.ts` — new (extracted from main.ts)
- `packages/core/src/heal-service.ts` — new (thin wrappers over existing heal.ts pure functions)
- `packages/core/src/hide-service.ts` — new (thin wrappers over existing hide.ts)
- `packages/desktop/src/main/main.ts` — IPC handlers thin out to delegate to core services
- `packages/cli/src/commands/register.ts` — new
- `packages/cli/src/commands/unregister.ts` — new
- `packages/cli/src/commands/sync.ts` — new
- `packages/cli/src/commands/refresh.ts` — new (depends on Bundle 3)
- `packages/cli/src/commands/heal.ts` — new
- `packages/cli/src/commands/hide.ts` — new
- `packages/cli/src/commands/sync-installed.ts` — rename to `relink-installed.ts`; keep alias
- `packages/cli/src/index.ts` — wire new commands
- `README.md` — accurate CLI section

## Verification when this PR ships

- Register via CLI → entry appears in desktop Registered section after refresh.
- Hide via desktop → CLI `list` annotates the hidden skill correctly.
- Sync via CLI on local-bundled → identical result to clicking the header Sync button.
- Sync on github-linked → clear error pointing at `refresh`.
- `sync-installed` invocation prints deprecation warning, runs `relink-installed`.
- README CLI block executes end-to-end on a fresh checkout.
