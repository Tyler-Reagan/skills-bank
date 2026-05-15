# GitHub-backed mode coherence (planned)

v0.9.0 shipped most of GitHub-backed registry mode — Device Flow, RepoPicker, tarball-replace fetch, AccountModal sections — but with stale "Coming soon" entry points still wired alongside the working flow, misleading copy, no diff visibility before destructive re-fetches, no way to refresh the _same_ linked repo without going through repo-selection, and several heal flows that didn't ship. This plan polishes the existing tarball-replace mode into a coherent, reliable feature.

## Depends on

None. Standalone polish of already-shipped code.

## Goals

1. UI doesn't lie. No "Coming soon" buttons next to working buttons; no copy claiming a feature is "on the way" when it already ships.
2. Re-fetching a github-linked registry never silently destroys user-local edits. Diff first; let the user choose.
3. Refreshing the same linked repo is a first-class action distinct from changing which repo is linked.
4. Closing the Device Flow dialog mid-poll is recoverable.
5. External-target-missing has a real repoint path, not just "Forget this entry."
6. The `finalize` action (collapse a symlinked agent dir into a real dir) lives in Settings, not buried in `RegisterModal`'s `FinalizeCallout`.

## Non-goals

- Pivoting to a git working-tree model. The tarball-replace model is the v1 shape; that decision is recorded.
- Push-back-to-GitHub flows. There's no in-app commit/push; users contribute by editing their actual clone in their normal git workflow.
- "Promote local registry to a new GitHub repo." Deferred entirely.

## Scope

### Drop stale Coming Soon dialogs

The `GitHubLinkComingSoon` and `PromoteToGitHubComingSoon` dialogs in `ComingSoonDialog.tsx` predate the github-mode work shipping. They're now reachable side-by-side with the working **Choose registry repo** flow and only serve to confuse users about whether the feature exists.

Remove the two specific wrappers (`GitHubLinkComingSoon`, `PromoteToGitHubComingSoon`) from `ComingSoonDialog.tsx`. The generic `ComingSoonDialog` component stays in case future features want it. Remove the wiring from `App.tsx` (`showGitHubLinkComingSoon` / `showPromoteToGitHubComingSoon` state, handlers, dialog renders) and from `AccountModal` (the two `onOpen...ComingSoon` props and their buttons).

### Fix AccountModal copy

The "Registry source" hint reads _"Where your registry lives. Linking a GitHub repo is on the way."_ The second sentence is wrong; **Choose registry repo** is on the same modal. Replace with: _"Where your registry lives. Local-bundled users get the curated set shipped with the app. GitHub-linked users mirror a repo of their own."_

### Surface linked repo + last fetch in AccountModal

Today AccountModal shows `@{login}` and "Linked to a GitHub repo" but not _which_ repo, _when_ it was last fetched, or _what commit_ was fetched. Persist:

```ts
interface LinkedRepoMetadata {
  fullName: string; // e.g. "Tyler-Reagan/my-skills"
  defaultBranch: string;
  lastFetchedAt: string; // ISO-8601
  syncedFromCommit: string;
}
```

Stored in the app's config alongside `registrySource`. Written by `reposReplaceRegistry` on every successful fetch.

AccountModal renders, when `isGithub`:

```
Linked: github.com/<fullName>
Last fetched: <relative time> · <short commit SHA>
```

### Diff-before-apply for re-fetch

Today `reposReplaceRegistry` does `fs.rmSync(localSkillsDir, ...)` followed by `cpSync(src, dest)` — wholesale replacement. Any user-local edits to bundled skills, any user-added skills, anything in `<registryRoot>/skills/` that isn't in the fetched tarball: gone.

New flow:

1. Fetch tarball into a temp dir (same as today).
2. Compute a diff between the current registry state and the tarball state. Per-skill: added (in tarball, not local), removed (local, not in tarball), changed (different content), unchanged.
3. If the diff is non-empty and contains any "changed" or "removed" entries where the local side has `source: "yours"` markers or content diverging from the last `syncedFromCommit`, surface a `ConflictResolutionModal`-style modal listing them. Reuse the existing component if its shape accommodates the payload.
4. User picks per-skill: keep mine / take theirs.
5. Apply the resolution. Write the new `syncedFromCommit` per skill.

If the diff is empty or contains only "added" entries and unconflicting "changed" entries, apply silently with a toast.

### "Refresh from current repo" affordance

Today the only github-mode registry action is **Choose registry repo**, which opens `RepoPickerModal` and lets the user pick a (potentially different) repo. There's no path to just refresh the currently-linked repo without re-picking it from a list.

Add a second button in AccountModal's Registry-operations section, visible only when `isGithub`:

**Refresh from `<fullName>`** — runs the diff-before-apply flow against the persisted linked repo without opening the picker.

The existing **Choose registry repo** button stays, repositioned so refresh is the primary action and choose-repo is the secondary.

### Device Flow mid-flow recovery

