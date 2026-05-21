# Ubiquitous Language

Domain: per-skill upstream tracking, drift detection, and the manual upstream picker in the desktop drawer.

## Skill identity

| Term         | Definition                                                                                                        | Aliases to avoid                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Skill**    | A folder containing a `SKILL.md` that the user has installed locally                                              | Package, plugin                           |
| **Registry** | The on-disk directory of installed **Skill**s the desktop app reads from                                          | Library, collection, bank                 |
| **Bucket**   | Spatial categorization of a **Skill** under any **Registry**'s `skills/` directory. `personal` for **Skill**s authored by the registry owner (self-referential **Origin** or `kind: "none"`); `vendored` for harvested **Skill**s with external **Origin**. The pattern is universal across **Registry** types — a specific registry may use only one bucket as a matter of composition (e.g. a **Curation layer** whose maintainer authors elsewhere uses only `vendored/`); the unused bucket simply isn't materialized on disk | Category, group                          |
| **Adopted**  | A **Skill** whose files live inside the user's **Registry** and are managed by the desktop app                    | Owned, local, bundled (overloaded — see Flagged) |
| **Tracked**  | A **Skill** whose files live in the agent directory and are managed by the `vercel-labs/skills` CLI               | CLI-managed, external                     |

## Origin

| Term              | Definition                                                                                                                                                                   | Aliases to avoid                                                |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **Origin**        | The **authoritative upstream** where a **Skill** is maintained by its author — a GitHub repo + path within it. Never refers to where the local file copy came from (see **Curation layer**). | Upstream (overloaded — see Flagged), source, provenance, bundled repo (wrong layer — see Flagged) |
| **Origin pointer**| The serialized **Origin** record stored in `.skills-bank.json`                                                                                                              | Upstream pointer, marker, stamp                                 |
| **Origin repo**   | The GitHub `owner/name` of an **Origin** — the author's repo for harvested skills; the bundled repo for self-authored skills (where authorship and curation coincide)         | Source repo, upstream repo, repo (when ambiguous)              |
| **Origin path**   | The path to `SKILL.md` within the **Origin repo**                                                                                                                            | Skill path, source path                                         |
| **Origin hash**   | The SHA-1 git tree hash of the **Origin** folder at the time of last fetch                                                                                                    | Skill folder hash, snapshot hash, tree hash                     |

## Curation layer (distinct from Origin)

| Term                | Definition                                                                                                                                                                            | Aliases to avoid                                                  |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Curation layer**  | A repo that vendors **Skill**s from various **Origin** repos into a single distribution point. The bundled repo (`Tyler-Reagan/skills-bank`) is the canonical example. Ships content via the desktop .dmg. | Bundled repo (when used to mean "Origin"), distribution layer    |
| **Vendoring**       | The maintainer-time act of fetching a **Skill** from its **Origin** repo and committing it (plus marker) into a **Curation layer**                                                       | Snapshotting, mirroring, importing                                |
| **Bundled set**     | The collection of **Skill**s a given **Curation layer** distributes. End users inherit this set via the .dmg's first-launch content.                                                    | The bundle, the bank's skills                                     |

## Drift and update lifecycle

| Term              | Definition                                                                                                                       | Aliases to avoid                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| **Baseline**      | The local snapshot the app compares against to detect user edits (`.skills-bank-hash`)                                           | Reference, anchor                               |
| **Drift**         | The condition where a **Skill**'s local content no longer matches its **Baseline**                                               | Edits, divergence, dirty                        |
| **Update available** | The condition where the **Origin hash** at the remote has moved past the **Origin hash** recorded locally, and there is no **Drift** | Out of date, stale                              |
| **Probe**         | The act of calling GitHub's Git Trees API to check the current upstream **Origin hash**                                          | Check, poll, sync                               |

## Origin operations (user-visible verbs)

These are the three commit actions a user can take on a **Skill**'s **Origin**. Each maps one-to-one to a drawer button.

| Term              | Definition                                                                                                                       | Aliases to avoid                                                  |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Update**        | Pull the current **Origin** content into the local **Skill**. Valid only when **Update available** and no **Drift** is present.   | Apply upstream, refresh, sync                                     |
| **Reset to origin** | Discard local **Drift** and restore the **Skill** to its **Origin** snapshot                                                    | Take upstream, revert, restore                                    |
| **Unlink origin** | Clear the **Origin pointer** for a **Skill**, keeping local content as-is. The **Skill** is now origin-less.                     | Sever upstream, accept drift, detach                              |

## Picker (manual origin form)

