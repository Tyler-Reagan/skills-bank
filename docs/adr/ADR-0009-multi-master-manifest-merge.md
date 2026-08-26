# ADR-0009 — Multi-master registry sync via in-app 3-way manifest merge

**Status:** Superseded by [ADR-0029](./ADR-0029-manifest-merge-retired.md) — there is no git-synced Manifest to merge.

## Context

The `registry-manifest.json` in a linked repo is written by more than
one machine (the maintainer runs the bank on multiple hosts pointed at
the same `Tyler-Reagan/skills` repo). Before this change the manifest
was treated as a write-once snapshot, which corrupted in three ways
observed in a real PR (#11) where machine B's push silently "deleted"
every skill only machine A had:

1. **Snapshot export clobber.** `exportRegistryManifest` rebuilds the
   whole manifest from the local index, so a push from B reads to git
   as "removed every skill B doesn't have."
2. **Additive-only import.** Pull never removed a skill dropped from the
   manifest, so deliberate deletions never propagated.
3. **Non-canonical serialization + frontmatter corruption.**
   `exportedAt` churned every export; the hand-rolled frontmatter parser
   mangled YAML block scalars and quote-escaping.

The deviation was not version skew — both machines ran the same build.
The manifest needed to behave like git-versioned state that preserves
intentional divergence, **without** decomposing into per-skill files and
**without** a git merge driver (the conflict UX should live in the app).

## Decision

Treat the committed manifest as mergeable state reconciled **in-app** on
pull.

1. **Canonical committed form.** `serializeManifest` writes a sorted,
   stable-key, trailing-newline JSON that drops the volatile/local fields
   `exportedAt` and `lastInstalledOn`. A no-op re-push then produces no
   diff. The full-fidelity form (with those fields) survives only in the
   disk export and rolling snapshots. Schema bumped to **v4**;
   `coerceManifestToCurrent` folds v2/v3/v4 through one normalize.

2. **Three-way merge on pull.** `mergeManifests(base, ours, theirs)`
   where `ours` = local export, `theirs` = the repo's committed manifest,
   `base` = the **merge base**. An absent entry is itself a value, so
   deletions reconcile like edits. "Same skill" is decided by
   `skillSignature` — the exact field set `diffManifests` compares — so
   the merge and the diff preview never disagree. The engine is pure (no
   I/O, no clock), making it fully table-testable.

3. **Merge base = per-machine remote-tracking reference.** Not a shared
   file. Stored canonically in the local state dir, advanced to the
   remote's content after every successful sync (to `theirs` after a
   pull-merge, to the pushed manifest after a push). `null` before the
   first sync → treated as empty (everything reads as added). This is the
   approximation that lets a graphless system distinguish "we changed
   this" from "they changed this."

4. **Conflicts through the existing resolver UX.** Genuine divergence
   (`both-modified` / `both-added` / edit-vs-delete) surfaces in
   `ManifestConflictModal` — a metadata sibling of the sync-collision
   `ConflictResolutionModal`, reusing the shared building blocks. Arms:
   `keep-mine` / `use-theirs` / `keep-both` (fork local to `<name>-local`).
   Pending conflicts persist to `pending-manifest-conflicts.json`.

5. **Reconcile = import + confirmed removal.** A clean or resolved merge
   reconciles the local registry via `importRegistryManifest` for
   adds/restores, plus an opt-in `removeNames` arm for deletions. The
   removal set is `localNames − finalManifestNames`, covering both
   conflict-confirmed and auto-resolved deletions. The broad import paths
   (disk import, account restore) stay strictly additive.

6. **Non-fast-forward push guard.** A direct push refuses when the
   remote's committed manifest no longer equals the merge base — the repo
   changed since this machine last synced (or we've never synced a repo
   that already has a manifest). The user must pull-merge first. This is
   the direct fix for the originating clobber bug.

## Alternatives rejected

- **Single-writer discipline** — kills multi-master; the whole point is
  more than one machine writes the repo.
- **Per-skill file decomposition** — file proliferation; the manifest is
  deliberately a single high-level declarative artifact.
- **A git merge driver** — moves conflict resolution out of the app into
  git tooling the packaged Electron app can't assume is on `$PATH`
  (ADR-0003), and off the in-app resolver UX users already know.

## Consequences

- Committed manifests are diff-stable; multi-master pushes no longer
  clobber. The push guard makes the failure mode (diverged remote) an
  explicit, recoverable error instead of silent data loss.
- The merge base is per-machine state — a fresh checkout (or a machine
  that has never synced) starts from an empty base, so its first pull
  reads the entire remote as additions and merges to the union. This is
  intentional and is how a clobbered repo is recovered (see the
  resolution playbook in the v1.17.0 PR).
- Skill **content** is still re-fetched from each skill's origin on
  import; the manifest remains metadata-only. A user-authored skill that
  exists only locally with no origin cannot be reconstructed by a peer
  from the manifest alone — its content must reach the repo as committed
  folders.
- `serializeManifest` is wired into the linked-repo push path only. The
  manual disk export stays full-fidelity (it is a portable backup that
  wants `exportedAt` + `lastInstalledOn` for re-import hints).
