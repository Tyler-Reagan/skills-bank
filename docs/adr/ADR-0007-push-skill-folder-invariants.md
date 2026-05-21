# ADR-0007 — `pushSkillFolder` primitive: atomicity, branch resolution, rate-limit handling

**Status:** Proposed (post-v1.0)

## Context

The in-app Publish flow (planned post-v1.0) needs to push a skill
folder from the user's local registry to their linked repo as a pull
request. ADR-0003 binds the implementation strategy: a packaged
Electron app cannot rely on `gh` or `git` being on `$PATH` for GUI-
launched processes, so the operation must drive the GitHub REST API
directly using the user's Device Flow OAuth token.

The architecture pass identified this as the symmetric counterpart to
`mirrorSkillFolder` — the inbound primitive that fetches and writes
to the local registry. `pushSkillFolder` is the outbound primitive
that uploads from the local registry and creates a PR on the linked
repo.

Per the grilling session (architecture-pass thread, 2026):

1. Single-skill granularity. Bulk publish is a thin loop in the IPC
   handler over per-skill calls, matching the bulk-install precedent.
2. The "atomic" envelope mirrors `mirrorSkillFolder`'s Suite-4
   invariant but in the symmetric direction — staging happens first,
   the commit point is a single API call near the end, and post-
   commit operations are best-effort.
3. Branch existence on the remote is not always a collision — it
   depends on PR state. The primitive queries upfront and resolves
   automatically.
4. Rate-limit handling reuses the `RateLimitInfo` plumbing from
   `mirrorSkillFolder` / `probeOriginTree` — no auto-retry in the
   primitive; caller decides.

## Decision

Four pinned invariants, plus an extension of ADR-0001's test
foundation.

### Invariant 1 — Ref-as-commit-point atomicity

The push operation is a six-step API sequence:

| Step | Call                                                                 | Phase                   |
| ---- | -------------------------------------------------------------------- | ----------------------- |
| 1    | `GET /repos/<owner>/<repo>/git/refs/heads/<base>` (resolve base SHA) | pre-commit              |
| 2    | `POST /repos/<owner>/<repo>/git/blobs` (× N files)                   | pre-commit              |
| 3    | `POST /repos/<owner>/<repo>/git/trees`                               | pre-commit              |
| 4    | `POST /repos/<owner>/<repo>/git/commits`                             | pre-commit              |
| 5    | `POST /repos/<owner>/<repo>/git/refs` (create `publish/<name>`)      | **commit point**        |
| 6    | `POST /repos/<owner>/<repo>/pulls` (open PR)                         | best-effort post-commit |

Failure anywhere in steps 1–4 leaves orphan blob/tree/commit objects
on the remote with no ref pointing at them. GitHub GCs orphans
eventually; no user-visible state changes; no recovery action needed.

Step 5 is the atomic commit point. Once the ref exists, the branch
is user-visible on the remote.

Step 6 (PR creation) is best-effort post-commit. If it fails — typically
because the PR creation API returned a transient error — the branch is
left in place and the user receives a toast pointing at the branch URL
(`https://github.com/<owner>/<repo>/tree/publish/<name>`) so they can
open the PR manually via the GitHub UI. The primitive does not roll
back the ref on PR-creation failure; this matches Git's own model
(branches exist independently of PRs) and avoids the recursive "what
if delete-ref also fails" failure path.

### Invariant 2 — PR-state-aware branch resolution

Before step 5, the primitive queries the remote for an open PR with
head `publish/<name>`:

```
GET /repos/<owner>/<repo>/pulls?head=<owner>:publish/<name>&state=open
```

Three operational paths fall out of the answer:

- **Open PR exists.** The current push is an update to that PR. The
  primitive appends a new commit to the existing `publish/<name>`
  branch instead of creating a new ref. The PR auto-updates with the
  new tree on GitHub's side. No new PR is opened; the existing PR's
  review history is preserved.
- **No open PR, but the branch exists.** Stale state from a merged
  PR, a closed PR, or a mid-flight failure from a prior attempt. The
  primitive issues `DELETE /repos/<owner>/<repo>/git/refs/heads/publish/<name>`
  then proceeds with steps 1–6 normally. Recovers from all stale-state
  cases uniformly with one extra API call.
- **Branch does not exist.** Normal six-step push.

No modal-style refusal. The fork modal (ADR-0006 Invariant 2) is for
irreversible state mutation that warrants explicit consent; push-side
branch existence is fully recoverable through the GitHub UI (revert a
commit, close a PR, restore a branch) and the state is knowable
upfront. Surfacing a modal for every update would degrade the common
case (publishing iterations of an in-flight PR) for no recoverable
risk.

