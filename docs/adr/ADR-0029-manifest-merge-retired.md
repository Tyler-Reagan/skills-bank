# ADR-0029 — In-app Manifest merge is retired

**Status:** Accepted (supersedes [ADR-0009](./ADR-0009-multi-master-manifest-merge.md))

There is no git-synced Manifest. Do not resurrect in-app 3-way merge, a merge base, or a non-fast-forward push guard against `registry-manifest.json`.

There is no git home for the live Store. Store-level portability is one Snapshot archive ([ADR-0030](./ADR-0030-installation-snapshot-archive.md)). An optional Snapshot remote may hold that archive as a file ([ADR-0034](./ADR-0034-snapshot-remote.md)); it is not the live record. A skill with an Origin travels by Origin Pull. A skill with no Origin (`sourceType: "local"`) does not auto-sync across machines; it travels in a Snapshot or via Extract.
