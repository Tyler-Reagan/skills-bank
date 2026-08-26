# ADR-0021 — The manifest is the live skill record; per-skill sidecars removed

**Status:** Superseded by [ADR-0024](./ADR-0024-lock-is-the-live-skill-record.md) — the Lock is the live skill record. There is no Manifest.

## Context

The fact "where did skill X come from" was stored in three places: the per-skill
`.skills-bank.json` sidecar, the exported manifest, and the root `index.json` build artifact.
Three representations of one fact is why the reconciliation machinery existed at all —
`reconcileResidentOrigins` healed sidecar-vs-linked-repo disagreement, `originsEqual` adjudicated
sidecar-vs-manifest collisions on import, `stampOriginMarker` translated manifest claims back into
sidecar stamps. The deletion test: remove the sidecars and that machinery doesn't relocate, it
vanishes — there's nothing left to disagree. Accidental complexity, not essential.

[ADR-0002](./ADR-0002-sidecars-are-the-skill-record.md) decided the opposite ("sidecars are the
skill record") in v0.11.7, when the manifest didn't exist yet and the committed-vs-volatile churn
bug was the live problem. Its _reason_ for splitting files by lifecycle survives this decision;
its sidecar-as-record architecture does not.

## Decision

Content lives in folders. Metadata lives in the manifest. Volatile state lives in one local file.

- **`skills/<bucket>/<name>/` — pure content.** SKILL.md plus support files, no hidden files.
  Per-skill `.skills-bank.json`, `.skills-bank-hash`, and `.skills-bank-runtime.json` are all
  deleted. (The transient per-skill op journal stays — crash-safety state, correct as-is.)
- **`registry-manifest.json` at the registry root is the live record** (v6 shape, ADR-0020),
  updated as part of every mutating operation — the same cadence the rolling snapshot already
  writes on. Local-only skills sit in it with `url: null`.
- **One document, two projections.** The live record contains everything; the _pushed_ form is a
  projection — volatile fields dropped, `url: null` rows filtered — produced by
  `serializeManifest`, the single seam where the filter lives. Diff, three-way merge, and the
  merge-base all operate on the pushed projection, never the live record; otherwise a machine
  pulling from the linked repo would read another machine's local-only skills as "deleted
  upstream" and offer to remove them.
- **`.skills-bank/runtime.json` — one gitignored map** replacing the 2–3 volatile files × N
  skills: `name → { syncedHash, fetchedAt, probeFailureCount, lastProbeFailureAt }`. Index build
  does one read instead of 3N. ADR-0002's lifecycle boundary (volatile never committed) survives
  as this file's whole reason to exist.
- **`index.json` demoted.** The index is a derived join — folders (existence + bucket) × manifest
  (identity + origin + labels intent) × runtime map (volatile) — cheap to rebuild, not worth
  persisting as a third copy of anything.
- **Reconciliation collapses to two explicit cases at the build seam.** Folder without a manifest
  row → unregistered content, stamped a row at index time (honoring ADR-0018's no-vacuum rule).
  Row without a folder → missing content, the existing missing/unreachable state. The bespoke
  healers (`reconcileResidentOrigins`, `stampOriginMarker`'s translation layer) go away.
- **Audit-log rotation.** `registration-*.json` / `finalize-*.json` currently accrete one file per
  operation forever; they move to the existing keep-N rotation pattern
  (`rotateSnapshots`). Independent hygiene fix, batched here.
- Canon files are already gone (ADR-0017). `merge-base.json`, `pending-*.json`, the probe cache,
  and userData files (`labels.json`, `config.json`, `auth.enc`, snapshots) are untouched — right
  seams already.

## Invariants respected

- Metadata-only wire manifest; content re-mirrored on import.
- Deterministic committed serialization — strengthened: volatile state now lives in a file that is
  never committed, killing the `fetchedAt`-churn bug _class_, not just the instance.
- No-vacuum (ADR-0018): every folder the walk sees gets a manifest row with a definite `url` in
  the same pass.
- Additive-by-default import; confirmed removals only.
- Crash-safe mutations: atomic rename on one runtime file is simpler than coordinating per-folder
  multi-file writes.
- Disk is the source of truth; no DB, no in-memory authority (ADR-0002's deepest premise, kept).

## Invariants broken — deliberately

- **ADR-0002's architecture** ("sidecars are the skill record") — superseded. Its lifecycle
  rationale survives in the runtime map's committed/volatile split.
- **Folder self-description.** A skill folder copied out of the registry by hand carries no
  provenance; a folder copied in gets classified at first index (ADR-0018). Accepted: a folder in
  transit is content, and the registry is where facts about it live.
- **Per-fact write atomicity** for volatile state becomes per-map atomicity — a concurrent-writer
  hazard only under multi-process mutation, which the single-main-process architecture precludes.

## Consequences

- `source.ts`'s read/write/parse surface (`readSkillSource`, `writeSkillSource`, `parseOrigin`,
  the tolerant legacy reads) shrinks to manifest-row accessors; `heal.ts`'s sidecar I/O
  (`readSyncedHash`/`writeSyncedHash`/`readRuntimeState`/`writeRuntimeState`) becomes the runtime
  map's single reader/writer pair.
- Existing registries carry legacy sidecars; the first index build under the new model absorbs
  them into the manifest + runtime map (one-shot read-through, same chokepoint discipline as
  manifest coercion), after which sidecars are ignored and may be cleaned opportunistically. Not
  standing migration machinery — a long-lived correctness invariant ("a folder without a row gets
  one") that happens to heal old data.
- Full call-site inventory is implementation-time work, tracked in the eventual feature-branch PR
  description.
