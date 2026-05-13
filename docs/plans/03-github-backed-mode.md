# GitHub-backed mode (deferred — future PR)

This plan describes the second of two registry-source modes the app supports. The first — **local-bundled**, the default — ships with the app and is fully implemented in the provenance-reframe PR. This mode is a separate future PR; nothing in here is currently functional. The UI surfaces "Coming soon" entry-points (account menu and Settings → Registry source) that link here, so users can see the feature direction.

If you're looking for the active plan, see [`fuzzy-tickling-pine.md`](../fuzzy-tickling-pine.md) (Claude plan file).

## Why this lives as a separate PR

The maintainer's call: GitHub-backed mode is a less-used capability and the persona-collapse work in the active PR makes deferring it cleanly possible — the entry-points are staged but dormant; activation is purely additive. Splitting it lets the larger surfacing/clarity changes ship without being blocked on the git-native UX work.

## Scope when this PR ships

### Publish-state chip on cards

When the registry is GitHub-backed, every card gains a small chip anchored bottom-right of the card body. Three values:

- **`Local`** — file is uncommitted (working tree change present).
- **`Committed`** — file is committed but the commit is not on the upstream remote yet.
- **`Pushed`** — file is on the upstream remote.

Implementation: main-process runs `git status --porcelain` to detect working-tree dirtiness and `git rev-list @{u}..HEAD --` for each skill path to detect ahead-of-upstream commits. Cached per skill, keyed by skill directory; invalidated on file change or explicit refresh.

The chip is a separate component from the provenance badge (which surfaces `bundled` / `yours`). The two coexist without competing for the badge slot.

### "Refresh from git" replaces Sync

When the registry is GitHub-backed, the header's **Sync skills** button is replaced by **Refresh from git**. The button runs `git pull --ff-only` against the registry repo and surfaces a diff summary (count of changed/added/removed skills) before applying.

On conflict (`pull --ff-only` fails because the local has diverged), the UI punts to a toast: *"Couldn't fast-forward. Resolve in your terminal and try again."* with a link to the registry repo path. We don't try to recreate git's conflict UX inside the app — it's worse than the real one.

### Commit & push toast

After any registry mutation (Register, Unregister, direct edit-in-Finder), if the registry is GitHub-backed and the change isn't yet committed, a one-time toast surfaces:

> *N skills changed, K not yet committed. [Commit & push…]*

Clicking opens a small dialog: a message text field (defaulted to a one-line summary derived from the changed skill names) and a push toggle (defaulted on). Shells to `git add` (specific paths only — never `git add -A`), `git commit`, and optionally `git push`.

Don't replace the git CLI; complement it. Power users can still operate in their terminal at any time.

### Track vs Adopt per-skill at Register time

Replaces the global `Move files into Skills Bank on Register` setting *for GitHub-backed users only*. The Register button on a non-registered skill opens a small dialog with two named options:

- **Move into my repo (commit-ready)** — files relocate to `<registryRoot>/skills/<name>/`, agent-dir entry rewrites to a symlink, `adopted: true`. Default selection for non-system paths.
- **Track in place (leave files where they are)** — registry tracks the external path, `adopted: false`. Default selection for paths that already live under another git repo the user controls (heuristic: parent dir or any ancestor is a separate `.git` repo).

Local-bundled users continue with auto-track (`adopted: false`) — the dialog doesn't appear for them.

### Repoint for external-target-missing

When a non-adopted skill's tracked external path is gone, the drawer's `missing` heal state offers two options instead of one:

- **Pick new location…** — opens a directory picker; on selection, rewrites the external-path record. The skill re-validates and the badge clears.
- **Forget this entry** — existing behavior; drops the entry.

Closes the "Repointing the target is future work" note in today's heal docs.

### Device Flow mid-flow recovery

If the user closes the Device Flow dialog (current code: `LoginScreen.tsx`'s flow-active branch) mid-poll, persist the in-flight `{ flowId, userCode, verificationUri, expiresAt }` to main-process state. On next launch or next Settings → Registry source open, offer two affordances:

- **Resume GitHub authentication** — resumes polling with the persisted flowId. Succeeds if the user completed the GitHub side; fails with a clear message if they didn't.
- **Start over** — clears persisted state and launches a fresh flow.

Persisted state expires when the underlying device flow expires (typically ~15 minutes per GitHub's API).

### `finalize` surface promotion

Today's `finalize` (collapse a symlinked top-level agent dir into a real dir of its own) lives buried in `RegisterModal`'s FinalizeCallout. When this PR ships, promote it to a top-level Settings entry in the GitHub-backed section: *"Collapse symlinked agent dirs…"* — gated on `registrySource === "github"` because that's the audience for whom agent-dir layout is most relevant.

## Out-of-scope but accommodated

The future feature **"Promote local registry to a new GitHub repo"** lives outside this plan but is structurally enabled by it. The shape:

1. User has a local-bundled registry with their own edits and additions.
2. User clicks **Promote to GitHub repo…** (a new action surfaced once the GitHub-backed mode lands).
3. App authenticates (Device Flow if not already linked).
4. App calls the GitHub API to create a new repo under the user's account with a chosen name.
5. App initializes the local registry directory as a git repo, makes an initial commit from the current state, and pushes to the new remote.
6. App switches the linked-mode pointer to the new repo. From here on the user operates in GitHub-backed mode.

Path: this PR's commit-and-push infrastructure carries the user from a freshly-promoted repo into the same git-native workflow as anyone who started on GitHub-backed mode. No separate code path.

## Files this PR will touch

- `packages/desktop/src/renderer/components/SkillCard.tsx` — `PublishStateChip` component
- `packages/desktop/src/renderer/components/SkillDetailDrawer.tsx` — repoint action, register-time dialog
- `packages/desktop/src/renderer/components/SettingsModal.tsx` — finalize promotion
- `packages/desktop/src/renderer/components/LoginScreen.tsx` — mid-flow recovery
- `packages/desktop/src/renderer/components/Header.tsx` — Refresh-from-git button (replaces Sync when github-linked)
- `packages/desktop/src/main/main.ts` — git helpers (status/rev-list/add/commit/push), new IPC handlers, Device Flow persistence
- `packages/desktop/src/shared/ipc.ts` — new channels: `git:status`, `git:refresh`, `git:commitAndPush`, `git:repointExternal`
- `packages/desktop/src/main/` — Device Flow state persistence

## Verification when this PR ships

- Clean GitHub-backed registry: register a new skill; chip shows `Local`. `git add . && git commit`; refresh → `Committed`. Push; refresh → `Pushed`.
- Refresh from git: commit a skill on one clone, push; on another clone run Refresh from git → diff summary correct; apply → skill appears.
- Commit & push: register a new skill while linked → toast fires; dialog commits + pushes; remote shows the new skill.
- Repoint: register a non-adopted skill at `/tmp/foo/SKILL.md`; move folder to `/tmp/bar/`; drawer shows `external-target-missing`; Pick new location → `/tmp/bar/`; entry rewrites.
- Mid-flow recovery: open Device Flow; close the dialog; relaunch app; see Resume affordance; complete auth on github.com; click Resume → status updates to `github`.
