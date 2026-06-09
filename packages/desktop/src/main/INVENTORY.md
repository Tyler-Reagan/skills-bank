# Main-process inventory

Reference inventory of `src/main/` plus the IPC contract it shares with the
renderer (`src/shared/ipc.ts`). What each module does and who consumes it.
Repo-internal — not published to the docs site.

> **Freshness: accurate as of branch `refactor/desktop-consolidation`
> (2026-06-09).** LOC are snapshots; re-verify (`wc -l`) and re-stamp when
> the main process changes materially — or distrust the numbers and trust
> only the purposes, which drift slower.

> This file previously held the registry-IPC-primitives plan + the core
> 5-dir reorg maps (steps 1–5). All of that work shipped (#118 and the
> commits each step cites); the plan content lives in git history and the
> PR descriptions, per the repo convention that retired `docs/plans/`.
> What lives here now is the reference inventory that plan displaced.

## Modules

| File               | LOC  | Purpose                                                                                                                                                                                                                          | Consumed by                                 |
| ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `main.ts`          | 3715 | The Electron main process: window/lifecycle, dev-mode isolation redirect, registry-path resolution, and ~67 `ipcMain.handle` wrappers over `@skills-bank/core` primitives. Section map in [Layout](#maints-layout) below         | Electron entry (`package.json` main)        |
| `auth.ts`          | 404  | GitHub Device Flow: start/poll/resume (interrupted-flow state survives restart as short-lived plaintext JSON), token persistence via `safeStorage`, `GitHubUser` fetch                                                           | main.ts                                     |
| `auth-config.ts`   | 34   | OAuth App Client ID + scope constants and `isAuthConfigured()` placeholder check. Main-only (renderer copy mentions the _filename_ as user guidance, never imports it). Fork-setup instructions live in the file header          | main.ts, auth.ts                            |
| `preload.mts`      | 189  | `contextBridge` surface: one `window.api` method per IPC channel, plus the status-feed subscriptions (`DiscoverStatus`, `SyncStatus`, `UpdateStatus`)                                                                            | renderer (via `window.api`)                 |
| `../shared/ipc.ts` | 926  | The typed IPC contract: `IPC` channel-name constants + every request/response shape crossing the boundary (re-exporting core types where the payload is a core type). The single place a channel's name and payload are declared | main.ts, preload.mts, renderer (types only) |

## `main.ts` layout

Single file by design — handlers are thin wrappers over core primitives
(the registry-IPC-primitives work, #118, moved the logic down into
`packages/core`); what remains is Electron-boundary glue: dialog/shell
calls, status fan-out to the renderer, config persistence. Section
comments (`// ───`) mark the regions:

- Dev-mode isolation (L146) — the `!app.isPackaged` redirect into `~/.skills-bank-dev/`
- Registry path resolution (L165)
- Upstream probe (L474) · Repo-metadata enrichment (L589)
- Discover tab: embedded skills.sh WebContentsView (L902)
- Auto-updates (L2968)
- Canonical registry sync (L3112) · Auth + registry source (L3214)
- User repos + registry replace (L3293) · Labels (L3613)

## Standing observations

- **`main.ts`** (3715L): intentionally one file while handlers stay thin.
  If a region grows real main-side logic (not boundary glue), extract that
  region to a sibling module rather than splitting wholesale — the Discover
  WebContentsView region (L902) is the most likely first candidate.
- **`shared/ipc.ts`** (926L): grows linearly with the channel count; split
  by domain only if a consumer ever needs a subset (today all three
  consumers want the whole contract).