| Term              | Definition                                                                                                                                  | Aliases to avoid                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Picker**        | The drawer disclosure UI that lets a user declare an **Origin** for an **Adopted** **Skill** that has no **Origin pointer**                 | Form, picker modal                                            |
| **Link origin**   | The user action of supplying an **Origin repo** + **Origin path** through the **Picker**                                                    | Stamp, tag, set upstream                                      |
| **Mark as local** | The user action of declaring a **Skill** has no upstream and is locally authored. Sets `kind: "none"` on the **Origin pointer**.            | I authored this, mark as user-authored, skip                  |

## Publish operations (user-visible verbs)

These are the user-time verbs for pushing local **Skill** content to a **Linked repo** as a pull request. Distinct from **Vendoring** (maintainer-time) and from **Origin operations** (per-skill inbound from **Origin**).

| Term            | Definition                                                                                                                                                                                                                                                                                  | Aliases to avoid                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| **Publish**     | Push a **Skill** from the local **Registry** to the user's **Linked repo** as a pull request. Three sub-flows by trigger condition: new skill (no **Origin**, `personal/`), safekeeping (has **Origin**, no **Drift**, `vendored/`), or **Fork** (has **Origin**, **Drift** detected). PR-only — the linked repo's default branch is never written directly. | Push, ship, submit                                            |
| **Fork**        | A confirmed **Publish** of an edited vendored **Skill**. Composes **Unlink origin** with a bucket move (`vendored/` → `personal/`) and a **Source** flip (`bundled` → `yours`). Requires explicit user confirmation; irreversible without re-vendoring.                                       | Sever and publish, claim, take over                           |
| **Safekeeping** | The motive for **Publish**ing an unedited vendored **Skill**: deposit the third-party content into your **Linked repo** so it survives if the **Origin** goes dark. The **Origin pointer** is preserved; updates from the original author continue to surface via the update **Probe**.       | Backup, snapshot, deposit                                     |

## Linked repo

| Term                  | Definition                                                                                                                            | Aliases to avoid                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Linked repo**       | The GitHub repo the user has connected to the desktop app as their personal **Registry** source. For the maintainer, this happens to be the bundled `Tyler-Reagan/skills-bank`; for other users, it's their own fork or a separate repo they maintain. | registry repo, github registry, power persona's repo |
| **Linked repo PR**    | A pull request opened against the **Linked repo** by the **Publish** flow. Stable branch name `publish/<name>`; subsequent publishes of the same skill append commits to the open PR.                                                              | Publish PR, push request                          |

## Registry manifest

A portable, metadata-only artifact representing a **Registry**'s state at a point in time. Distinct from the per-skill content exports produced by `exportSkill`. The artifact and its operations are first-class concepts because they underpin cross-machine **Registry** portability.

| Term                  | Definition                                                                                                                            | Aliases to avoid                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| **Registry manifest** | A portable JSON artifact representing a **Registry**'s state at a point in time. For every registered **Skill**: name, **Source** value, **Origin pointer** (including baseline `skillFolderHash` for vendored skills at export time), local tags, dismissed/hidden state, and `lastInstalledOn` (the set of agent kinds the skill was installed into on the source machine). Plus registry-level metadata: `schemaVersion`, `exportedAt`, `sourceBankVersion`. **Metadata only — no skill content.** The artifact lives outside the registry on disk; the user routes the file to a **Linked repo**, a **userData auto-snapshot**, or any user-chosen destination. | Registry export (the verb, not the artifact); registry bundle (overloaded — see Flagged); registry snapshot (ambiguous with **userData auto-snapshot** — see Flagged); lockfile (npm-ism that misleads on bank semantics) |
| **Manifest import**   | The operation that consumes a **Registry manifest** and restores **Registry** membership. For each skill in the manifest: if no local entry exists, the bank mirrors content from the **Origin** via `mirrorSkillFolder` and restores tags + dismissed/hidden state. **Does not install** — installation remains a separate, user-initiated action surfaced as an optional confirm-batch step after import. Per-skill outcomes: `registered` / `origin-unreachable` / `collision` / `skipped`. | Registry import (too coarse — also used colloquially for content-bearing imports); restore registry (ambiguous with userData auto-snapshot restore); sync from manifest |
| **Manifest export**   | The operation that produces a **Registry manifest** from the current **Registry** state. Pure read operation; never mutates the registry. Triggered explicitly by the user from Settings; also fired automatically on every registry change to produce a rotating userData auto-snapshot (last 5 retained). | Registry export (overloaded with the deprecated content-bearing `exportRegistry` — see Flagged), snapshot registry |
| **userData auto-snapshot** | A **Registry manifest** written to the app's userData directory automatically on every registry change. Retains the last 5; rotates older entries out. Independent of any **Linked repo**; protects against local registry corruption without user effort. | Auto-backup, rolling backup |

## Relationships

