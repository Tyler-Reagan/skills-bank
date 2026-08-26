# ADR-0025 — Origin persists only as Lock provenance fields

**Status:** Accepted (supersedes [ADR-0020](./ADR-0020-origin-is-a-nullable-url-manifest-v6.md))

Origin is the remote provenance URL. It persists only as the Lock's compatible v3 fields (`sourceUrl`, `sourceType`, `source`, `skillPath`, hash). Skills Bank does not keep a parallel Origin object. GitHub-capability stays a call-site check. There is no Bucket.

Every Store skill has an explicit stamp ([ADR-0018](./ADR-0018-origin-kind-narrowed-no-undefined-state.md)): a remote URL, or lock `sourceType: "local"` as the no-remote stamp. The `source` axis stays gone ([ADR-0019](./ADR-0019-source-removed-origin-is-sole-authority.md)). There is no self-origin: there is no git home to compare an Origin URL against ([ADR-0029](./ADR-0029-manifest-merge-retired.md)).
