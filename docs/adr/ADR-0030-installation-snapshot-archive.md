# ADR-0030 — One Snapshot archive; full content default; sparse schema

**Status:** Accepted

Portability is one Snapshot archive, not three documents and not a live git home ([ADR-0029](./ADR-0029-manifest-merge-retired.md)). The default transport is a user-held file. An optional Snapshot remote may also hold the file ([ADR-0034](./ADR-0034-snapshot-remote.md)). The archive is hierarchical by context:

```
store/                 # Lock + skills/<name>/
  .skill-lock.json
  skills/<name>/
desktop/
  labels.json
claude/
  projections.json     # names that are Projected
```

`cursor/` is omitted until that context has named objects. Plugin state is not in the archive. Handmade `~/.cursor/skills` folders stay out of the Store and out of the Snapshot.

The writer packs every skill folder by default. The schema allows a Lock entry with no packed folder. Restore of a missing folder is Origin Pull. A missing folder with no Origin cannot restore; list it. A packed folder restores through Add (replace if the name exists). Labels restore into `labels.json`, not into the Lock. Projection names restore as Projections after the Store is in place.