- A **Skill** has at most one **Origin pointer**.
- An **Origin pointer** with `kind: "github"` carries an **Origin repo**, an **Origin path**, and an **Origin hash**.
- An **Origin pointer** with `kind: "none"` declares the **Skill** has no upstream (set via **Mark as local**).
- **Drift** is detected by comparing the current **Skill** content against its **Baseline**, not its **Origin hash**.
- **Update available** is detected by comparing the latest **Probe** result against the recorded **Origin hash**.
- **Update**, **Reset to origin**, and **Unlink origin** are mutually exclusive primary actions — exactly one is offered at a time based on the **Skill**'s drawer state.
- **Publish** is orthogonal to the **Origin operations** — it pushes outbound to the **Linked repo**; the **Origin operations** pull inbound from **Origin**. A single **Skill** can be **Update**-eligible and **Publish**-eligible simultaneously.
- **Fork** is a composition of **Unlink origin** + bucket move + **Source** flip, gated by a user confirmation. The underlying **Unlink origin** is the same primitive that fires in the heal flow when the user keeps local edits to a bundled skill.
- **Safekeeping** is the rationale-name for the (has **Origin**, no **Drift**) **Publish** sub-flow — not a separate operation. It exists in the glossary because the *reason* explains why the **Origin pointer** stays in place when the (functionally identical) **Fork** drops it.

## Example dialogue

> **Dev:** "When the user clicks **Link origin** in the **Picker**, what fires?"
> **Domain expert:** "We validate the **Origin repo** + **Origin path** by running a **Probe**, then write an **Origin pointer** with `kind: \"github\"` to `.skills-bank.json` and stamp the resulting **Origin hash** as the new **Baseline**."
> **Dev:** "So a **Drift** detection right after **Link origin** would always show clean?"
> **Domain expert:** "Right — the **Baseline** matches the just-fetched content. **Drift** only appears after the user edits files locally."
> **Dev:** "And **Update** vs **Reset to origin** — same network call?"
> **Domain expert:** "Same fetch, different precondition. **Update** runs when there's no **Drift**; **Reset to origin** runs when there is. **Reset to origin** is destructive to local edits, so the drawer prompts for confirmation; **Update** doesn't."

## Flagged ambiguities

- **"Upstream" was used to mean both the conceptual origin (a GitHub repo as the source of truth) and the data record (`UpstreamPointer`).** The conceptual sense is now **Origin**; the data sense is **Origin pointer**. The wire-format rename (`SkillSource.upstream` → `SkillSource.origin` on `.skills-bank.json`) landed in v1.3 with a tolerant-read window for one minor cycle — see the [CHANGELOG](CHANGELOG.md) v1.3.0 entry and the [ADR-0002 amendment](docs/adr/ADR-0002-sidecars-are-the-skill-record.md).

- **`source` axis values renamed in v1.3:** `bundled` → `curated`, `yours` → `user`. Same tolerant-read window. Drops the second-person framing that read awkwardly in badges + tooltips, and stops "bundled" from being overloaded with "shipped in the app binary" (which was never true — the curated set has always shipped via the linked repo). The legacy values still parse on read for one minor cycle; writes use only the new form.

