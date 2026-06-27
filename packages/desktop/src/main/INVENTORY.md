# Main-process inventory

Reference inventory of `src/main/` plus the IPC contract it shares with the
renderer (`src/shared/ipc.ts`). What each module does and who consumes it.
Repo-internal — not published to the docs site.

> **Freshness: accurate as of branch `feat/next-phase-docs` (2026-06-27).**
> LOC are snapshots; re-verify (`wc -l`) and re-stamp when the main process
> changes materially — or distrust the numbers and trust only the purposes,
> which drift slower.

## Modules

| File                 | LOC  | Purpose                                                                                                                                                                                                      | Consumed by                                       |
| -------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| `main.ts`            | 284  | Boot + app lifecycle only. Sets the dev-mode `userData` redirect, calls `register*Handlers()` for each IPC domain file, calls `initProbeRunner()`, wires `app.on` lifecycle.                                 | Electron entry (`package.json` main)              |
| `main-state.ts`      | 329  | Shared mutable singleton (getter/setter exports). `AppConfig` I/O, all runtime state vars (`_registryRoot`, `_linkedRepo`, etc.), probe-runner lifecycle, labels-file helpers, `mutatingHandle()` wrapper.   | all `ipc-*.ts` files                              |
| `ipc-auth.ts`        | 85   | GitHub Device Flow: `authStatus` + start/poll/resume/cancel/logout handlers. `buildAuthStatus()` helper.                                                                                                     | main.ts (`registerAuthHandlers`)                  |
| `ipc-github.ts`      | 260  | Origin-probe + repo-metadata handlers. Module-level caches (`repoMetadataCache`, `lastCommitCache`) per registry root.                                                                                       | main.ts (`registerGithubHandlers`)                |
| `ipc-labels.ts`      | 37   | Labels CRUD (4 handlers) delegating to `readLabelsFile`/`writeLabelsFile` in `main-state.ts`.                                                                                                                | main.ts (`registerLabelsHandlers`)                |
| `ipc-manifest.ts`    | 927  | Manifest sync, import, export, and origin reconcile. Exports `runSync` (called on boot by `main.ts` lazy import). Imports `replaceRegistryWithRepo` via `setReplaceRegistryWithRepo` to avoid a circular.   | main.ts (`registerManifestHandlers`, boot sync)   |
| `ipc-metrics.ts`     | 16   | Three handlers: `getInvocationStats`, `getSkillTrackingStatus`, `setSkillTrackingEnabled`. No shared state needed.                                                                                           | main.ts (`registerMetricsHandlers`)               |
| `ipc-registry.ts`    | 964  | 35+ skill/registry management handlers. `allowedRevealRoots`, `isInsideAnyRoot`, `readSkillMdText` helpers.                                                                                                  | main.ts (`registerRegistryHandlers`)              |
| `ipc-repos.ts`       | 163  | Repo listing + registry-replace. Exports `replaceRegistryWithRepo` (used by `ipc-manifest.ts`) and `commitGithubLinkage`.                                                                                    | main.ts (`registerReposHandlers`); ipc-manifest   |
| `ipc-shell.ts`       | 571  | Discover WebContentsView, auto-updater, app menu, window creation, and status broadcasts (`broadcastSyncStatus`, `broadcastUpdateStatus`, `broadcastDiscoverStatus`).                                         | main.ts (`registerShellHandlers`)                 |
| `auth.ts`            | 404  | GitHub Device Flow primitives: start/poll/resume (interrupted-flow state survives restart as short-lived plaintext JSON), token persistence via `safeStorage`, `GitHubUser` fetch.                           | ipc-auth.ts                                       |
| `auth-config.ts`     | 34   | OAuth App Client ID + scope constants and `isAuthConfigured()` placeholder check. Fork-setup instructions live in the file header.                                                                           | auth.ts, ipc-auth.ts                              |
| `preload.mts`        | 189  | `contextBridge` surface: one `window.api` method per IPC channel, plus status-feed subscriptions (`DiscoverStatus`, `SyncStatus`, `UpdateStatus`).                                                           | renderer (via `window.api`)                       |
| `../shared/ipc.ts`   | 926  | The typed IPC contract: `IPC` channel-name constants + every request/response shape crossing the boundary. The single place a channel's name and payload are declared.                                       | main.ts, preload.mts, renderer (types only)       |

## Standing observations

- **`main.ts`** (284L): boot and lifecycle only after the v1.23.0 IPC split.
  Domain growth goes into the relevant `ipc-*.ts` file; `main.ts` should not
  grow past registering handlers and wiring lifecycle.
- **`ipc-registry.ts`** (964L): the largest domain file. If a distinct sub-domain
  within the registry (e.g. skill-content editing, label management) accumulates
  enough handlers to be coherent on its own, that's the first split candidate.
- **`ipc-manifest.ts`** (927L): the sync/import/export surface. `runSync` is the
  only cross-file export; keep the rest module-private.
- **`shared/ipc.ts`** (926L): grows linearly with the channel count; split by
  domain only if a consumer ever needs a strict subset (today all three consumers
  want the whole contract).
- **Circular-import prevention**: `ipc-repos.ts` exports `replaceRegistryWithRepo`;
  `ipc-manifest.ts` consumes it via `setReplaceRegistryWithRepo` (setter injected
  from `main.ts`) to avoid a direct cross-domain import.
