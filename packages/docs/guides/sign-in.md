# Sign in with GitHub

Skills Bank reads its skills from a GitHub repo. By default that's the curated bank shipped with the app — `Tyler-Reagan/skills-bank` — but you can swap in any GitHub repo you own as the source of truth for your registry.

There's no separate "local mode" and "GitHub mode" — every registry mirrors a repo. What changes is **which repo** and **whether you're signed in**.

## First-launch options

On first launch you pick a starting point:

### Use the public skills bank

The default, low-friction path. The app boots into the Registry tab on top of the bundled curated set — no GitHub account needed.

- Refresh re-fetches from `Tyler-Reagan/skills-bank` at the unauthenticated GitHub rate limit (60 requests/hour).
- All registry operations (install, register, export, merge) work normally.
- You can sign in later from **Account → Sign in with GitHub** for 5000/hr and private-repo access — no reset required.

### Connect with GitHub

Authenticate via GitHub Device Flow. After signing in you pick a repo:

- **Recommended row**: `Tyler-Reagan/skills-bank` — the same curated bank, now fetched at 5000/hr.
- **Your repos**: any repo you own with a `skills/` directory at its root becomes your registry source of truth.

## Linking your own repo

### What your repo needs

Minimum viable repo:

```
your-skill-bank-repo/
└── skills/
    ├── some-skill/
    │   └── SKILL.md          # required — metadata in YAML frontmatter
    ├── another-skill/
    │   └── SKILL.md
    └── ...
```

The `skills/` directory at the repo root is the contract. Each subdirectory is one skill; each skill needs a `SKILL.md` whose YAML frontmatter carries its `name`, `description`, and optional `tags`/`version`/`author`. The app validates this on link and refuses with a clear message if the structure is missing. See [Skill metadata](/reference/skill-metadata).

Optional extras the app will pick up:

- `.skills-bank.json` per skill — internal source marker; the app stamps these on refresh if absent.
- Anything else in the repo (READMEs, `.github/`, license, etc.) is ignored.

There is **no `index.json` to maintain** — the app generates one locally from your `skills/` contents on each refresh.

### Setting up a new linked repo from scratch

1. **Create a GitHub repo.** Empty, public or private, doesn't matter.
2. **Add a `skills/` directory at the root.**
3. **Seed at least one skill.** Two easy ways:
   - Copy a skill folder out of the [`Tyler-Reagan/skills-bank`](https://github.com/Tyler-Reagan/skills-bank) repo's `skills/` directory.
   - Hand-author a skill: create `skills/my-skill/SKILL.md` with standard frontmatter and prose.
4. **Commit and push.**
5. **In Skills Bank**: open the Account panel → **Change linked repo** (or **Choose a different repo** if you already have one linked) → pick your repo (sign in first if you haven't).
6. The app fetches a tarball of your repo's current commit, replaces the local registry, and you're done.

After that initial link, edits flow as: edit in a git clone of your repo → commit → push → **Pull from `<repo>`** (header button) pulls the new state.

### What this is _not_

**Pull from `<repo>` is read-only.** The header Pull action fetches and applies upstream changes; it never pushes local edits back. Skills you author in-app via Register live in your local app-managed registry. To move them into the repo, push the manifest from **Account → Move my registry** — the only write path that commits to your repo (see [Move your registry](/guides/manifest)).

## Account panel surfaces

![Account modal — Registry source, Identity, and Move my registry sections](/images/account.png)

The Account panel shows the same surfaces for every user:

- **Linked: `<bundled>` or `github.com/<owner>/<repo>`** — what your registry mirrors, plus last-fetched relative time and short commit SHA.
- **Linked: `<bundled>` or `github.com/<owner>/<repo>`** — current registry source, last-fetched time, and short commit SHA. This is a status display, not a button — use the **Pull from `<repo>`** button in the app header to refresh.
- **Change linked repo** / **Choose a different repo** — opens the repo picker (requires sign-in; label varies by current state).
- **Identity row** — `@<login>` chip + **Sign out of GitHub** when signed in; **Sign in with GitHub** + rate-limit hint when not.
- **Move my registry** — two sections:
  - **Content** (the full skills tree): Import from disk (replace), Merge from disk, Export as folder.
  - **Manifest** (origin-pointer JSON): Import manifest, Export manifest. See [Move your registry](/guides/manifest) for the full flow including repo transport.

## Self-host

Self-hosting is a developer path: fork the app, ship your own build. See [Self-hosting](/self-host). Not a runtime option from the UI.
