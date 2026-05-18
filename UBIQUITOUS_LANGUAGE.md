# Ubiquitous Language

Domain: per-skill upstream tracking, drift detection, and the manual upstream picker in the desktop drawer.

## Skill identity

| Term         | Definition                                                                                                        | Aliases to avoid                          |
| ------------ | ----------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| **Skill**    | A folder containing a `SKILL.md` that the user has installed locally                                              | Package, plugin                           |
| **Registry** | The on-disk directory of installed **Skill**s the desktop app reads from                                          | Library, collection, bank                 |
| **Bucket**   | Spatial categorization of a **Skill** under the **Registry**'s `skills/` directory. `personal` for **Skill**s authored in this repo (self-referential **Origin** or `kind: "none"`); `vendored` for harvested **Skill**s with external **Origin** | Category, group                          |
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

## Relationships

- A **Skill** has at most one **Origin pointer**.
- An **Origin pointer** with `kind: "github"` carries an **Origin repo**, an **Origin path**, and an **Origin hash**.
- An **Origin pointer** with `kind: "none"` declares the **Skill** has no upstream (set via **Mark as local**).
- **Drift** is detected by comparing the current **Skill** content against its **Baseline**, not its **Origin hash**.
- **Update available** is detected by comparing the latest **Probe** result against the recorded **Origin hash**.
- **Update**, **Reset to origin**, and **Unlink origin** are mutually exclusive primary actions — exactly one is offered at a time based on the **Skill**'s drawer state.

## Example dialogue

> **Dev:** "When the user clicks **Link origin** in the **Picker**, what fires?"
> **Domain expert:** "We validate the **Origin repo** + **Origin path** by running a **Probe**, then write an **Origin pointer** with `kind: \"github\"` to `.skills-bank.json` and stamp the resulting **Origin hash** as the new **Baseline**."
> **Dev:** "So a **Drift** detection right after **Link origin** would always show clean?"
> **Domain expert:** "Right — the **Baseline** matches the just-fetched content. **Drift** only appears after the user edits files locally."
> **Dev:** "And **Update** vs **Reset to origin** — same network call?"
> **Domain expert:** "Same fetch, different precondition. **Update** runs when there's no **Drift**; **Reset to origin** runs when there is. **Reset to origin** is destructive to local edits, so the drawer prompts for confirmation; **Update** doesn't."

## Flagged ambiguities

- **"Upstream" was used to mean both the conceptual origin (a GitHub repo as the source of truth) and the data record (`UpstreamPointer`).** The conceptual sense is now **Origin**; the data sense is **Origin pointer**. The codebase still uses `upstream` as the field name on `SkillSource`; rename or alias for v0.12 if the user-facing rename to **Origin** sticks. The drawer **already calls this section "Origin"** — that confirms the canonical choice.
- **"Origin" was conflated with "distribution source" in the now-reverted Tier 3 scanner.** Resolved by `docs/plans/origin-paradigm-reframe.md`: **Origin** = where the **Skill** is authoritatively maintained (its author's repo); the **Curation layer** = where the local file copy happens to live. End-user "Update" pulls from **Origin**, never from the **Curation layer**. The bundled repo is a **Curation layer**, not an **Origin** (with the single exception of self-authored skills, where authorship and curation happen in the same repo).
- **"Stamp" was used as a verb for setting the origin** ("Stamp a GitHub upstream", `scanAndStampUpstreamFromLock`). It's internal jargon and conflates two things — the data-layer scanner writing markers automatically, and the user manually declaring origin. Reserve **stamp** for the internal automatic write (the lock-file scanner). Use **Link origin** for the user action in the **Picker**.
- **"Bundled" was used for three different things.** (1) The repo that ships skills via the .dmg (now: **Curation layer** or **Bundled repo** with the qualifier). (2) Curated **Skill**s shipped with the app (now: **Bundled set**). (3) The older drawer state name `bundled-skill-edited` (a **Drift** state). Standardize per the new entries above; **Edited without origin** for the drift state.
- **"Adopted" vs "tracked" is a real and important distinction, not a synonym.** **Adopted** = files live in the **Registry**; **Tracked** = files live in the agent dir under CLI management. Update copy in the drawer must say which one — currently the v0.11.1 notes call it "tracked vs adopted" inconsistently with the code (`entry.adopted !== false`).
- **"I authored this" and "mark as user-authored" appear on the same button + its tooltip** with different phrasings. Pick **Mark as local** (button) and drop the tooltip explanation; the label is now self-evident.
- **"Take upstream" (PR 36 description) vs "Apply upstream" (commit message) vs "Update" (UI label).** Three terms for at-most-two operations. Canonical: **Update** (clean local) and **Reset to origin** (dirty local). Retire "take upstream" and "apply upstream" from user-facing copy; keep them out of new code.
- **"Sever upstream" vs "Accept drift"** — the code uses both for the same heal action. **Unlink origin** is the proposed canonical user-facing term. The capability flag `canAcceptDrift` describes a *capability* (the **Skill** is eligible to be unlinked), which is fine internally; the *action* is **Unlink origin**.
- **"Where did this come from?" (picker section heading) and "Origin" (drawer section heading) are the same domain concept.** Two headings, two voices. Pick one. Recommendation: use **Origin** for both, since the picker only appears when **Origin** is unset — the heading "Origin" plus the empty state "No origin set" is more consistent than two voices.

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
