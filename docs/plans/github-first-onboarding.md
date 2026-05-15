# GitHub-first onboarding (planned)

Today's local-bundled and github-linked modes are structurally identical at the data layer — both pull a tarball from a GitHub repo, diff against the current registry, and apply. The distinction is artificial. This plan collapses the two modes into a single concept: **every registry is linked to a repo, defaulting to `Tyler-Reagan/skills-bank`**. Authentication becomes orthogonal (identity / rate-limit / private-repo access), not a mode switch.

The user-facing payoff: onboarding gets clearer (auth-or-no-auth as a clean fork rather than three overlapping modes). The implementation payoff: `registrySource` collapses to a derived flag, AccountModal stops branching by mode, "Sync skills" and "Refresh from `<repo>`" become one universal Refresh.

## Why this plan

The current model has three states a user encounters:

1. Local-bundled — no auth, fixed to a shipped tarball + Tyler-Reagan/skills-bank sync.
2. GitHub-linked with no repo picked — authed but unlinked (an interstitial that github-mode-coherence's structural fix closed).
3. GitHub-linked with a repo picked.

State 1 vs state 3 remain separately implemented even though they share the same machinery (`applyCanonicalSync`, tarball fetch, diff-before-apply). The renderer branches by mode in AccountModal, Header, and the LoginScreen path picker. The main process branches in `replaceRegistryWithRepo`, the sync IPC handlers, and the `AuthStatus` shape. The vocabulary overlap ("Sync" vs "Refresh", "bundled" as both a `source` value and a mode) compounds the confusion.

Unifying:

- Removes ~200 lines of mode-conditional rendering across `AccountModal`, `Header`, `App.tsx`, and `main.ts`.
- Eliminates the "what mode am I in?" framing entirely. Replaces it with "what repo am I linked to" + "am I signed in."
- Aligns with `per-skill-upstream-foundation` — per-skill origin is naturally orthogonal to registry-level link.
- Enables a planned "import skills from a github URL" upsert flow as a small additive feature, not a new mode.

## Goals

1. **One registry-source concept**: `linkedRepo` is the source of truth. The current `registrySource` becomes a derived/legacy alias.
2. **Default linked repo**: `Tyler-Reagan/skills-bank` (the curated bundled set). Surfaces with friendly framing — not as a "linked to this random repo you didn't pick" annotation.
3. **Auth is identity, not mode**: a valid token = rate-limit headroom + private-repo access. No token = public-repo refresh at the GitHub unauth ceiling. Same content path either way.
4. **First-launch presents two equal options**: **Use the public skills bank** (no auth, default) and **Connect with GitHub** (auth → keep default or pick a different repo).
5. **AccountModal stops branching by mode**: always shows linked-repo info, Refresh, Change repo, sign-in/out, export/import/merge.
6. **Header retires the Sync button**: "Refresh from `<repo>`" is universal.
7. **Offline-first preservation**: the in-binary tarball remains the first-launch seed; the first explicit Refresh is the first API hit.

## Non-goals

- Removing the curated public set. `Tyler-Reagan/skills-bank` stays as the canonical default.
- Pushing back to the linked repo (still read-only; out of scope).
- Adding new OAuth scopes or providers. Device Flow with `repo` scope stays.
- Changing per-skill source marker semantics — that's `per-skill-upstream-foundation`'s domain.

## Scope

### Data-model collapse

`packages/desktop/src/main/main.ts` and `packages/desktop/src/shared/ipc.ts`:

Today's model:

```ts
export type RegistrySource = "local" | "github";

interface AppConfig {
  registrySource: RegistrySource | null;
  linkedRepo: LinkedRepoMetadata | null;
  ...
}
```

After:

```ts
// registrySource removed from the persisted config. Mode is derived:
//   linkedRepo === null         → "linked to the bundled default, unauth"
//   linkedRepo.fullName === BUNDLED_REPO → "linked to default" (auth orthogonal)
//   else                         → "linked to a user-picked repo"
const BUNDLED_REPO = "Tyler-Reagan/skills-bank";

interface AppConfig {
  linkedRepo: LinkedRepoMetadata | null;
  ...
}
```

The derived `mode` lives in a small util:

```ts
function mode(linkedRepo: LinkedRepoMetadata | null) {
  if (!linkedRepo) return "bundled-default";
  if (linkedRepo.fullName === BUNDLED_REPO) return "bundled-authed";
  return "custom";
}
```

Renderer code branching on this `mode()` reads as intent rather than as an implementation flag.

`AuthStatus` updates:

```ts
interface AuthStatus {
  isAuthConfigured: boolean;
  user: GitHubUser | null; // null = unauth
  linkedRepo: LinkedRepoMetadata | null; // null = bundled default
  // `registrySource` removed (or kept temporarily as a derived alias)
}
```

### First-launch redesign

`LoginScreen` becomes a true two-option onboarding card:

- **Use the public skills bank** (default highlight) — explanatory copy: "Pull updates from the curated `Tyler-Reagan/skills-bank` repo. No GitHub account needed. Sign in later for higher rate limits."
- **Connect with GitHub** — opens Device Flow. On success, lands in `RepoPicker` with `Tyler-Reagan/skills-bank` listed first as the recommended row, and "Pick a different repo" as the alternative.

If `isAuthConfigured === false`, the second card disables with a hint pointing at `auth-config.ts`.

The current "Self-host" link at the bottom stays.

### AccountModal collapse

One Registry-source section. Always renders:

- Linked repo label:
  - `Bundled (Tyler-Reagan/skills-bank)` when linkedRepo is the default or null
  - `github.com/<owner>/<repo>` for user-picked repos
- Last fetched relative time + 7-char commit SHA — always present (no conditional)
- **Refresh** button (primary) — universal, regardless of linked repo
- **Change linked repo** (secondary) — opens `RepoPicker`

Plus an Identity row (currently github-mode-only) that always renders:

- Authed: `@<login>` chip + "Sign out" button (clears token; linkedRepo preserved)
- Unauth: "Sign in with GitHub" button + explanatory hint about rate-limit headroom

### Header

`Sync skills` button retires. Header gains a Refresh affordance identical to AccountModal's primary. No mode conditional. The diff-before-apply path is unchanged.

### Migration

For users past first-launch:

- `registrySource === "local"`, no token, no linkedRepo → unauth + `linkedRepo = null` (default bundled). Visible change: header button label updates to "Refresh from Tyler-Reagan/skills-bank".
- `registrySource === "local"`, cached token, no linkedRepo → authed + `linkedRepo = null`. Same default + identity surfaced.
- `registrySource === "github"`, linkedRepo set → authed + linkedRepo unchanged. No visible change.

The persisted `registrySource` field can stay as a redundant write for one release (cheap migration safety net), then drop in a follow-up.

### Rate-limit + offline-first

Bundled tarball stays in the app binary. First-launch seeds from local (no API hit). The first explicit Refresh is the first API call. To soften the unauth 60/hr GitHub limit:

- Surface rate-limit status inline on the Refresh button after a successful fetch (e.g. "57/60 remaining this hour" hint).
- "Sign in with GitHub" promoted as a value-add at the rate-limit edge ("Sign in for 5000/hr").
- The `runSync` opportunistic-token usage already shipped in `github-mode-coherence` remains in effect.

CDN/Pages mirroring of the bundled tarball is a future option if rate-limit pain becomes real — not in this plan.

## Files this PR will touch

- `packages/desktop/src/shared/ipc.ts` — `AuthStatus` shape evolution; `RegistrySource` deprecation path.
- `packages/desktop/src/main/main.ts` — collapse local/github branches; `BUNDLED_REPO` constant; derived `mode()` helper; `linkedRepo` becomes the persistence anchor.
- `packages/desktop/src/main/auth.ts` — unchanged (token model is already mode-independent).
- `packages/desktop/src/renderer/App.tsx` — onboarding routing; remove `if (authStatus.registrySource === "github")` branches.
- `packages/desktop/src/renderer/components/AccountModal.tsx` — section collapse; always-on linked-repo render; unified identity row.
- `packages/desktop/src/renderer/components/LoginScreen.tsx` — two-equal-cards onboarding.
- `packages/desktop/src/renderer/components/Header.tsx` — Sync → Refresh; drop the `isGithub` conditional.
- `packages/desktop/src/renderer/components/RepoPickerModal.tsx` — `Tyler-Reagan/skills-bank` pre-listed as the recommended top row.
- `packages/desktop/src/renderer/components/ConnectGithubModal.tsx` — retained for inline Device Flow during onboarding.
- Doc sweep: `README.md`, `docs/flows/login.md`, `docs/getting-started.md`, `CLAUDE.md` — single-mode framing.

## Verification

- **Fresh first launch**: LoginScreen shows two equal cards. Pick **Use the public skills bank** → app shell loads with the bundled set. AccountModal Registry-source section shows `Bundled (Tyler-Reagan/skills-bank)`. Refresh button present and functional.
- **Fresh Connect with GitHub**: Device Flow → RepoPicker with `Tyler-Reagan/skills-bank` pre-listed first. Confirm → linked to bundled, authed. Pick a different repo → linked to that repo, authed.
- **Migration from local-bundled**: existing user with no token → app shell loads with AccountModal showing `Bundled (Tyler-Reagan/skills-bank)`. Refresh works (subject to unauth rate limit).
- **Migration from github-linked**: existing user with `linkedRepo` → AccountModal unchanged. Refresh works.
- **Sign out from authed**: token cleared; linkedRepo preserved. Header Refresh remains usable (unauth path).
- **Sign back in from unauth**: Connect with GitHub → Device Flow → identity row updates. linkedRepo unchanged.
- **Header consistency**: same Refresh label and behavior regardless of linked repo.

## Open questions

1. **First-launch default highlight**: visual emphasis on **Use the public skills bank** (low-friction default) or equal-weight presentation? Maintainer call.
2. **`RepoPicker` recommended-row UX**: pre-select `Tyler-Reagan/skills-bank` as a row with a "Recommended" tag, or auto-confirm if the user clicks Connect-with-GitHub without further interaction? Affects click count for the bundled-authed happy path.
3. **`registrySource` field deprecation cadence**: keep as a derived alias indefinitely vs. drop after one release. Defer until the migration has settled.
4. **CDN mirror for bundled distribution**: not in this plan, but if rate-limit pain emerges post-ship, this is the relief valve.

## Dependency considerations

This plan layers on top of `github-mode-coherence` (current PR). It's structurally independent of `per-skill-upstream-foundation`, `bank-mode-persistence`, and `in-app-install-from-discover` — those operate on per-skill data and don't assume a registry-mode discriminator. Landing this plan **before** those plans is preferred but not required: doing so avoids per-skill plans needing to branch on the now-collapsed mode field.

See [`CLAUDE.md`](../../CLAUDE.md) for the canonical execution order (which lives separately from filenames so plans can be re-sequenced without renaming).
