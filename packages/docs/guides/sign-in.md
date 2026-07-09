# Sign in with GitHub

Fresh installs start **empty** — there's no default skill set. You build up your registry by authoring skills locally (they land in your bank via Register), installing from the **Discover** tab, or linking a GitHub repo you own as your registry's source of truth. Signing in isn't required for any of that except linking a repo.

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

Anything else in the repo (READMEs, `.github/`, license, etc.) is ignored.

There is **no `index.json` to maintain** — the app generates one locally from your registry's contents on each refresh.

### Setting up a new linked repo from scratch

1. **Create a GitHub repo.** Empty, public or private, doesn't matter.
2. **In Skills Bank**: sign in via **Account → Sign in with GitHub**, then click **Link** next to **Repository** (reads **Change** once a repo is already linked) → pick your new repo. Since the repo has no `registry-manifest.json` committed yet, linking imports nothing — that's expected, not an error.
3. **Build up your registry.** Author skills in-app (Register), or install from **Discover**.
4. **Export.** **Account → Manage your registry → Export manifest** commits `registry-manifest.json` to your repo — the one write path that sends local state out. From then on, linking that repo (on this machine or another) picks up those skills on import.

Day-to-day, edits flow as: author/register locally → **Export manifest** → or, on another machine: **Import from `<repo>`** (header button) to fetch the latest.

### What this is _not_

**Import from `<repo>` (the header button) is read-only.** It fetches and reconciles upstream changes; it never writes anything back to the repo. The only write path that commits to your repo is **Export manifest** in **Account → Manage your registry** (see [Move your registry](/guides/manifest)).

## Account modal surfaces

<!-- SCREENSHOT NEEDED: Account modal — Repository, Account (identity), and Manage your registry sections. -->

The Account modal shows the same surfaces for every user:

- **Repository** — current registry source (chip: the linked repo, or "Not linked"), last-fetched time, and short commit SHA. This is a status display, not a button — use the **Import from `<repo>`** button in the app header to refresh.
- **Link** / **Change** — opens the repo picker (requires sign-in). Reads "Link" when nothing's linked yet, "Change" once a repo is linked.
- **Account row** — `@<login>` chip + **Sign out** when signed in; **Sign in with GitHub** when not.
- **Manage your registry** — move your registry state via a **manifest** (origin-pointer JSON): **Import manifest** / **Export manifest**. See [Move your registry](/guides/manifest) for the full flow including repo transport.

## Self-hosting

Self-hosting is a developer path: fork the app, ship your own build. See [Self-hosting](/self-host). Not a runtime option from the UI.
