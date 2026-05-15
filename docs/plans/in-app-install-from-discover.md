# In-app install from Discover tab (planned)

The Discover tab embeds skills.sh as a WebContentsView, but installing a skill still requires opening a terminal and running `npx skills add` by hand. The terminal popout was a workaround for not having in-app npx invocation; with that infrastructure established by per-skill upstream tracking, the install path can use the same primitive. This plan restores the original intent: the user discovers a skill on skills.sh inside the app, clicks Install, and it lands in their bank — no terminal context-switch.

Under this plan, **community skills come pre-banked, pre-registered, pre-upstream-tracked from second one.** They never pass through the "Not registered" state.

## Depends on

- Plan 03 (per-skill upstream foundation). Reuses `packages/core/src/upstream.ts`'s npx invocation infrastructure.
- Plan 04 (bank-mode persistence). Install-time snapshots use plan 04's cache primitives.

## Goals

1. The user can install any skill from skills.sh by clicking a button in the app — no terminal step required.
2. Installs default to "adopted into the registry as bank-cached" with full upstream and snapshot stamping. Power users can opt into the alternative (install to agent dirs only, registry tracks the external path).
3. The Discover-tab toolbar surfaces the Install button only when the user is on a skill detail page; URL parsing determines this.
4. The terminal popout is reframed as a power-user escape hatch, not the primary install path.

## Non-goals

- Installing from arbitrary GitHub URLs (non-skills.sh sources). Would require a git-kind upstream pointer with a probe and update path, which is deferred.
- Bulk install. One skill per click; users who want multiple run multiple clicks.
- A custom in-app browse experience competing with skills.sh's UI. We embed; we don't replace.

## Scope

### URL detection

When the embedded WebContentsView's URL changes, the main process sends the new URL to the renderer. The renderer matches it against skills.sh's skill-detail URL pattern (research item — see Open questions #1) and resolves the npx package name via:

1. **URL-only path** (preferred). If the URL pattern unambiguously encodes the package name, extract it directly: `https://skills.sh/skills/<package>` → `package`.
2. **API path** (fallback). If the URL doesn't encode the package but skills.sh exposes an API for resolving page → package (e.g. `GET /api/page-meta?url=<url>`), call it from the main process.
3. **DOM-scrape path** (last resort). If neither of the above works, scrape the embedded page's DOM for the canonical install snippet (`npx skills add <pkg>`) and extract from there. Brittle but workable.

The detection result either yields `{ installable: true, package, version? }` or `{ installable: false }`.

New IPC: `discover:detectInstallable(url)` → `Promise<{ installable: boolean; package?: string }>`.

### Install button in Discover toolbar

The Discover-tab chrome (today: Back / Reload / URL / Open Terminal / Open in browser) gains an **Install** button. Visible when the current URL is installable. Renders the inferred package name: e.g. `Install foo`.

Beside Install, a small disclosure button (`▾`) opens a menu:

- **Install to my bank (default)** — adopt into registry, snapshot, stamp upstream.
- **Install only to agent dirs** — npx runs against an agent dir as today's external-skill flow; registry tracks via `external.json`; no snapshot at install time (one will be created on first update, if Bank mode is on).

### Install flow

1. User clicks Install (with default option). The renderer fires `upstream:installSkill` IPC with the package identifier.
2. Main process runs `npx skills add <pkg>` in a temp working directory. The tool downloads the skill content.
3. App resolves the fetched skill's name (from the SKILL.md frontmatter), computes its content hash, captures the version (from the tool's output or the fetched manifest).
4. App moves the content into `<registryRoot>/skills/<name>/`, marks it adopted, writes the `SkillSource` record with `upstream` + (if Bank mode is on) `bankSnapshot`, records the skill in the registry index.
5. App opens the standard install-to-agents follow-up (the existing flow when a newly-registered skill needs link decisions). User picks zero or more agent dirs; symlinks get written.
6. Toast: _"Installed `<name>` into your bank."_

Errors at any step surface via the existing `AppError` / `ErrorPanel` infrastructure.

The "Install only to agent dirs" alternative skips step 4's adoption: npx runs against the agent dir picked in step 5, and step 4 records the path in `external.json` rather than copying files into the registry.

### Terminal popout reframing

The Discover tab's existing callout reads:

> _"Anything you install via `npx skills add` will appear in your registry automatically."_

Replace with:

> _"Click Install in the app to add a skill to your bank. For raw npx commands, [Open Terminal]."_

The Open Terminal button stays but its title attribute updates to _"Run raw npx commands (advanced)."_

## Files this PR will touch

- `packages/desktop/src/renderer/components/DiscoverTab.tsx` — Install button + disclosure menu; URL-change handling; callout copy.
- `packages/desktop/src/main/main.ts` — IPC handlers for `discover:detectInstallable` and `upstream:installSkill`; main-process URL parsing; main-process npx invocation in temp dir; move-into-registry-as-adopted logic; main-side wiring to the existing install-to-agents follow-up.
- `packages/desktop/src/shared/ipc.ts` — new channels + types (`InstallableProbe`, `InstallSkillOptions`).
- `packages/core/src/upstream.ts` — extend with `installSkill(package, target)` primitive; reuses npx invocation established in plan 03.
- `packages/core/src/bank-cache.ts` — reused; no changes.
- `packages/core/src/source.ts` — reused; no changes.

## Verification

### URL detection

- Navigate the Discover tab to a known skills.sh skill detail page. The Install button surfaces with the right package name.
- Navigate to skills.sh's home page or a non-skill page. The Install button is hidden.

### In-app install (default: adopted into bank)

- Click Install. Toast confirms install. Skill appears in the registry as adopted with `upstream` stamped and `bankSnapshot` written (assuming Bank mode is on).
- The install-to-agents follow-up appears; pick a couple of agent dirs; verify symlinks land where expected.
- Repeat with Bank mode off: install succeeds, upstream stamped, no snapshot written.

### In-app install (alternative: tracked external)

- Open the disclosure menu, pick **Install only to agent dirs**.
- Install proceeds against the picked agent dir as today's external-skill flow.
- Registry records the path in `external.json`; no copy in the registry root; upstream stamped; no snapshot.

### Terminal popout

- Open Terminal still works; the title and callout reflect the new framing.
- A user who installs via `npx skills add` in the popout terminal still sees the skill picked up by plan 03's fallback origin-capture scanner.

### Error handling

- Install a non-existent package. `npx skills add` errors. The app surfaces a clear error via the existing ErrorPanel; no half-installed state remains in the registry.
- Quit the app mid-install. On relaunch, the temp dir is cleaned up; no orphaned partial install.

## Open questions

1. **skills.sh URL scheme & page → package resolution.** What's the URL pattern for a skill detail page on skills.sh today? Is the npx package name derivable from the URL alone, or does it require an API call or DOM scrape? Determines how robustly the Install button can light up. Fallback chain (URL → API → DOM) covers all three cases.
2. **Disclosure menu UX.** Is "Install to my bank ▾" the right surface, or should the alternative be promoted (e.g. a Settings toggle "By default, install community skills into..." with bank/agent-dir choices)? Defer the question until Bank mode usage is measurable.
3. **WebContentsView event for URL change.** Confirm the main-process can subscribe to the embedded view's URL-change events at acceptable granularity (every nav vs. every history push). May affect Install-button responsiveness on SPA pages.
