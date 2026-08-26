# ADR-0034 — Snapshot remote is a shelf, not a git home

**Status:** Accepted

Account keeps GitHub identity, Snapshot save/open, and an optional **Snapshot remote**: a GitHub repo that can hold Snapshot files. Reuse Device Flow, the repo picker, and writing a file to a repo. Do not resurrect live Registry sync, three-way Manifest merge, “Import from linked repo,” Origin-vs-repo comparison, or the name Linked Repo.

The user-held file remains the default Snapshot transport ([ADR-0030](./ADR-0030-installation-snapshot-archive.md)). A Snapshot remote is not a git home for the Store ([ADR-0029](./ADR-0029-manifest-merge-retired.md)).
