# README i18n readiness

This is a **prep doc**, not a translation. It records what needs to stay verbatim, what must stay stable, and where the selector lives so a future localization pass can drop translations in without restructuring.

The repo currently has one canonical README at `/README.md` (English). No localized siblings exist yet.

## Naming convention

Use `README.<bcp47-tag>.md` siblings:

- `README.zh.md` — Simplified Chinese
- `README.es.md` — Spanish
- `README.fr.md` — French
- …

Keep the order of languages identical in every variant's selector.

## Selector slot

`README.md` contains a placeholder block near the top, marked:

```
<!--
README-I18N:SLOT — reserved for a future language selector …
README-I18N:START
…
README-I18N:END
-->
```

When the first translation lands, replace the placeholder comment with the live selector from the skill's `language-selector-reference.md`. The current language is **emphasized** and not linked; other languages are linked.

## Do-not-translate tokens

These tokens must stay verbatim in every variant. Translate the surrounding prose; leave the token literal.

### Package and project identifiers
- `skills-bank`
- `@skills-bank/core`, `@skills-bank/cli`, `@skills-bank/desktop`
- `Skills Bank` (product name as displayed; do not localize)
- `Tyler-Reagan/skills-bank`

### Commands and scripts
- `pnpm install`, `pnpm run build`, `pnpm run typecheck`
- `pnpm run desktop:start`, `pnpm run desktop:dev`, `pnpm run desktop:build`
- `pnpm run desktop:package:mac`, `pnpm run desktop:package:mac:arm64`, `pnpm run desktop:package:mac:x64`, `pnpm run desktop:package:win`
- `pnpm run docs:check`, `pnpm run validate`, `pnpm run build:index`, `pnpm run format`
- `git tag v0.7.0`, `git push origin v0.7.0`
- `node packages/cli/dist/index.js …`

### Environment variables and secrets
- `CSC_LINK`, `CSC_KEY_PASSWORD`
- `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
- `SKILLS_BANK_DEVTOOLS`, `ELECTRON_RUN_AS_NODE`

### File paths and directories
- `~/.claude/skills/`, `~/.cursor/skills/`, `~/.gemini/skills/`, `~/.copilot/skills/`, `~/.continue/skills/`, `~/.cline/skills/`, `~/.codex/skills/`, `~/.agents/skills/`
- `skills/`, `packages/core`, `packages/cli`, `packages/desktop`, `docs/`
- `packages/desktop/dist-electron/`, `SKILL.md`, `meta.json`, `meta-schema.json`
- `.skills-bank.json`, `upstream-canon.json`, `hidden-canon.json`
- `TAXONOMY_ALIGNMENT_PLAN.md`

### URLs, badge URLs, image URLs
- `https://claude.ai/code`
- `https://skills.sh/`
- `https://github.com/Tyler-Reagan/skills-bank/releases`
- All `docs/images/*.png` paths (e.g. `docs/images/registry.png`, `docs/images/setup.png`)

### Taxonomy terminology (treat as proper nouns)
The four-axis taxonomy is part of the product vocabulary. Localized terms may be added in parentheses on first mention, but the English form must remain available because it matches what the UI shows in English builds.

- **Canon**, **Registered**, **Adopted**, **Installed**
- **Hide** / **Unhide**, **Unregister**, **Delete from Skills Bank**, **Manage agent links**
- **Heal**, **Drift**, **Take canonical**, **Accept local**, **Forget entry**
- Card badges: `MISSING`, `DRIFT`, `CANON`, `IMPORTED`, `EXTERNAL`, `YOURS`
- Installation kinds: `ours`, `foreign-symlink`, `real-directory`, `broken-symlink`
- Setting keys: `registerAdopts`, `unregisterDestinationAgent`

## Stable anchors

Same-file `(#slug)` links rely on heading slugs. Renaming a heading silently breaks anchors. The validator (`pnpm run docs:check`) catches these in CI; respect it.

When localizing, GitHub re-derives anchor slugs from the translated heading text. Translators should:

1. Translate the heading.
2. Walk every `(#slug)` link in the file and rewrite the slug to match the localized heading.
3. Run `pnpm run docs:check` against the localized file — it covers anchors, not just file existence.

Headings on this README that are anchor targets today: none (README is a flat document with no intra-doc anchors). Localizing it is therefore anchor-stable by construction. Adding a TOC or anchored callouts later would change that.

## Section order

Keep section order identical to the source. Translators may adjust heading wording for natural language flow, but moving sections around drifts the variant out of sync.

Current README section order:

1. (title + hero image + selector slot)
2. What's in this repo
3. How install works
4. Desktop app → Install, First launch, Building locally, Cutting a release
5. CLI

## When the first translation lands

Workflow:

1. Read the `readme-i18n` skill in full.
2. Run `pnpm run docs:check` — confirm green before starting.
3. Create `README.<lang>.md` mirroring the source structure.
4. Replace the placeholder comment in `README.md` with the live selector block; add the same block to the new sibling.
5. Translate prose only — leave every token in the lists above verbatim.
6. Run `pnpm run docs:check` again — it must stay green.
7. Update this file's "current siblings" note (add a line under [Naming convention](#naming-convention)).