`LoginScreen` runs Device Flow in its flow-active branch. Closing the dialog (Cancel) calls `authCancelDeviceFlow` and clears state. Closing the _app window_ mid-poll, or a crash, currently strands the flow — the user has to start over even if they completed the GitHub side.

Persist `{ flowId, userCode, verificationUri, expiresAt }` to main-process state when a flow starts. On next launch (or on next Settings → registry-source open), if a persisted flow is found and not yet expired:

- LoginScreen renders a recovery card: _"You have an in-progress GitHub authentication. Resume?"_
- **Resume GitHub authentication** — resumes polling with the persisted flowId.
- **Start over** — clears persisted state and offers a fresh flow.

Persisted state expires when GitHub's device flow expires (~15 min). Stale entries are GC'd on read.

### Repoint heal for external-target-missing

`SkillDetailDrawer` for the `external-target-missing` state today offers only **Forget this entry**, which drops the registry record. Users who simply moved the tracked path on disk get no recovery option.

Add a second action: **Pick new location...** — opens an Electron directory picker. On selection:

- Validate the picked path exists and contains a `SKILL.md`.
- Rewrite the corresponding `external.json` entry's `target` to the new path.
- Re-validate the skill; the `missing` flag clears; the drawer reverts to its normal state.

### Finalize promotion to Settings

`finalize` (collapse a symlinked top-level agent dir into a real dir of its own) lives in `RegisterModal`'s `FinalizeCallout` today. It's an agent-dir-layout cleanup distinct from registration, and surfacing it inside RegisterModal is confusing.

Promote it to a top-level Settings entry, visible only when at least one agent dir is symlinked into the registry: _"Collapse symlinked agent dirs..."_. The action runs the same backend logic. Remove the `FinalizeCallout` from `RegisterModal`.

## Files this PR will touch

- `packages/desktop/src/renderer/components/ComingSoonDialog.tsx` — remove `GitHubLinkComingSoon` + `PromoteToGitHubComingSoon` exports.
- `packages/desktop/src/renderer/App.tsx` — remove the two `showXyzComingSoon` state vars + handlers + dialog renders.
- `packages/desktop/src/renderer/components/AccountModal.tsx` — drop Coming Soon buttons, fix copy, render linked-repo metadata, add **Refresh from `<repo>`** button.
- `packages/desktop/src/main/main.ts` — persist `LinkedRepoMetadata` in config; new IPC `repos:refreshCurrent`; new IPC `repos:repointExternal`; Device Flow persistence; diff-computation for `reposReplaceRegistry`; finalize callable from Settings.
- `packages/desktop/src/shared/ipc.ts` — `repos:refreshCurrent`, `repos:repointExternal`, `auth:resumeDeviceFlow`, types for `LinkedRepoMetadata`.
- `packages/desktop/src/renderer/components/LoginScreen.tsx` — recovery card path when a persisted flow exists.
- `packages/desktop/src/renderer/components/SkillDetailDrawer.tsx` — repoint action on `external-target-missing`.
- `packages/desktop/src/renderer/components/RegisterModal.tsx` — remove `FinalizeCallout`.
- `packages/desktop/src/renderer/components/SettingsModal.tsx` — add finalize entry (visible conditionally).
- `packages/desktop/src/renderer/components/ConflictResolutionModal.tsx` — extend (or specialize via prop) to handle the diff-before-apply payload, if its current shape doesn't already accommodate.

## Verification

- AccountModal as a github-linked user shows linked repo, last fetched time, short commit SHA. The two Coming Soon buttons are gone. The copy says nothing about a feature being "on the way."
- **Refresh from `<repo>`** against a repo with no upstream changes since last fetch produces a no-op toast.
- Refresh against a repo with upstream-only changes applies them silently and bumps `syncedFromCommit`.
- Refresh against a repo with conflicts (user edited a tracked skill; upstream also changed) opens the conflict modal with the right per-skill choices.
- Closing the LoginScreen Device Flow dialog mid-poll, quitting the app, relaunching → recovery card appears; Resume successfully completes if the user authorized on github.com in the interim.
- Drawer for `external-target-missing`: Pick new location... opens a picker; selecting a valid SKILL.md path repoints the entry; the missing state clears.
- Settings shows the **Collapse symlinked agent dirs** entry when at least one agent dir is a symlink; activating it runs the same finalize that RegisterModal used to expose.

## Open questions

1. **`ConflictResolutionModal` reuse vs. specialize.** The local-bundled sync conflict modal handles "upstream changed + local also changed → pick per-skill." The github-mode diff has the same shape but the underlying actors differ (linked repo upstream vs. bundled-set upstream). Aim to reuse with a prop discriminator; specialize if the existing component's data shape can't accommodate without contortion.
2. **Diff cost for large registries.** Computing per-skill content hashes for hundreds of skills on every Refresh could be slow. Cache hashes per `(syncedFromCommit, name)` to avoid re-hashing unchanged skills.
