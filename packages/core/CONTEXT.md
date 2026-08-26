# Core

The Store: the canonical skill collection, its Lock, and the writer that mutates them.

## Language

**Skill**:
A named capability in the Store, consisting of a SKILL.md entry point and optional supporting files.
_Avoid_: Plugin, extension, tool

**Store**:
The user's canonical skill collection: the Lock plus the skill folders at `~/.agents/skills`. Cursor reads it natively. Claude sees it through a Projection.
_Avoid_: Registry, Agent Directory, catalog, library, bank

**Lock**:
The v3 file at `~/.agents/.skill-lock.json`. The Store's record of which skills exist, their Origin, and content hashes.
_Avoid_: Manifest, registry-manifest, sidecar, Runtime Map

**Origin**:
A skill's remote provenance URL, stored on its Lock entry.
_Avoid_: Source (the old provenance-axis term), Manifest origin, upstream (kept only as a description of what an Origin URL points at)

**Add**:
Put a skill into the Store: copy its folder under `~/.agents/skills` and write its Lock entry. Replaces the skill if that name already exists. Does not Project. Fetch from a remote is a caller of Add, not Add itself.
_Avoid_: Install, Register, Import, Vendor

**Delete**:
Remove a skill from the Store: drop the Lock entry and the folder. Composes Unproject.
_Avoid_: Unregister, Uninstall, Remove

**Extract**:
Write a Store skill out to a standalone SKILL.md or zip.
_Avoid_: Export (retired with Manifest)

**Snapshot**:
A portable archive of the Store plus context sidecars: `store/` (Lock and skill folders), `desktop/` (Labels), `claude/` (Projection names). `cursor/` is absent until that context has named objects. Default packs every folder. A Lock entry may omit its folder (sparse); restore then Origin Pulls. The default transport is a user-held file. An optional Snapshot remote may also hold the file.
_Avoid_: Export, Manifest, three separate snapshot files

**Origin Probe**:
A check across Store skills' Origins for available content updates. Detects; never fetches or writes skill content.
_Avoid_: Rescan, Refresh, Check for updates (ambiguous with the app-release check)

**Origin Pull**:
Fetch new content from a skill's Origin, then Add (replace in the Store).
_Avoid_: Update (ambiguous outside UI copy), Sync, Refresh, Pull (unqualified)

**Skill Diagnostic**:
An on-disk problem with the Store: a Lock entry whose folder is missing, or a folder with no Lock entry.
_Avoid_: Needs attention (that's a UI section), Issue, Problem

**Snapshot remote**:
A GitHub repository Account may push and pull Snapshot files to. It is a shelf for archives, not the live Store. It is not Linked Repo.
_Avoid_: Linked Repo, git home, Manifest remote
