# Claude

Claude Code as a harness. Skills Bank Projects Store skills into Claude's skill path. This context also owns Claude-only objects. Plugin is one that already exists in the product. Focused handling of Plugin and other Claude-only objects waits until the claude package is built. The desktop Metrics view consumes Hook, Invocation, and Tracking; it does not own them.

## Language

**Projection**:
A directory symlink at `~/.claude/skills/<name>` pointing at that skill's Store folder. The remaining harness write. Cursor does not receive one.
_Avoid_: Agent Directory, Install, agent folder

**Unproject**:
Projection's inverse: remove the Claude directory symlink. Delete composes it. This glossary does not include a "hide from Claude, keep in the Store" toggle.
_Avoid_: Uninstall, Unregister, Remove

**Conflict**:
Something other than our Projection already occupies `~/.claude/skills/<name>`.
_Avoid_: Duplicate, Collision, Installation kind (retired four-way taxonomy)

**Skill Diagnostic**:
An on-disk problem with a Projection: the symlink is missing or dangling. Distinct from Conflict, which is an occupied path.
_Avoid_: Needs attention (that's a UI section), Issue, Problem

**Invocation**:
One recorded use of a skill — either model-invoked (`PreToolUse`, tool `Skill`) or a user `/slash` command (`UserPromptExpansion`).
_Avoid_: Usage event, Call

**Tracking**:
Whether skill usage is currently being recorded, and the history of when it has been on or off.
_Avoid_: Metrics (that's the tab showing Invocation stats, not the on/off state itself), Uptime, Coverage

**Hook**:
Claude Code's extensibility mechanism. Skills Bank installs one entry under `PreToolUse` and `UserPromptExpansion` so Invocations are logged. "Installed" means our entry is present under any tracked event, not necessarily both.
_Avoid_: Tracking (the state Hook backs)

**Plugin**:
A Claude Code plugin. It is not a Skill. Skills Bank may show skills a Plugin ships on the Agents tab. Skills Bank never writes plugin state.
_Avoid_: Skill, extension
