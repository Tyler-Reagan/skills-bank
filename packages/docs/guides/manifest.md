# Move your registry

A **manifest** is a lightweight JSON snapshot of your registry's origin pointers — not the skill files themselves. Each entry carries the skill name, source axis, GitHub origin (repo + path), tags, and hidden/dismissed state. On import, each skill is re-fetched from its origin, so the transfer payload is tiny. Origins must still be reachable.

Two shapes in the **Move my registry** section of the Account modal:

| Shape        | What moves                    | Network on import                |
| ------------ | ----------------------------- | -------------------------------- |
| **Content**  | The full skills tree as files | None — files are copied directly |
| **Manifest** | Origin pointers only (JSON)   | Yes — each skill is re-fetched   |

Use Content when you want a self-contained backup or a direct folder-to-folder restore. Use Manifest when moving between machines that both have internet access, or to keep your registry state in your linked GitHub repo.

## Manifest via your linked repo

When a linked repo is configured, the manifest modal defaults to the **repo transport** — no file dialog.

### Export (push to repo)

1. Open **Account** → **Export manifest**.
2. The modal loads a diff preview against what's currently in your repo's `registry-manifest.json`:
   - **Added** — skills in your local registry not yet in the repo file.
   - **Removed** — skills in the repo file no longer in your local registry.
   - **Changed** — skills present in both but with differing origin, source, or tags.
   - **Unchanged** — identical in both.
3. Toggle **Open as pull request** if you want to review before merging. Off by default — the commit goes directly to your repo's default branch.
4. Click **Commit directly** or **Push as PR**.
5. On success the modal shows the short commit SHA and a **View on GitHub** link.

**Direct commit** writes to your linked repo's default branch in one step. **PR** routes the write to a stable `manifest/registry-manifest` branch and opens a pull request (or appends to an existing open one — it won't create duplicates).

### Import (read from repo)

1. Open **Account** → **Import manifest**.
2. The modal reads `registry-manifest.json` from your linked repo and shows the same diff preview — this time showing what would change in your **local** registry.
3. If the file doesn't exist yet you'll see a "No manifest in repo yet — push one first" message.
4. Click **Import from repo** to begin. Each skill is re-fetched from its origin; a progress indicator updates per-skill.
5. When import completes, a confirmation modal surfaces any skills that need to be installed into agent directories (the same flow as a regular manifest import).
6. Cancel is available during the import loop — already-mirrored skills remain on disk; remaining entries are skipped.

## Manifest via file (disk fallback)

When no linked repo is configured, or when you click **Use a file** in the modal toggle, the manifest modal falls back to the OS file dialog.

- **Export** — saves `registry-manifest.json` to a location you choose.
- **Import** — opens a file picker; select a previously exported manifest file.

The disk path is the same underlying flow; it just skips the diff preview and repo read/write steps.

## Content transport (disk only)

Content transfers always use a file dialog. In **Account → Move my registry → Content**:

- **Import from disk (replace)** — swap the active registry root for a different folder. Use when restoring from a `git clone` or switching to a completely different upstream.
- **Merge from disk** — additive import. Non-colliding skills are added; name collisions surface the same resolver as Pull (default: keep yours). Merged skills are marked `source: user`.
- **Export as folder** — saves the full `skills/` tree to a folder you choose.

## Rate limits

Manifest repo transport reads and writes via the GitHub Contents API and shares the same authenticated rate limit (5 000/hr when signed in, 60/hr unauthenticated). If you hit a limit, the modal shows the reset time inline. Sign in from **Account → Sign in with GitHub** to raise the limit.
