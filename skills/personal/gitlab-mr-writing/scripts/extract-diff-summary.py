#!/usr/bin/env python3
"""
extract-diff-summary.py

Produces a structured git diff summary from the current branch vs. a base branch.
Output is formatted markdown consumed by the gitlab-mr-writing skill.

Usage:
    python extract-diff-summary.py [--base origin/main] [--scope <path-prefix>]

Options:
    --base    Base ref to diff against (default: origin/main)
    --scope   Only show files under this path prefix (e.g. packages/viewer)
"""

import subprocess
import sys
import argparse
from collections import defaultdict
from pathlib import Path


def run(cmd: str) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True, shell=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr.strip()}", file=sys.stderr)
        sys.exit(1)
    return result.stdout.strip()


def short(sha: str) -> str:
    return sha[:7]


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract git diff summary for MR writing.")
    parser.add_argument("--base", default="origin/main", help="Base ref (default: origin/main)")
    parser.add_argument("--scope", default="", help="Limit output to files under this path prefix")
    args = parser.parse_args()

    merge_base = run(f"git merge-base {args.base} HEAD")
    head_sha = run("git rev-parse HEAD")
    range_str = f"{merge_base}..{head_sha}"

    # name-status: status<TAB>file (or status<TAB>old<TAB>new for renames)
    name_status_raw = run(f"git diff --name-status {range_str}")
    # numstat: added<TAB>deleted<TAB>file
    numstat_raw = run(f"git diff --numstat {range_str}")

    scope = args.scope.rstrip("/")

    def in_scope(path: str) -> bool:
        return path.startswith(scope) if scope else True

    # Parse name-status
    added: list[str] = []
    deleted: list[str] = []
    modified: list[str] = []
    renamed: list[tuple[str, str]] = []

    for line in name_status_raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        status = parts[0]
        if status == "A" and in_scope(parts[1]):
            added.append(parts[1])
        elif status == "D" and in_scope(parts[1]):
            deleted.append(parts[1])
        elif status == "M" and in_scope(parts[1]):
            modified.append(parts[1])
        elif status.startswith("R") and len(parts) == 3:
            old, new = parts[1], parts[2]
            if in_scope(new):
                renamed.append((old, new))

    # Parse numstat for per-file and per-directory stats
    file_stats: dict[str, tuple[int, int]] = {}
    for line in numstat_raw.splitlines():
        if not line.strip():
            continue
        parts = line.split("\t")
        if len(parts) == 3 and in_scope(parts[2]):
            try:
                ins = int(parts[0]) if parts[0] != "-" else 0
                dels = int(parts[1]) if parts[1] != "-" else 0
                file_stats[parts[2]] = (ins, dels)
            except ValueError:
                pass

    dir_stats: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    for filepath, (ins, dels) in file_stats.items():
        d = str(Path(filepath).parent)
        dir_stats[d][0] += ins
        dir_stats[d][1] += dels

    files_by_dir: dict[str, dict[str, list[str]]] = defaultdict(
        lambda: {"added": [], "modified": [], "deleted": [], "renamed": []}
    )
    for f in added:
        files_by_dir[str(Path(f).parent)]["added"].append(Path(f).name)
    for f in deleted:
        files_by_dir[str(Path(f).parent)]["deleted"].append(Path(f).name)
    for f in modified:
        files_by_dir[str(Path(f).parent)]["modified"].append(Path(f).name)
    for old, new in renamed:
        files_by_dir[str(Path(new).parent)]["renamed"].append(
            f"{Path(old).name} → {Path(new).name}"
        )

    total_ins = sum(v[0] for v in file_stats.values())
    total_dels = sum(v[1] for v in file_stats.values())
    total_files = len(added) + len(deleted) + len(modified) + len(renamed)

    # ── Output ──────────────────────────────────────────────────────────────

    print("## Git Diff Summary\n")
    print(f"**Base ref:** `{args.base}`")
    print(f"**Merge-base SHA:** `{merge_base}` (`{short(merge_base)}`)")
    print(f"**HEAD SHA:** `{head_sha}` (`{short(head_sha)}`)")
    print(f"**Range:** `{range_str}`")
    if scope:
        print(f"**Scope filter:** `{scope}/`")

    print(f"\n**Totals:** {total_files} files changed, +{total_ins} −{total_dels}")
    print(f"- Added: {len(added)}")
    print(f"- Modified: {len(modified)}")
    print(f"- Deleted: {len(deleted)}")
    if renamed:
        print(f"- Renamed: {len(renamed)}")

    print("\n## Files by Directory\n")
    print("*Sorted by total change volume (largest first)*\n")

    sorted_dirs = sorted(
        files_by_dir.keys(),
        key=lambda d: dir_stats[d][0] + dir_stats[d][1],
        reverse=True,
    )

    for d in sorted_dirs:
        group = files_by_dir[d]
        ins, dels = dir_stats.get(d, [0, 0])
        print(f"### `{d}/`  (+{ins} −{dels})")
        for f in sorted(group["added"]):
            print(f"  - `{f}` **[added]**")
        for f in sorted(group["modified"]):
            print(f"  - `{f}`")
        for f in sorted(group["deleted"]):
            print(f"  - `{f}` **[deleted]**")
        for f in sorted(group["renamed"]):
            print(f"  - `{f}` **[renamed]**")
        print()

    print("## Suggested Reviewer Header\n")
    print("```")
    print(f"**Baseline:** branch point with `main` (`merge-base({args.base}, HEAD)` = `{short(merge_base)}`)")
    print(f"**Range reviewed:** `{merge_base}..{head_sha}`")
    scope_label = scope if scope else "<package>/<subdirectory>"
    print(f"**Scope:** `{scope_label}/*`")
    print("```")


if __name__ == "__main__":
    main()
