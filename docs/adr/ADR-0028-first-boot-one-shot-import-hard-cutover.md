# ADR-0028 — First-boot is a one-shot import then a hard cutover

**Status:** Accepted

On first boot after the inversion, import the pre-inversion registry through Add, then cut over. npx wins name collisions: skip Add when the Lock already has the name. Omit locals, missing, and unrepresentable skills: list them, and leave them in the backup. Rename the old registry tree to a sibling backup. Clear the old `linkedRepo` pointer. Unpackaged runs never write real `~/.agents`.

First-boot is a caller of Add, not a second writer. This does not re-seed curated content ([ADR-0017](./ADR-0017-curated-and-bundled-default-removed.md)). There is no post-cutover flow to stamp omitted local skills into the Lock.
