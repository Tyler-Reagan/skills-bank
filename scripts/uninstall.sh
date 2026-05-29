#!/usr/bin/env bash
#
# Skills Bank uninstaller (macOS).
#
# Removes the desktop app and everything it created: the app bundle, the
# app-managed registry + userData, logs/caches/preferences, the dev-mode
# redirect dir, and — importantly — only the agent-directory symlinks that
# point INTO the Skills Bank registry. Your own skills (real directories, or
# symlinks pointing elsewhere) are never touched.
#
# Usage:
#   ./scripts/uninstall.sh            # show the plan, then prompt before removing
#   ./scripts/uninstall.sh --dry-run  # show the plan and exit, change nothing
#   ./scripts/uninstall.sh --keep-data  # remove app + caches + symlinks, KEEP the registry/userData
#   ./scripts/uninstall.sh --yes      # skip the confirmation prompt (for scripting)
#
# Flags can be combined, e.g. `--dry-run --keep-data`.

set -euo pipefail

DRY_RUN=0
ASSUME_YES=0
KEEP_DATA=0

for arg in "$@"; do
  case "$arg" in
    -n | --dry-run) DRY_RUN=1 ;;
    -y | --yes) ASSUME_YES=1 ;;
    --keep-data) KEEP_DATA=1 ;;
    -h | --help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

APPSUP="$HOME/Library/Application Support"

# userData candidates — the registry lives at <dir>/registry. The packaged
# app currently resolves userData to "@skills-bank/desktop"; "Skills Bank"
# and "Skills Bank (Dev)" are covered too in case a build resolves the
# productName- or dev-name-based path.
USERDATA_DIRS=(
  "$APPSUP/@skills-bank/desktop"
  "$APPSUP/Skills Bank"
  "$APPSUP/Skills Bank (Dev)"
)
DEV_DIR="$HOME/.skills-bank-dev" # SKILLS_BANK_HOME_OVERRIDE dev redirect

# Registry roots used to identify our symlinks. The dev dir holds both the
# dev registry and the redirected agent skill sinks.
REGISTRY_PREFIXES=()
for d in "${USERDATA_DIRS[@]}"; do REGISTRY_PREFIXES+=("$d/registry"); done
REGISTRY_PREFIXES+=("$DEV_DIR")

AGENT_DIRS=(
  "$HOME/.claude/skills"
  "$HOME/.cursor/skills"
  "$HOME/.gemini/skills"
  "$HOME/.copilot/skills"
  "$HOME/.continue/skills"
  "$HOME/.cline/skills"
  "$HOME/.codex/skills"
  "$HOME/.agents/skills"
)

APP_BUNDLE="/Applications/Skills Bank.app"

# appId = com.tyler-reagan.skills-bank
SUPPORT_PATHS=(
  "$HOME/Library/Logs/Skills Bank"
  "$HOME/Library/Caches/com.tyler-reagan.skills-bank"
  "$HOME/Library/Caches/com.tyler-reagan.skills-bank.ShipIt"
  "$HOME/Library/Caches/@skills-bankdesktop-updater"
  "$HOME/Library/Preferences/com.tyler-reagan.skills-bank.plist"
  "$HOME/Library/Saved Application State/com.tyler-reagan.skills-bank.savedState"
  "$HOME/Library/HTTPStorages/com.tyler-reagan.skills-bank"
)

# --- collect the symlinks that point into a Skills Bank registry ----------
OUR_LINKS=()
for adir in "${AGENT_DIRS[@]}"; do
  [ -d "$adir" ] || continue
  while IFS= read -r link; do
    [ -n "$link" ] || continue
    target="$(readlink "$link" || true)"
    for prefix in "${REGISTRY_PREFIXES[@]}"; do
      case "$target" in
        "$prefix"/*)
          OUR_LINKS+=("$link")
          break
          ;;
      esac
    done
  done < <(find "$adir" -maxdepth 1 -type l 2>/dev/null)
done

# --- build the removal plan -----------------------------------------------
DATA_PATHS=()
if [ "$KEEP_DATA" -eq 0 ]; then
  for d in "${USERDATA_DIRS[@]}"; do [ -e "$d" ] && DATA_PATHS+=("$d"); done
  [ -e "$DEV_DIR" ] && DATA_PATHS+=("$DEV_DIR")
fi

REMOVE_PATHS=()
[ -e "$APP_BUNDLE" ] && REMOVE_PATHS+=("$APP_BUNDLE")
for p in "${SUPPORT_PATHS[@]}"; do [ -e "$p" ] && REMOVE_PATHS+=("$p"); done
for p in ${DATA_PATHS[@]+"${DATA_PATHS[@]}"}; do REMOVE_PATHS+=("$p"); done

echo "Skills Bank uninstaller"
echo "========================"
echo
if [ "${#OUR_LINKS[@]}" -gt 0 ]; then
  echo "Agent-dir symlinks to remove (point into the registry):"
  for l in "${OUR_LINKS[@]}"; do echo "  unlink  $l"; done
else
  echo "Agent-dir symlinks to remove: none found."
fi
echo
if [ "${#REMOVE_PATHS[@]}" -gt 0 ]; then
  echo "Paths to remove:"
  for p in "${REMOVE_PATHS[@]}"; do echo "  rm -rf  $p"; done
else
  echo "Paths to remove: none found."
fi
echo
if [ "$KEEP_DATA" -eq 1 ]; then
  echo "--keep-data: your registry / userData is PRESERVED."
  echo "Note: symlinks above will become valid again only if you reinstall; otherwise remove them."
else
  echo "WARNING: this deletes the app-managed registry (your bank's skills and their"
  echo "content). If your registry isn't pushed to a linked GitHub repo, that data is gone."
fi
echo

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry run — nothing was changed)"
  exit 0
fi

if [ "${#OUR_LINKS[@]}" -eq 0 ] && [ "${#REMOVE_PATHS[@]}" -eq 0 ]; then
  echo "Nothing to do."
  exit 0
fi

if [ "$ASSUME_YES" -eq 0 ]; then
  printf "Proceed? [y/N] "
  read -r reply
  case "$reply" in
    y | Y | yes | YES) ;;
    *)
      echo "Aborted."
      exit 1
      ;;
  esac
fi

# Best-effort: quit the app if it's running, so deletion isn't racing it.
osascript -e 'tell application "Skills Bank" to quit' >/dev/null 2>&1 || true

for l in ${OUR_LINKS[@]+"${OUR_LINKS[@]}"}; do
  rm -f "$l" && echo "unlinked $l"
done
for p in ${REMOVE_PATHS[@]+"${REMOVE_PATHS[@]}"}; do
  rm -rf "$p" && echo "removed  $p"
done
# Tidy the now-empty @skills-bank namespace dir if we emptied it.
[ "$KEEP_DATA" -eq 0 ] && rmdir "$APPSUP/@skills-bank" 2>/dev/null || true

echo
echo "Done. Skills Bank has been uninstalled."
if [ "$KEEP_DATA" -eq 1 ]; then
  echo "Your registry/userData was kept."
fi
