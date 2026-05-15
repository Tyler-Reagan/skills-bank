# Registry source

Skills Bank reads its skills from a GitHub repo. By default that's the curated bank shipped with the app — `Tyler-Reagan/skills-bank` — but you can swap in any GitHub repo you own as the source of truth for your registry.

There's no separate "local mode" and "github mode" — every registry mirrors a repo. What changes is **which repo** and **whether you're signed in**.

## First-launch onboarding

On first launch you pick a starting point:

### Use the public skills bank

The default, low-friction path. The app boots into the Registry tab on top of the bundled curated set — no GitHub account needed.

- Refresh re-fetches from `Tyler-Reagan/skills-bank` at the unauthenticated GitHub rate limit (60 requests/hour).
- All registry operations (install, register, export, merge) work normally.
- You can sign in later from **Account → Sign in with GitHub** for 5000/hr and private-repo access — no `pnpm reset` required.

### Connect with GitHub

Authenticate via GitHub Device Flow. After signing in you pick a repo:

- **Recommended row**: `Tyler-Reagan/skills-bank` — the same curated bank, now fetched at 5000/hr.
- **Your repos**: any repo you own, with a `skills/` directory at its root, becomes your registry source of truth.

Pick the recommended row to stay on the curated bank with higher rate limits, or pick your own repo to host your own registry.

## The refresh flow (safe by default)

When you click **Refresh from `<repo>`** (in the header or in Account):

1. Skills Bank downloads a tarball of the linked repo's current commit.
2. Diffs it against your current local registry.
3. If any conflicts (you edited a tracked skill locally and the upstream also changed), opens a per-skill resolver where you pick **Keep mine** / **Use repo's** / **Rename mine**. Skills you've authored entirely yourself (`source: yours`) are protected from being silently overwritten.
4. If no conflicts, applies upstream changes silently with a toast.

This flow is identical whether you're on the bundled default or a custom repo — same modal, same per-skill choices, just pointed at whichever repo is linked.

## Linking your own repo

### What your repo needs to contain

Minimum viable repo:

```
your-skill-bank-repo/
└── skills/
    ├── some-skill/
    │   └── SKILL.md          # required: agent-skill canonical file
    ├── another-skill/
    │   ├── SKILL.md
    │   └── meta.json         # optional: tags + version metadata
    └── ...
```

The `skills/` directory at the repo root is the contract. Each subdirectory is one skill, and each skill needs a `SKILL.md`. The app validates this on link and refuses with a clear message if the structure is missing.

Optional extras the app will pick up:

- `meta.json` per skill — adds tags, version, description metadata.
- `.skills-bank.json` per skill — internal source marker; the app stamps these on refresh if absent.
- Anything else in the repo (READMEs, `.github/`, license, etc.) is ignored.

There is **no `index.json` to maintain** — the app generates one locally from your `skills/` contents on each refresh.

### Setting up a new linked repo from scratch

1. **Create a GitHub repo.** Empty, public or private, doesn't matter.
2. **Add a `skills/` directory at the root.**
3. **Seed at least one skill.** Two easy ways:
   - Copy a skill folder out of this project's [`skills/`](../../skills/) directory and paste it under `skills/` in your repo.
   - Or hand-author a skill: create `skills/my-skill/SKILL.md` with the standard frontmatter and prose.
4. **Commit and push.**
5. **In Skills Bank**: **Account → Change linked repo** → pick your repo (or **Account → Sign in with GitHub** first if you haven't yet).
6. The app fetches a tarball of your repo's current commit, replaces the local registry, and you're done.

After that initial link, edits flow as: edit in a normal git clone of your repo → commit → push → **Refresh from `<repo>`** pulls the new state.

### What this is _not_ (today)

**The app does not push back to your repo.** It's a read-only consumer. There is no in-app commit / push.

This has two practical consequences:

- **To add or update skills in your repo, edit them in a git clone of the repo elsewhere on disk**, with your normal git workflow. Then click Refresh in Skills Bank to pull the new state.
- **Skills you author in-app via Register** (e.g. dragging an external skill into the bank, or adopting a community install) **live in your local app-managed registry, not in your linked repo.** To move them into the repo, copy the skill's folder from `~/Library/Application Support/Skills Bank/registry/skills/<name>/` into your repo's `skills/` directory and commit.

The asymmetry is a deliberate v1 choice — see [`docs/plans/github-mode-coherence.md`](../plans/github-mode-coherence.md) for the reasoning.

## Account panel surfaces

The Account panel shows the same surfaces for every user:

- **Linked: `<bundled>` or `github.com/<owner>/<repo>`** — what your registry mirrors, plus last-fetched relative time and short commit SHA (once you've refreshed at least once).
- **Refresh from `<repo>`** — re-fetch the linked repo (primary action).
- **Change linked repo** — opens the repo picker (secondary; requires sign-in).
- **Identity row** — `@<login>` chip + **Sign out of GitHub** when signed in; **Sign in with GitHub** + rate-limit hint when not.
- **Operations** — Import a registry from disk (replace), Merge a registry into mine, Export registry.

The header has one universal **Refresh from `<repo>`** button. There's no separate "Sync skills" button — refresh is the same operation regardless of whether the linked repo is the bundled default or a custom repo.

## Self-host

Self-hosting is a developer path: fork the app, ship your own build. See [`self-host.md`](../self-host.md). Not a runtime option from the UI.

## What persists

The linked repo (if any), GitHub token (if signed in), and settings are stored in the app's userData folder (`~/Library/Application Support/Skills Bank` on macOS). The registry contents live alongside, under the same userData area.

For developers iterating on the app, `pnpm reset` wipes the stored linked-repo choice and token; `pnpm reset:hard` also wipes the registry and re-seeds source markers. See the README for details.
