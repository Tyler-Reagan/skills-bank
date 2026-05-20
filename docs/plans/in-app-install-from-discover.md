# In-app install from GitHub URL (planned, v1.5)

Phase 4 of the post-v1.0 roadmap. Single PR against
`Tyler-Reagan/skills-bank`.

## What changed since the original plan

This file previously specified an `npx skills add` integration tied
to scraping skills.sh URLs, with the install path going through
`bank-cache.ts` and writing a `bankSnapshot` field. **Three layers
of that are obsolete** post-v1.2/v1.3/v1.4:

- `npx skills add` is no longer the canonical fetch primitive.
  `mirrorSkillFolder` (v1.2 / curation-layer-reset) fetches skill
  content directly from GitHub by `{repo, skillPath}`. skills.sh is
  a discovery aggregator over GitHub repos, not a separate package
  format; nothing in the install path actually requires npx.
- `bank-cache.ts` and the `bankSnapshot` field were retired in the
  v1.2 grill (the local content under `skills/.../<name>/` already
  serves as "the cache" by virtue of v1.2's discovery mount).
- Vocabulary: `upstream` → `origin` (v1.3), `bundled`/`yours` →
  `curated`/`user` (v1.3).

Plus a fresh scope reframe:

- **Scraping skills.sh's URL scheme is fragile and orthogonal to the
  product value.** The user-facing promise — "click Install once,
  skill lands in my bank, no terminal" — works just as well against
  arbitrary GitHub URLs. The user pastes a folder URL from
  skills.sh, GitHub directly, or anywhere else; the app parses to
  `{repo, skillPath}` and fetches. No site-specific knowledge in
  the install code.

This rewrite scopes Phase 4 to the **GitHub-URL install primitive +
the Settings surface that exposes it**. A future v1.6 follow-up
(see "Re-opening this decision") can layer skills.sh-specific URL
detection on the Discover tab once the URL scheme is stable enough
to special-case.

## Depends on

- v1.4.0 shipped. The probe-failure recovery surface (Phase 3)
  ensures Discover-installed skills get the same `origin-unreachable`
  heal flow as any other github-origin skill — no parallel handling.
- v1.2's discovery-mount + `mirrorSkillFolder` primitive in place
  (`applyCanonicalSync` composes it for whole-repo links;
  this plan composes it for single-skill installs).

## Goals

1. The user can install any skill from a GitHub URL by pasting it
   into a Settings → "Install a skill from GitHub" entry. No
   terminal step.
2. The single-skill install path composes existing primitives:
   `mirrorSkillFolder` for fetch, `writeSkillSource` for marker
   stamping, `buildRegistryIndex` for registry visibility. No
   parallel npx code path.
3. Installed skills land in `skills/personal/<name>/` as `source:
   "user"` with a stamped `origin` pointer. Future probes pick them
   up automatically; future updates flow through the existing
   `applyOriginUpdate`.
4. The Discover tab's "Open Terminal" callout updates to surface
   the new entry point: _"See a skill you want? Copy its source-repo
   folder URL and use Settings → Install a skill from GitHub."_

## Non-goals

- **skills.sh-specific URL scraping / Install button on Discover.**
  Deferred to a follow-up plan (`discover-install-button.md`, when
  it lands). The current Phase 4 ships value without speculating
  on skills.sh's URL scheme stability.
- **Bulk install.** One skill per paste. The Registry tab's bulk-
  install feature (v1.1) handles already-registered skills; this
  flow is for adding new ones.
- **Non-GitHub origins.** GitLab, self-hosted gitea, etc. The
  v1.2 architecture already supports `origin.kind: "github"` only;
  expanding would touch `mirrorSkillFolder` and is its own scope.
- **In-app GitHub authentication beyond what's already shipped.**
  Authenticated users get 5000 reqs/hr; unauth gets 60/hr per IP.
  Same constraint as elsewhere.
- **Editing the URL after install** to point at a different folder
  in the same repo. Re-install from the new URL; the existing
  collision behavior handles the rest.

## Scope

### 1. URL parser

`packages/core/src/origin-url.ts` (new file):

```ts
export interface ParsedSkillUrl {
  /** GitHub `owner/repo`. */
  repo: string;
  /** Path within the repo, relative to the repo root. Always
   *  ends with `/SKILL.md` so it round-trips with
   *  `origin.skillPath`. */
  skillPath: string;
  /** Optional branch reference, if the URL encoded one (e.g.
   *  /tree/<branch>/<path>). Falls back to `HEAD`. */
  ref?: string;
}

export interface UrlParseError {
  kind: "not-github" | "not-a-skill-folder" | "malformed";
  message: string;
}

export function parseGithubSkillUrl(
  url: string,
): ParsedSkillUrl | UrlParseError;
```

Accepts (and resolves to a canonical shape):

- `https://github.com/<owner>/<repo>/tree/<branch>/<path>` —
  folder URL. Skill path = `<path>/SKILL.md`.
- `https://github.com/<owner>/<repo>/blob/<branch>/<path>/SKILL.md` —
  blob URL pointing at the SKILL.md file itself.
- `https://github.com/<owner>/<repo>/tree/<branch>` — repo-root
  URL. Treated as `not-a-skill-folder` unless the repo's root has
  a `SKILL.md` (rare; users typically nest); the error message
  guides the user to point at a specific folder.
- `https://github.com/<owner>/<repo>` (no branch) — same as
  repo-root URL above.

`not-github` for any URL that doesn't start with `https://github.com/`.
`malformed` for anything that doesn't match the github URL shape.
The error variant is structured so the renderer can render hints
keyed on `kind`, not on string parsing.

The parser doesn't probe GitHub. It only does URL pattern matching
+ canonicalization. A follow-up probe at install time validates that
the path actually contains a SKILL.md (existing `mirrorSkillFolder`
already errors with a clear message if not).

### 2. Core install primitive

`packages/core/src/install-from-github.ts` (new file):

```ts
export interface InstallFromGithubOptions {
  registryRoot: string;
  repo: string;       // "owner/repo"
  skillPath: string;  // "<path>/SKILL.md" — canonical from URL parser
  /** Bucket the installed skill lands in. Default: `personal`
   *  (`source: "user"` semantics). Pass `vendored` to mark
   *  the skill as curated locally — only the maintainer's
   *  use-case for the displaced 62 vendored skills. */
  bucket?: "personal" | "vendored";
  /** GitHub OAuth token for the fetch. Null = unauth (60/hr). */
  token: string | null;
}

export type InstallFromGithubResult =
  | {
      ok: true;
      name: string;
      bucket: "personal" | "vendored";
      destDir: string;
      folderHash: string;
    }
  | {
      ok: false;
      reason: "mirror-failed";
      message: string;
      rateLimit?: import("./upstream.js").RateLimitInfo;
    }
  | {
      ok: false;
      reason: "name-collision";
      existingBucket: "personal" | "vendored";
      existingDir: string;
    }
  | {
      ok: false;
      reason: "no-skill-md";
      message: string;
    };

export async function installSkillFromGithub(
  opts: InstallFromGithubOptions,
): Promise<InstallFromGithubResult>;
```

Composition (no new fetch logic):

1. Derive folder path: strip trailing `/SKILL.md` from `skillPath`.
2. Resolve skill name: the canonical name lives in the source's
   `meta.json.name` (preferred) or `SKILL.md` frontmatter. To get
   it without a second fetch, use the URL's final folder segment as
   the **provisional name**. Post-mirror, re-resolve from the
   freshly-mirrored content via `readSkillMeta`; if the canonical
   name differs from the provisional one, the destination directory
   is renamed.
3. Pre-flight collision check: walk both buckets via
   `findSkillFolder(registryRoot, provisionalName)`. If a skill of
   that name already exists, return `name-collision` — the user
   resolves (uninstall the existing, rename, or cancel) before
   re-attempting.
4. Mirror: `mirrorSkillFolder(repo, folderPath, destDir, token)`
   where `destDir = <registryRoot>/skills/<bucket>/<provisionalName>`.
5. Validate: `readSkillMeta(destDir)`. If no SKILL.md or meta.json,
   wipe the mirrored dir and return `no-skill-md` — the URL didn't
   point at an actual skill folder.
6. Re-resolve name; if different, rename the dir, update destDir,
   re-check for collision at the canonical name (rare race —
   handled by uninstalling the freshly-mirrored copy and surfacing
   `name-collision`).
7. Stamp `.skills-bank.json` with `source: "user"`, no
   `syncedFromCommit` (this isn't a sync), `origin: { kind: "github",
   repo, skillPath, skillFolderHash: mirror.folderHash, installedAt
   }`. Baseline the synced-hash sidecar so probe-counter-reset works
   from install onward (origin-unreachable would never fire on a
   freshly-installed skill otherwise).
8. Return `ok: true` with the canonical name + destDir.

### 3. IPC

`packages/desktop/src/shared/ipc.ts`:

```ts
bank:installSkillFromGithub: "bank:installSkillFromGithub",
```

`installSkillFromGithub(url: string): Promise<InstallSkillFromGithubResponse>`

The renderer-facing IPC accepts the raw URL string; the main
process parses + composes the core primitive. Return shape mirrors
`InstallFromGithubResult` plus an `ok: false; reason: "url-parse-error"`
arm for URLs that didn't pass `parseGithubSkillUrl`.

Wraps through `mutatingHandle` so install fires a userData
auto-snapshot (Phase 1's contract).

### 4. Settings entry + modal

`packages/desktop/src/renderer/components/SettingsModal.tsx`:

New "Install a skill from GitHub" button under the **Skills** group,
adjacent to the existing **Default install agents** entry. Opens a
new modal:

`packages/desktop/src/renderer/components/InstallFromGithubModal.tsx`:

- Single text input: _"Paste a GitHub URL pointing at a skill folder
  or its SKILL.md."_ Hint examples below the input show both URL
  shapes the parser accepts.
- **Install** button. Disabled when the input is empty. On click,
  fires `IPC.installSkillFromGithub(url)`. Spinner during the
  await.
- On success: closes the modal; flashes a toast _"Installed
  `<name>` into your bank."_; the registry list refreshes via
  the existing post-mutation refresh.
- On error: renders the `reason`-keyed message inline. `name-collision`
  surfaces an additional **Open existing skill** action that closes
  the modal and opens the drawer for the colliding entry.

### 5. Discover-tab callout

`packages/desktop/src/renderer/components/DiscoverTab.tsx`:

The existing _"Anything you install via `npx skills add` will appear
in your registry automatically"_ callout becomes:

> _"See a skill you want? Copy its source-repo folder URL, then
> open Settings → **Install a skill from GitHub**. (For raw npx
> commands, [Open Terminal].)"_

The Open Terminal button stays for power users. Its title attribute
updates: _"Run raw npx commands (advanced). Most users prefer
Settings → Install a skill from GitHub."_

### 6. Tests

`packages/core/src/origin-url.test.ts` (new):

- Folder URL `https://github.com/owner/repo/tree/main/skills/find-skills` →
  `{ repo: "owner/repo", skillPath: "skills/find-skills/SKILL.md", ref: "main" }`.
- Blob URL `https://github.com/owner/repo/blob/main/skills/find-skills/SKILL.md` →
  same canonical shape.
- Repo-root URL → `not-a-skill-folder`.
- Non-github URL → `not-github`.
- Malformed URL (typos, missing parts) → `malformed`.

`packages/core/src/install-from-github.test.ts` (new):

- Success path: mirrors content, stamps marker, baselines hash.
  Uses `vi.stubGlobal("fetch", ...)` like the existing
  `upstream.test.ts` for the GitHub API responses.
- Name collision: pre-existing skill in the registry. Returns
  `name-collision`; no mirror was attempted.
- No SKILL.md at the target: mirror succeeds at the file level
  but `readSkillMeta` returns null. Returns `no-skill-md`; the
  mirrored content is cleaned up.
- Rate-limit (429): `mirrorSkillFolder` returns the rate-limit
  payload; install surfaces `reason: "mirror-failed"` with
  `rateLimit` populated.
- Canonical-name rename: meta.json has a different name than the
  folder. Destination directory ends up at the canonical name.

`packages/desktop/src/main/main.ts` IPC handler test: out of
scope (the renderer-facing wrapper is thin; coverage is on the
core primitive).

## Migration story

None — this is purely additive. No on-disk schema changes. The
installed skills are indistinguishable from skills the maintainer
linked via Settings → Account → Link a GitHub repository (which
mounts a whole repo); this flow just mounts one folder at a time.

## Consequences

- **For end users:** zero terminal context-switch to install
  community skills. Discoverability of the entry point depends on
  the Settings reveal; the Discover-tab callout is the primary
  hint.
- **For the maintainer:** the 62 displaced vendored skills become
  trivially re-installable. Paste each folder URL once; the
  install lands in `personal/` with `source: "user"`. (Use the
  `--bucket vendored` core-API option from a follow-up CLI surface
  if the maintainer prefers them re-stamped as vendored — out of
  scope here.)
- **For Phase 5 (`in-app-publish`):** safekeeping a Discover-
  installed skill works identically to any other github-origin
  skill (the publish flow keys off `entry.source.origin`).
- **For ADR-0002:** no new sidecars; no amendment needed.

## Re-opening this decision

- **If skills.sh's URL scheme is stable + simple**, a follow-up
  plan (`discover-install-button.md`) can layer in-context
  install on the Discover tab. The URL-parse + install primitives
  in this plan are direct call sites for that follow-up. Mostly
  UI work: detect the URL, surface the button, route to the
  existing primitive.
- **If users find the Settings entry point too hidden**, expose
  the modal via a Header button or a Command Palette entry. Both
  are mechanical layering on top of the IPC.
- **If non-GitHub origins become a real demand** (GitLab, gitea,
  bitbucket), the install primitive's `repo` param expands to a
  full URL + the underlying fetcher (`mirrorSkillFolder`) grows a
  host-aware code path. That's a Phase 4b reframe, not in scope.
