# Origin paradigm reframe (planned)

This plan replaces the implicit model where the bundled repo (`Tyler-Reagan/skills-bank`) was treated as the Origin for every locally-present skill. The new model treats Origin as the **authoritative upstream** — the repo where each skill is actively maintained by its actual author — and demotes the bundled repo to a **curation layer**: a personal vetted collection that vendors skills from various true upstreams and ships them with the desktop .dmg.

The reframe is driven by a single product question: when an end user clicks "Update" on a bundled skill, where should the update come from? Under the prior model it came from the bundled repo's snapshot of the skill, which means every "update" required the maintainer to first re-snapshot upstream into the bundled repo. The new model has the user fetch directly from the true upstream (e.g. `mattpocock/skills` for `ubiquitous-language`), so author-shipped updates appear immediately without a maintainer hop.

The shift was vetted via `/grill-me` before this plan; see the inline rationale at each scope item for which option won and why.

## Depends on

`per-skill-upstream-foundation` (lands the `UpstreamPointer` schema and probe primitives) — already merged. `github-first-onboarding` — already merged.

## Goals

1. Markers in `<repo>/skills/<name>/.skills-bank.json` point at the skill's **authoritative upstream**, not at the repo that currently holds the file.
2. The bundled repo's role is "ships content with the .dmg." It is never auto-stamped as an Origin for any skill it didn't itself author.
3. End-user "Update" pulls SKILL.md (and folder siblings) directly from the upstream via GitHub's API. No reliance on `npx skills update`, no writes to `~/.agents/.skill-lock.json`.
4. The bundled set's existing 66 skills get correct upstream pointers, populated by maintainer-time tooling (lock-file scanner + new `npx skills find` discovery script) and committed to the bundled repo, so end users inherit them via the .dmg.
5. The design supports a future split where self-authored skills move into a dedicated `Tyler-Reagan/personal-skills` repo without schema or migration churn.

## Non-goals

- A new package manager. We still rely on `vercel-labs/skills` CLI for *direct* CLI installs (Tier 1 lock-file mirror). Our scope ends at "for skills in our registry that came from elsewhere, refetch their content from upstream."
- Backwards-compatibility shims. We are in dev mode (no shipped users); the prior `BUNDLED_REPO` self-references stamped by Tier 3 in `chore/v0.11.2-polish` are reverted, not migrated.
- Bank-mode persistence (`bank-mode-persistence.md`, plan 04) and in-app install from Discover (`in-app-install-from-discover.md`, plan 05) — both downstream consumers of this plan.
- Universal write-back to the CLI's `~/.agents/.skill-lock.json`. That file is the CLI's domain; we read it (Tier 1) but never write it.

## Conceptual model

```
                        ┌───────────────────────────┐
                        │   true upstream (author)  │
                        │   mattpocock/skills       │
                        └────────────┬──────────────┘
                                     │ Probe / Update
                                     │ (direct GitHub fetch)
                                     ▼
   ┌───────────────────────────────────────────────────────┐
   │  end user's registry (any path)                       │
   │  skills/<name>/SKILL.md                               │
   │  skills/<name>/.skills-bank.json                      │
   │    upstream: { kind: "github",                        │
   │                repo: "mattpocock/skills",             │
   │                skillPath: "...",                      │
   │                skillFolderHash: "..." }               │
   └───────────────────────────────────────────────────────┘
                                     ▲
                                     │ .dmg ships these markers verbatim
                                     │
                        ┌───────────────────────────┐
                        │ curation layer (bundled)  │
                        │ Tyler-Reagan/skills-bank  │
                        │   skills/<name>/ + marker │  ← markers committed
                        └───────────────────────────┘   here at vendor time
```

Three categories of skill, each with a single uniform marker shape:

| Category | `upstream.repo` |
| --- | --- |
| Harvested bundled (vendored from external author) | author's repo, e.g. `mattpocock/skills` |
| Self-authored bundled (Tyler wrote, distributed via bundle) | `Tyler-Reagan/skills-bank` (self-referential) |
| User-installed via CLI | per `~/.agents/.skill-lock.json` (whatever CLI recorded) |

The desktop app's probe, drawer, and update logic does not distinguish categories — they're a uniform "fetch the folder hash from `upstream.repo`'s tree, compare to recorded hash" loop. The categorization is an artifact of how the marker got created, not a runtime branch.

**Forward-compatibility for the eventual (c) split** (rationale, grill Q2): when self-authored skills migrate into `Tyler-Reagan/personal-skills`, the only change is sweeping the bundled repo's checked-in markers from `repo: "Tyler-Reagan/skills-bank"` to `repo: "Tyler-Reagan/personal-skills"`. No code changes; no schema change. The `BUNDLED_REPO` constant in `packages/desktop/src/shared/ipc.ts` is solely for the registry-source default (linkedRepo). It is never hard-coded into upstream-resolution logic.

