# Registry source

Skills Bank picks a registry source — the place where your skills physically live — when it launches. Two modes: **Local bundled** (the default — the curated set shipped with the app) and **GitHub-linked** (the registry mirrors a GitHub repo you own).

## Default: Local bundled

On first launch the app materializes a local registry at `~/Library/Application Support/Skills Bank/registry/` and seeds it with the curated bundled skills. You get:

- The full set of bundled skills, installable with one click.
- A **Sync skills** button that fetches the latest upstream bundled skills while preserving anything you've added or modified.
- The ability to register your own skills alongside the bundled ones.
- **Export registry** and **Import a registry** from Account — move your registry to another machine or back it up as a zip.

No GitHub auth required. This is the path the rest of the docs assume unless otherwise noted.

## GitHub-linked

### What this mode is

A GitHub repo you own becomes the **source of truth for your registry**: both the manifest (which skills exist) and their content (each `SKILL.md`) live in that repo. The Skills Bank app pulls from your repo on demand and renders the resulting registry locally. Think of it as:

- **Your repo** = your skill bank (the durable, version-controlled, portable artifact).
- **Skills Bank app** = the viewer / installer that reads from the repo and wires skills into your agent directories.

The app itself never lives in your repo. You install Skills Bank once per machine; your repo holds the content that follows you across machines.

### When to use it

- **Multi-machine continuity.** Same registry on your work laptop, personal laptop, and any future machine — clone, link, done.
- **Curate your own set.** Pick the bundled skills you want, drop the ones you don't, add your own. Your repo's `skills/` is whatever you choose to put there.
- **Team / org sharing.** Point teammates at the same repo and they get the same set.
- **Version-controlled history.** `git log` shows your skill evolution; `git diff` shows what a refresh would change before you apply it.

Stay on **Local bundled** if you don't need any of that — local-bundled is simpler, requires no auth, and syncs the curated set from the app's canonical upstream automatically.

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

That's it. The `skills/` directory at the repo root is the contract. Each subdirectory is one skill, and each skill needs a `SKILL.md`. The app validates this on link and refuses with a clear message if the structure is missing.

Optional extras the app will pick up:

- `meta.json` per skill — adds tags, version, description metadata.
- `.skills-bank.json` per skill — internal source marker; the app stamps these on refresh if absent.
- Anything else in the repo (READMEs, `.github/`, license, etc.) is ignored.

There is **no `index.json` to maintain** — the app generates one locally from your `skills/` contents on each refresh.

### Setting up a new linked repo from scratch

1. **Create a GitHub repo.** Empty, public or private, doesn't matter. Name is up to you (e.g. `my-skills-bank`, `team-skills`).
2. **Add a `skills/` directory at the root.**
3. **Seed at least one skill.** Two easy ways:
   - Copy a skill folder out of this project's [`skills/`](../../skills/) directory and paste it under `skills/` in your repo.
   - Or hand-author a skill: create `skills/my-skill/SKILL.md` with the standard frontmatter and prose.
4. **Commit and push.**
5. **In Skills Bank**: first-launch screen → **Connect your own registry** → authenticate via GitHub Device Flow → **Choose registry repo** → pick your repo.
6. The app fetches a tarball of your repo's current commit, replaces the local registry, and you're done.

After that initial link, edits flow as: edit in a normal git clone of your repo → commit → push → **Refresh from `<repo>`** in Skills Bank's Account panel pulls the new state.

### What github-linked mode is _not_ (today)

**The app does not push back to your repo.** It's a read-only consumer. There is no in-app commit / push.

This has two practical consequences:

- **To add or update skills in your repo, edit them in a git clone of the repo elsewhere on disk**, with your normal git workflow. Then click Refresh in Skills Bank to pull the new state.
- **Skills you author in-app via Register** (e.g. dragging an external skill into the bank, or adopting a community install) **live in your local app-managed registry, not in your linked repo.** To move them into the repo, copy the skill's folder from `~/Library/Application Support/Skills Bank/registry/skills/<name>/` into your repo's `skills/` directory and commit.

The asymmetry is a deliberate v1 choice — see [`docs/plans/github-mode-coherence.md`](../plans/github-mode-coherence.md) for the reasoning, and [`docs/plans/github-first-onboarding.md`](../plans/github-first-onboarding.md) for the downstream unification that may reframe (but not close) this asymmetry.

### The refresh flow (safe by default)

When you click **Refresh from `<repo>`**, Skills Bank:

1. Downloads a tarball of your repo's current commit.
2. Diffs it against your current local registry.
3. If any conflicts (you edited a tracked skill locally and the upstream also changed), opens a per-skill resolver where you pick **Keep mine** / **Use repo's** / **Rename mine**. Skills you've authored entirely yourself (`source: yours`) are protected from being silently overwritten.
4. If no conflicts, applies upstream changes silently with a toast.

The flow is identical to local-bundled Sync — same modal, same per-skill choices — just pointed at your repo instead of the canonical bundled set.

### Account panel surfaces

After linking, the Account panel shows:

- **Linked: github.com/&lt;owner&gt;/&lt;repo&gt;** with last-fetched relative time and short commit SHA.
- **Refresh from &lt;repo&gt;** — re-fetch the linked repo (primary action).
- **Choose a different repo** — switch the linked repo (secondary).
- **Sign out of GitHub** — clears the token and reverts to first-launch state.

The Sync skills header button is hidden in github-linked mode; refresh-from-repo replaces it.

## Self-host

Self-hosting is a developer path: fork the app, ship your own build. See [`self-host.md`](../self-host.md). Not a runtime option from the UI.

## What persists

Registry source, GitHub token (if any, once linked-mode lands), and settings are stored in the app's userData folder (`~/Library/Application Support/Skills Bank` on macOS). The registry contents live alongside, under the same userData area.

For developers iterating on the app, `pnpm reset` wipes the stored registry-source choice and token; `pnpm reset:hard` also wipes the registry and re-seeds source markers. See the README for details.