### Invariant 3 — Rate-limit handling matches `mirrorSkillFolder`

The primitive checks every API response for `429` or `403 with
X-RateLimit-Remaining: 0`. On either, it returns a structured
`RateLimitErr` carrying the existing `RateLimitInfo` shape
(`{ limit, remaining, resetAt, unauthenticated }`). The renderer
already knows how to display this; no new UI surface needed.

No auto-retry in the primitive. The caller decides whether to wait,
retry, surface to the user, or stop a bulk loop. Auto-retry would
mask pathological cases (auth misconfigured, scope insufficient,
upstream-side issue) by burning through quota silently.

The atomicity invariant pays off in the rate-limit case: an
exhaustion mid-push aborts before step 5, leaving no remote state
changes. Recovery is "retry after `resetAt`."

### Invariant 4 — PR metadata: caller-overridable auto-generation

The primitive signature accepts `prMeta?: { title?: string; body?: string }`
as optional. When omitted, the primitive generates defaults from the
source folder's `meta.json` and the inferred publish flow:

| Flow        | Title format                                         |
| ----------- | ---------------------------------------------------- |
| New         | `feat(personal): add <name>`                         |
| Safekeeping | `chore(vendored): vendor <name> from <owner>/<repo>` |
| Fork        | `feat(personal): fork <name> from <owner>/<repo>`    |

Body is a short structured paragraph naming the skill, quoting its
description, explaining the flow, and citing the origin pointer
when relevant.

The IPC handler can pre-fill a confirmation modal in the single-skill
drawer Publish flow, letting the user edit before invoking the
primitive. Bulk publish skips the modal and uses generated defaults —
matching the bulk-install precedent (no per-card prompts during a
bulk run).

`.github/PULL_REQUEST_TEMPLATE.md` — if the linked repo has one, the
API body we send overrides it (GitHub does not merge them). For v1,
the auto-generated body takes precedence. If a maintainer with a
template hits this and pushes back, a follow-up can fetch and prepend
the template before our content.

### Test foundation extension

ADR-0001's foundation extends with Suite 7 in
`packages/core/src/push.test.ts`:

- Injected fs failure during blob enumeration → no API calls made.
- Injected HTTP failure during blob upload (step 2) → no ref created,
  orphan blobs acceptable.
- Injected HTTP failure during tree/commit creation (steps 3–4) →
  same.
- Injected HTTP failure during ref creation (step 5) → no
  user-visible state, orphan commit acceptable.
- Successful ref creation followed by PR creation failure → ref
  exists, error result carries the branch URL; no rollback attempted.
- PR-state query returns open PR → primitive appends commit to
  existing branch, does not create new ref or PR.
- PR-state query returns no open PR but branch exists → primitive
  deletes stale ref, proceeds with normal push.
- 429 / 403-with-remaining-0 mid-sequence → `RateLimitErr` returned,
  no further calls, no ref created.

## Consequences

- `pushSkillFolder` lives in `packages/core/src/upstream.ts`
  alongside `mirrorSkillFolder` and `probeOriginTree`, completing the
  GitHub-API trio.
- The IPC handler in `packages/desktop/src/main/main.ts` orchestrates
  the publish flow: classifies the skill into Flow 1 / 2 / 3 via the
  skill's source marker and drift state, calls `forkSkill` first for
  Flow 3, then invokes `pushSkillFolder` for all three flows.
- The fork-then-push asymmetry from ADR-0006 (local commits before
  remote push) means a push failure after a successful fork leaves
  the user with a local fork and no PR. The user retries the push
  without re-confirming the fork modal; the local state survives
  retries. ADR-0006's Consequences section already pins this.
- A new IPC contract for the publish flow is required (separate
  scope, candidate #5 in the architecture pass). Likely
  `classifySkillForPublish(name)` → `{ flow, defaultPrMeta }`,
  followed by `publishSkill(name, options)` once the user confirms
  via the appropriate UI surface.

## Re-opening this decision

The single-skill granularity (the foundational decision) might bite
if a future flow needs "atomic batch publish" — all N skills land in
one branch with one PR, all-or-nothing. Three options when that
comes:

1. Add a separate `pushSkillBatch(skills[], ...)` primitive. Cheap;
   no impact on `pushSkillFolder`.
2. Promote `pushSkillFolder` to `pushSkillFolders(skills[], ...)`
   with N=1 as the common case. Changes the contract.
3. Layer a batching helper on top that orchestrates N parallel pushes
   onto the same branch. Significant complexity; reconciliation of
   tree conflicts becomes non-trivial.

Option 1 is the cheapest path. Do not preemptively broaden the
single-skill primitive.