## Scope

### 1. Revert Tier 3 same-repo Origin scanner

**Rationale (grill Q5a):** Tier 3 stamped `BUNDLED_REPO` as Origin for every locally-present skill, which is exactly the conflation this plan rejects. Narrowing to `linkedRepo`-only was considered (β) but the manual picker (already polished in `chore/v0.11.2-polish`) handles the small custom-linkedRepo population without a runtime auto-resolver. (α revert) won.

Reverts:
- Delete `packages/core/src/same-repo-origin.ts`.
- Remove the `same-repo-origin.js` re-export from `packages/core/src/index.ts`.
- Remove the `scanAndStampOriginFromRepo` import and `runSameRepoOriginScan` function from `packages/desktop/src/main/main.ts`.
- Restore the original `setTimeout` boot probe wiring and the original `ipcMain.handle(IPC.rebuildIndex, …)` body.

### 2. Maintainer-time backfill: stamp all 66 bundled skills

**Rationale (grill Q3 / Sub-Q3a):** Backfill is a maintainer-time concern. The existing 66 markers need to be written, committed to the bundled repo, and shipped via .dmg. End users never run the backfill at runtime.

Three-pass workflow:

**Pass A — lock-file mirror (covers 27 of 66).**

Run on the maintainer machine (Tyler's):

```
pnpm backfill:deployed --root .
```

This invokes the existing `scanAndStampUpstreamFromLock` against the bundled repo's `skills/` directory, reading `~/.agents/.skill-lock.json`. Empirical check at plan time:

- 32 skills present in lock file.
- 27 of those overlap with the bundled set (folder names match).
- All 27 get a marker with `repo`, `skillPath`, `skillFolderHash` populated from the CLI's own records.

**Pass B — `npx skills find` discovery (covers most of the remaining 39).**

New script: `scripts/discover-bundled-upstream.ts`.

Empirical confirmation at plan time: `npx skills find <name>` is non-interactive when stdin is not a TTY, unauthenticated, and emits line-oriented output of the form `owner/repo@skill-id  <install count>` followed by `└ https://skills.sh/owner/repo/skill-id`. Sample for `impeccable`:

```
pbakaus/impeccable@impeccable  99.6K installs
└ https://skills.sh/pbakaus/impeccable/impeccable
pbakaus/impeccable@critique  83K installs
...
```

The script:
1. Lists `skills/<name>/` folders in the bundled repo that still have no `upstream` field after Pass A.
2. For each, spawns `npx skills find <name>` and parses output.
3. Picks the row where `@skill-id` exactly matches the bundled folder name. Tie-break: highest install count.
4. For each candidate, calls `probeRepoTree(repo, token)` (the existing primitive) to resolve the skill folder's tree hash.
5. Emits a candidate mapping JSON to stdout: `{ "<name>": { "repo": "...", "skillPath": "...", "skillFolderHash": "..." }, ... }`.
6. **Pauses for maintainer review before writing markers** — the JSON is the audit trail. Maintainer reviews, may edit (e.g. correct a wrong pick), then runs the writer pass.

Writer pass (same script with `--apply`): reads the (possibly hand-edited) JSON and writes each skill's `.skills-bank.json` with `kind: "github"`, the resolved `repo`/`skillPath`/`skillFolderHash`, and `installedAt`/`fetchedAt` set to `now()`. Also writes a fresh `.skills-bank-hash` baseline against current local content so post-stamp drift detection works.

**Pass C — manual residual.**

The handful (~5–10) of skills that `npx skills find` doesn't return a clean match for. Two sub-cases:

- **Self-authored skills** (Tyler wrote, not vendored from anywhere). Stamp with `upstream: { kind: "github", repo: "Tyler-Reagan/skills-bank", skillPath: "skills/<name>/SKILL.md", skillFolderHash: <computed> }` (self-referential, per Q2 (a)). A one-shot `scripts/stamp-self-authored.ts` walks the residual list and writes these.
- **Truly unknown lineage.** Stamp with `upstream: { kind: "none" }` and let the manual picker handle them if the user ever wants to claim an upstream. Or just leave them unstamped — the manual picker's disclosure surfaces them.

**Commit:** all 66 markers landed as a single commit in the bundled repo. Future `.dmg` builds carry them; end users inherit verbatim.

### 3. Update flow: direct GitHub fetch

**Rationale (grill Q4 / Sub-Q4a):** Option (I) won — direct fetch from `upstream.repo`'s tree, write blobs into the user's local skill folder, re-baseline. Considered options: (II) install-to-claim (rejected as introducing a Preview vs Installed lifecycle the user has no mental model for) and (III) hybrid CLI-first-with-fallback (rejected as over-engineering for v1). We never write the user's `~/.agents/.skill-lock.json`.

Changes in `packages/desktop/src/main/main.ts:applyUpstreamUpdate`:

1. Replace the `execFileAsync("npx", ["-y", "skills", "update", ...])` shell-out with a direct fetch.
2. Compute the skill's folder path from `upstream.skillPath` via `folderPathFromSkillPath`.
3. Call `probeRepoTree(upstream.repo, getStoredToken())` to get the current recursive tree.
4. Filter tree entries to those under `<folderPath>/` with `type === "blob"`.
5. For each blob, fetch via `https://api.github.com/repos/<repo>/git/blobs/<sha>` (returns `{ content, encoding: "base64" }`).
6. Decode and write each blob to `<registryRoot>/skills/<name>/<relative-path>` (creating subdirectories as needed).
7. Delete any local file under the skill folder that isn't in the upstream tree (true mirror; no orphaned files post-update).
8. Update the marker: set `skillFolderHash` to the probed folder hash, `fetchedAt` to `now()`.
9. Write `.skills-bank-hash` baseline to the freshly-fetched content's hash so subsequent drift detection compares against the new upstream snapshot.
10. Return `{ ok: true, message: "Updated <name> from <repo>" }`.

Error paths:
- Rate-limited / 403: surface to renderer with "GitHub rate-limit reached — sign in for 5000/hr" affordance (same as the probe's auth-prompt flow).
- 404 (folder removed upstream): surface as "upstream removed `<folderPath>` — pick Sever to keep local or Unlink to clear pointer." Don't auto-clear the marker.
- Transport error: surface message; user retries.

**Adopted vs tracked distinction goes away.** The prior PR 36 split where "tracked" went through `npx skills update` and "adopted" got terminal-guidance — both paths now use direct GitHub fetch. The drawer no longer special-cases adoption status for the Update action.

### 4. Sever semantics: unchanged

**Rationale (grill Q5b):** (α) `kind: "none"` for Sever, period. Maintainer who wants self-referential after a fork uses the picker's "Link origin" path as a second step — two clicks for a rare maintainer-only workflow. Keeps Sever consistent across maintainer and end-user roles. Context-aware behavior (γ) rejected as brittle magic.

No code change required from current `chore/v0.11.2-polish` behavior.

### 5. UI: show only true Origin

**Rationale (grill Q5c):** (α) won — drawer shows only `upstream.repo`. No "Distributed via Tyler-Reagan/skills-bank" footnote. End users don't have a reason to care about distribution lineage, and surfacing the bundled repo at skill level conflicts with `linkedRepo` already representing registry-level distribution elsewhere in the UI.

No code change required from current `chore/v0.11.2-polish` behavior. (The Origin section already reads from `upstream.repo` and doesn't reference the bundled repo.)

### 6. Forward maintainer workflow: vendor-new-skill

**Rationale:** Vendoring forward (adding new skills to the bundled repo) is the maintainer's normal mode of operation. Today this is a manual git checkout + copy + write marker. Automating it removes a foot-gun (wrong skillFolderHash, typo'd repo) and is a small CLI script.

New script: `scripts/vendor-skill.ts`.

Invocation:

```
pnpm vendor:skill <owner/repo>[@<skill-id>]                # e.g. mattpocock/skills@ubiquitous-language
pnpm vendor:skill <owner/repo> --path skills/foo/SKILL.md  # explicit path
```

Behavior:

1. Probes `<owner/repo>` for the resolved skill folder.
2. Fetches all blobs under that folder into `<bundled-repo>/skills/<derived-name>/`.
3. Writes `.skills-bank.json` with `kind: "github"`, `repo`, `skillPath`, `skillFolderHash`.
4. Writes `.skills-bank-hash` baseline.
5. Prints `git status` for the maintainer to review and commit.

This script is the **only sanctioned way** to add a harvested skill to the bundled repo. Manual git clones + hand-edited markers should be replaced by this path.

### 7. Cleanup: glossary and docs

- Update `UBIQUITOUS_LANGUAGE.md` (currently on `chore/v0.11.2-polish`). The glossary's "Origin pointer" definition is correct, but examples reference the bundled repo as a valid Origin in a few places. Sweep to reflect the new model: **Origin = authoritative upstream, never the curation layer.** Add a new "Curation layer" entry distinct from "Origin."
- Update `CLAUDE.md`'s Plans table to add this plan and adjust execution order. Suggested ordering insertion: this plan slots after `per-skill-upstream-foundation` and before `bank-mode-persistence`, because the cache-snapshot work in plan 04 needs to know what an Origin actually points at.

## Schema audit (no change)

The `UpstreamPointer` schema introduced in `per-skill-upstream-foundation` is correct as-is:

```ts
interface UpstreamPointer {
  kind: "github" | "none";
  repo?: string;
  sourceUrl?: string;
  skillPath?: string;
  skillFolderHash?: string;
  installedAt?: string;
  fetchedAt?: string;
}
```

The reframe doesn't add or remove fields; it changes only what *values* go into `repo` for the bundled set's markers (true upstream rather than the bundled repo). Schema-level changes for the eventual (c) personal-skills split are likewise not needed — only the values change.

## Execution order

PRs land in this sequence; each is independently mergeable.

1. **PR α — Revert Tier 3.** Delete `same-repo-origin.ts` and its wiring. Trivial diff; reverts the misguided commit on `chore/v0.11.2-polish`. Ships in v0.11.2.
2. **PR β — Discovery script.** New `scripts/discover-bundled-upstream.ts` + `scripts/stamp-self-authored.ts`. Maintainer runs locally to generate the candidate JSON, hand-corrects, applies. Markers committed to bundled repo. **Output is the marker landscape, not new app code.** Could ship as part of v0.11.2 or split into v0.11.3 depending on review time.
3. **PR γ — Update flow rewrite.** Replace `applyUpstreamUpdate`'s npx shell-out with the direct GitHub fetch path. Adopt/tracked distinction removed from the Update action. Ships in v0.11.3 or v0.12.0 (substantive enough to warrant a minor).
4. **PR δ — `pnpm vendor:skill` script.** New `scripts/vendor-skill.ts` + `package.json` entry. Maintainer-facing only; no runtime impact. Ships whenever convenient.
5. **PR ε — Glossary + CLAUDE.md cleanup.** Doc-only. Can land bundled with α.

## Verification

Per PR:

- **PR α:** `pnpm typecheck && pnpm validate && pnpm build:index && pnpm build` clean. `pnpm knip` shows no new unused exports. Boot the app; confirm no `[same-repo-origin]` log lines fire (the boot probe should no longer call it).
- **PR β:** Diff the maintainer-machine `skills/<name>/.skills-bank.json` writes against expected values for a sample of 5 skills hand-verified from skills.sh listings. Confirm `git status` cleanly shows only marker additions/changes, no content mutations.
- **PR γ:** Smoke-test on three skills:
  - A bundled vendored skill (e.g. `ubiquitous-language` with `upstream.repo = "mattpocock/skills"`) — click Update, verify content matches mattpocock's HEAD.
  - A self-authored skill (e.g. `find-skills` if self-authored, or any skill stamped with self-referential upstream) — Update should be a no-op when bundled repo hasn't moved.
  - A CLI-installed skill (with lock-file entry) — Update should still work via direct fetch and *not* update the lock file (verify `~/.agents/.skill-lock.json` timestamp unchanged).
- **PR δ:** Run `pnpm vendor:skill mattpocock/skills@some-new-skill` on a throwaway branch; verify the resulting folder + marker are correct; verify the script refuses to overwrite an existing skill folder without `--force`.

## Open / deferred questions

- **Distribution model for the future `Tyler-Reagan/skills-content` bundled repo.** Direct vendoring vs git submodule vs first-launch fetch. Out of scope here; revisit when actually splitting bundled content out of this repo.
- **Whether `vercel-labs/skills` CLI users would ever want our markers to inform their lock file.** Probably no — directionality stays one-way (we read theirs, they don't read ours). Revisit only if there's user demand.
- **Multi-author bundled skill (e.g. Tyler's local fork of a vendored skill).** Currently handled by Sever → `kind: "none"` then manually Link origin to self-referential. If this becomes common enough to deserve a one-click "Fork into bundle" affordance, revisit in a follow-up.
- **Rate-limit budget for the discovery script.** `npx skills find` has unknown rate limits; if a 60-skill run hits a ceiling, we batch with sleeps or fall back to (d) `gh search code`. Deal with it if it happens.

## Conflict audit

- **`per-skill-upstream-foundation`'s Tier 2 backfill mapping (`scripts/bundled-upstream-mapping.json`).** This plan supersedes it. The mapping JSON becomes the *output* of the discovery script (Pass B intermediate), not a hand-maintained input. Remove `scripts/backfill-bundled-upstream.ts` if it has no other callers after Pass B's writer lands.
- **`chore/v0.11.2-polish` branch:** PR α (revert Tier 3) lands first on this branch, before opening v0.11.2 for release. The picker polish and Tier 3 commits are separated; only the Tier 3 commit (`c7b3fe6`) gets reverted.
- **`in-app-install-from-discover`'s temp-dir primitive.** That plan's primitive (fetch SKILL.md into a temp dir for preview) overlaps with the Update path's blob-fetch logic. Extract a shared helper (`fetchSkillContent(repo, folderPath, token, destDir)`) in PR γ that both plans consume.