- **Persona collapsed in v1.3.** The first-launch picker that asked users to choose between "Use the public skills bank" and "Connect with GitHub" is retired. Every install starts on the bundled default (`linkedRepo: null`); GitHub linking moves to a single entry point in **Settings → Account → Sign in with GitHub**. The `registrySource` field on `AuthStatus` stays on the wire as a derived alias for one minor cycle and is removed in v1.4.
- **"Origin" was conflated with "distribution source" in the now-reverted Tier 3 scanner.** Resolved in v0.11.2 (origin-paradigm-reframe): **Origin** = where the **Skill** is authoritatively maintained (its author's repo); the **Curation layer** = where the local file copy happens to live. End-user "Update" pulls from **Origin**, never from the **Curation layer**. The bundled repo is a **Curation layer**, not an **Origin** (with the single exception of self-authored skills, where authorship and curation happen in the same repo).
- **"Stamp" was used as a verb for setting the origin** ("Stamp a GitHub upstream", `scanAndStampUpstreamFromLock`). It's internal jargon and conflates two things — the data-layer scanner writing markers automatically, and the user manually declaring origin. Reserve **stamp** for the internal automatic write (the lock-file scanner). Use **Link origin** for the user action in the **Picker**.
- **"Bundled" was used for three different things.** (1) The repo that ships skills via the .dmg (now: **Curation layer** or **Bundled repo** with the qualifier). (2) Curated **Skill**s shipped with the app (now: **Bundled set**). (3) The older drawer state name `bundled-skill-edited` (a **Drift** state). Standardize per the new entries above; **Edited without origin** for the drift state.
- **"Adopted" vs "tracked" is a real and important distinction, not a synonym.** **Adopted** = files live in the **Registry**; **Tracked** = files live in the agent dir under CLI management. Update copy in the drawer must say which one — currently the v0.11.1 notes call it "tracked vs adopted" inconsistently with the code (`entry.adopted !== false`).
- **"I authored this" and "mark as user-authored" appear on the same button + its tooltip** with different phrasings. Pick **Mark as local** (button) and drop the tooltip explanation; the label is now self-evident.
- **"Take upstream" (PR 36 description) vs "Apply upstream" (commit message) vs "Update" (UI label).** Three terms for at-most-two operations. Canonical: **Update** (clean local) and **Reset to origin** (dirty local). Retire "take upstream" and "apply upstream" from user-facing copy; keep them out of new code.
- **"Sever upstream" vs "Accept drift"** — the code uses both for the same heal action. **Unlink origin** is the proposed canonical user-facing term. The capability flag `canAcceptDrift` describes a *capability* (the **Skill** is eligible to be unlinked), which is fine internally; the *action* is **Unlink origin**.
- **"Where did this come from?" (picker section heading) and "Origin" (drawer section heading) are the same domain concept.** Two headings, two voices. Pick one. Recommendation: use **Origin** for both, since the picker only appears when **Origin** is unset — the heading "Origin" plus the empty state "No origin set" is more consistent than two voices.
- **"Fork" overlaps with "Unlink origin."** **Fork** is the user-facing umbrella verb for the (publish-time) composition of three operations: **Unlink origin** + bucket move (`vendored/` → `personal/`) + **Source** flip (`bundled` → `yours`). **Unlink origin** is also reachable independently from the heal flow (the user keeps edits to a bundled or vendored skill but doesn't intend to publish). The distinction matters because the publish-time fork forces a confirmation modal; the heal-time unlink does not (the user already acted on the heal-pending state). In code: `forkSkill` composes `acceptDriftSeverUpstream` (the legacy-named implementation of **Unlink origin**) plus the new helpers.
- **"Safekeeping" is rationale, not an operation.** It explains *why* the (has **Origin**, no **Drift**) **Publish** sub-flow preserves the **Origin pointer** while the **Fork** sub-flow drops it. There is no `safekeepSkill` primitive — the operation is **Publish**; "safekeeping" is the name for one of the three trigger conditions. If a future surface wants to action "safekeep this skill" directly (e.g. a sidebar shortcut), it routes to **Publish** with the unedited-vendored precondition; it does not create a new verb.
- **"Registry export" is overloaded between the deprecated content-bearing export and the new metadata-only manifest flow.** The legacy `exportRegistry` produced a content `.zip`; it is `@deprecated` post-v1.1 and slated for removal one minor cycle later. The post-v1.1 canonical concept is **Registry manifest** (the artifact) and **Manifest export** / **Manifest import** (the operations). When prose says "export the registry," it now means producing a **Registry manifest** unless explicitly qualified as "content-bearing export." Per-skill `exportSkill` / `getExportInfo` remain unchanged — different surface, different purpose.
- **"Registry snapshot" must not be used loosely.** Two distinct artifacts get conflated under that name: the **Registry manifest** (a single portable JSON file representing registry state at a point in time) and the **userData auto-snapshot** (a rotating series of manifests written automatically to userData on every registry change). Use the precise term for the artifact you mean. Note: an earlier post-v1.0 plan proposed a third artifact — a per-skill content cache called `bankSnapshot` — but that concept was retired during the Phase 1 grilling pass; the bank's rot-survival story relies on registry files persisting on disk plus the **Publish** safekeeping sub-flow, not a separate cache.

## Implications for the picker copy (v0.11.2 redesign)

Applying the glossary to the prior critique:

- **Section heading:** "Where did this come from?" → **Origin** (matches the populated-state section heading; uses **Origin** consistently).
- **Disclosure links (Option A):** "Stamp a GitHub upstream…" → **Link origin** · "I authored this" → **Mark as local**.
- **Form heading (when expanded):** none needed — the section heading already says **Origin**.
- **Field labels:** **Repo** (was OK), **Path** (was OK). Helpers: `e.g. vercel-labs/skills` and `Path within the repo`.
- **Primary button (was "Stamp"):** **Link** (verb form of **Link origin**; pairs cleanly with **Cancel**).
- **"I authored this" button** (if kept inside the form per Option B): **Mark as local**. With **Mark as local** promoted to the disclosure row in Option A, this button doesn't appear inside the form at all.
- **Tooltip on Mark as local:** drop it. The label now reads naturally.
- **Bottom hint (if any):** delete entirely; the **Origin** section heading + visible field labels carry the meaning. If retained: "Origin enables update detection." — six words, no implementation vocabulary.
