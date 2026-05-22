# CLI reference

The Skills Bank CLI is the scripting surface. Interactive flows — discover, heal, register, sync — live in the desktop app. The CLI covers five commands shaped for shell composition.

## Setup

```bash
# From the repo root
pnpm install
pnpm run build
```

Then invoke via:

```bash
node packages/cli/dist/index.js <command> [options]
```

Or alias it in your shell:

```bash
alias skills-bank="node /path/to/skills-bank/packages/cli/dist/index.js"
```

## Commands

### `list`

List all skills registered in the local registry.

```bash
skills-bank list [--json]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as a JSON array instead of a table |

**Example:**

```bash
# Human-readable table
skills-bank list

# Pipe into jq
skills-bank list --json | jq '.[].name'
```

---

### `installed`

Show which skills are currently linked into which agent directories.

```bash
skills-bank installed [--json]
```

| Flag | Description |
|------|-------------|
| `--json` | Output as JSON |

**Example:**

```bash
skills-bank installed --json | jq '.[] | select(.agent == "claude")'
```

---

### `install`

Link a registered skill into agent directories.

```bash
skills-bank install <name> [--agent <id>]
```

| Argument / Flag | Description |
|-----------------|-------------|
| `<name>` | Skill name (must be in the registry — run `list` to see options) |
| `--agent <id>` | Scope to a single agent directory (e.g. `claude`, `cursor`). Omit to broadcast to all existing dirs. |

**Examples:**

```bash
# Broadcast to all configured agents
skills-bank install frontend-design

# Install only into Claude Code
skills-bank install frontend-design --agent claude
```

---

### `uninstall`

Remove the symlink(s) for a skill from agent directories. Does not delete registry files.

```bash
skills-bank uninstall <name> [--agent <id>]
```

| Argument / Flag | Description |
|-----------------|-------------|
| `<name>` | Skill name |
| `--agent <id>` | Scope to a single agent. Omit to remove from all agents. |

---

### `path`

Print the absolute path to a skill's folder on disk. Useful for opening in an editor or using with `cd`.

```bash
skills-bank path <name>
```

**Examples:**

```bash
# Open the skill's SKILL.md in your editor
$EDITOR "$(skills-bank path frontend-design)/SKILL.md"

# cd into the skill folder
cd "$(skills-bank path frontend-design)"
```

---

## Removed commands

The following commands were removed in v1.6. They now print a one-line redirect and exit non-zero so scripts surface the change loudly:

| Old command | Replacement |
|-------------|-------------|
| `import` | Use **Account → Import a registry** in the desktop app |
| `export` | Use **Account → Export registry** in the desktop app |
| `finalize` | Use the Finalize flow in the desktop app |
| `sync-installed` | Use **Pull from `<repo>`** in the desktop app |

## Agent IDs

| ID | Agent |
|----|-------|
| `claude` | Claude Code (`~/.claude/skills/`) |
| `cursor` | Cursor (`~/.cursor/skills/`) |
| `gemini` | Gemini (`~/.gemini/skills/`) |
| `copilot` | GitHub Copilot (`~/.copilot/skills/`) |
| `continue` | Continue (`~/.continue/skills/`) |
| `cline` | Cline (`~/.cline/skills/`) |
| `codex` | OpenAI Codex (`~/.codex/skills/`) |
| `agents` | Shared (`~/.agents/skills/`) |
