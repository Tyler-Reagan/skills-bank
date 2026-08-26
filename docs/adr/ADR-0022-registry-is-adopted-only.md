# ADR-0022 — The registry is adopted-only; in-place registration and custom dirs removed

**Status:** Superseded by [ADR-0027](./ADR-0027-add-and-delete-replace-register.md) — Register is dead; Add and Delete are the writer verbs. In-place tracking and custom dirs stay gone. This ADR still supersedes [ADR-0011](./ADR-0011-register-vs-move-into-bank-primitive-split.md).

## Context

[ADR-0011](./ADR-0011-register-vs-move-into-bank-primitive-split.md) split registration
into two primitives — `register` (record-only, `adopted: false`, files stay put) and
`move-into-bank` (relocate into `skills/<bucket>/`, `adopted: true`) — so a skill could be
tracked without being moved. The motivating case (issue #125) was a non-egressable work-org
repo: files that can't move into the bank but still want app-managed agent symlinks and labels.

That gave "Registered" two meanings behind an `adopted` boolean, and it required a **second
record system** alongside the manifest: `external.json`, its own read/write/remove module, and
a parallel set of downstream forks — `unregisterExternal`, `external-target-missing`,
`repointExternalEntry`, the in-place exclusion in the pushed-manifest projection, the
`registerAdopts` chain predicate, `canMoveIntoBank`, and the "Move into bank" drawer action.
[ADR-0021](./ADR-0021-manifest-is-the-live-skill-record.md) had just collapsed provenance to
one record (the manifest) precisely to kill this "one fact, two stores" shape; in-place
registration reintroduced it for a different fact ("is this skill in the bank?").

The keep-in-place need was slated to move to a future robust custom-skills-directories feature
(`customSkillsDirs`, the `customDir`/`customDirs` scan plumbing). On review the maintainer chose
to **drop that need entirely** rather than build more machinery around it — the same call, and
the same reasoning, as retiring the curated feature set in [ADR-0017](./ADR-0017-curated-and-bundled-default-removed.md):
a narrow workflow does not justify a parallel subsystem threaded through the register / unregister
/ scan / classify / manifest paths.

## Decision

**A skill is Registered if and only if its files live under `<registryRoot>/skills/`.** The
`adopted` axis is deleted because it is now always true.

- **Register = move files into the bank + write a manifest row.** One verb, one effect. The old
  record-only `registerSkill` (which wrote `external.json`) is deleted; what was `moveIntoBank`
  becomes the sole `register` implementation. Registering a foreign-symlink or real-directory
  install resolves its realpath, moves the real content into `skills/personal/<name>/`, and
  sweeps agent symlinks onto the bank copy — unchanged mechanics, minus the branch.
- **Unregister = move files out.** The `adopted`-vs-external fork in `unregisterSkill` collapses
  to the single existing adopted path: files move to the `unregisterDestinationAgent` directory
  (default `~/.agents/skills/`), symlinks repoint. `unregisterExternal` is deleted.
- **Custom skills directories are removed** — the `customSkillsDirs` setting and all
  `customDir`/`customDirs` plumbing (`installed.ts` scan loop, `InstalledSkill.customDir`,
  `ActionTarget.customDir`, `scanExistingInstalls`/`IPC.scan` args, renderer wiring). The
  Installed tab scans the known agent dirs only.
- **Deleted machinery:** `registry/external.ts`; the `adopted` field on `RegistryEntry` and its
  `RegistrationAction` variants; `registerAdopts` setting + the `useRegisterSkill` chain
  predicate; `canMoveIntoBank` + the "Move into bank" button/hint; the `external-target-missing`
  drawer state and `repointExternalEntry`; the in-place filter in `toPushedProjection` (nothing
  in-place remains to filter).
- **Classifier collapse (`skill-state.ts`).** `unregistered-real` and `unregistered-foreign` —
  which drove zero distinct renderer copy and identical capabilities — merge into a single
  `unregistered` state. `external-target-missing` and its `canRepoint` capability are deleted with
  the in-place path; `registry-folder-missing` + `canForgetMissing` survive as the sole
  missing-files heal. (A future "registering this real directory will physically move your folder"
  warning, if wanted, derives from the installed entry's `kind` at render time — it does not need
  a persisted drawer state.)

## Consequences

- **Non-egressable work repos (issue #125) are no longer supported.** Accepted intentionally.
  A skill that can't be moved into the bank simply isn't registered; it can still be installed
  into agent dirs by other tools and will show in the Installed tab as `foreign-symlink` /
  `real-directory`, just not managed by the registry. Custom-dir support can return later as its
  own feature if demand does — carrying none of the adopted/in-place complexity.
- **Existing in-place entries fall out silently — no migration.** An in-place skill lives only
  as an `external.json` row (no manifest row, no folder under `skills/`). Once `build.ts` stops
  reading `external.json`, those entries stop being registered; their files are untouched (never
  in the bank) and reappear in the Installed tab as unregistered installs — the correct
  representation post-decision. `external.json` itself is inert dead weight, not cleaned up:
  no code reads or deletes it post-cut, so a pre-existing file is left on disk, silently
  ignored forever. No first-boot notice, no migration step (ADR-0021's "long-lived correctness
  invariant, not standing migration machinery").
- **Heal states shrink to one missing-files case.** `registry-folder-missing` survives (the bank
  folder deleted out from under an entry); `external-target-missing` and its repoint action go.
- **`repoint` now means exactly one thing** — rewrite an Origin URL. This resolves the
  register/install pass's item #6 (two unrelated "repoint" verbs) by deletion, not renaming.
- **Register's audit log is honestly named.** With one register path, `recordRegistration` /
  `registration-*.json` correctly describes what it logs (previously it fired only from
  `move-into-bank`). Folded into the ADR-0021 keep-N rotation.
- Wire format is unaffected: the manifest never carried `adopted`; `external.json` was local-only
  state. No schema bump.

## Out of scope

The `personal`/`vendored` **bucket** split is untouched — it is origin-derived and orthogonal to
the adopted-derived machinery this ADR removes. A separate proposal to flatten it to a single
`skills/` tree (trading away ADR-0020's re-link-relabel safety) is captured for future
consideration in [issue #164](https://github.com/Tyler-Reagan/skills-bank/issues/164), not
decided here.

## Backcompat — none (deliberate hard cut)

Every removed/renamed `packages/core` symbol — `external.ts`'s exports, `RegistryEntry.adopted`,
`shared/conflict.ts` (barrel-re-exported), `registerSkill`/`moveIntoBank`, `repointExternalEntry`,
and `InstalledSkill`→`AgentDirEntry` — is cut outright: no tolerant read, no `@deprecated` alias.
This diverges from the repo's post-1.0 one-minor-cycle deprecation convention by explicit
maintainer decision, on the same grounds as [ADR-0011](./ADR-0011-register-vs-move-into-bank-primitive-split.md):
these are internal core↔desktop plumbing symbols with no out-of-repo SDK consumer (verified — only
the desktop package and `scripts/` reference them, both updated in the same change). `pnpm
typecheck` across all packages + `scripts/` is the safety net.

## Alternatives rejected

- **Keep in-place registration, move it to a robust `customSkillsDirs` home** (the prior plan,
  ADR-0011's deferred direction). Rejected: it preserves the parallel record system and the
  `adopted` fork this decision exists to delete, and builds _more_ around a need the maintainer
  no longer wants to serve.
- **Keep `adopted` as a derived UI-only hint.** Nothing left to derive once in-place entries are
  gone — every registered skill is in the bank by construction.
