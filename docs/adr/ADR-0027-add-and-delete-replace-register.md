# ADR-0027 — Add and Delete replace Register

**Status:** Accepted (supersedes [ADR-0022](./ADR-0022-registry-is-adopted-only.md))

Register is dead. Add copies a folder into the Store and writes the Lock entry; a name that already exists is replaced. Delete drops the Lock entry and the folder, and composes Unproject. A skill is in the Store if and only if it has a folder under `~/.agents/skills` and a Lock entry.

In-place tracking and custom dirs stay gone. Delete does not move files out to an agent directory: the Store is `~/.agents/skills`.
