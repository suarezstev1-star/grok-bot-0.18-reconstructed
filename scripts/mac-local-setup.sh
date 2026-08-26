#!/usr/bin/env bash
#
# mac-local-setup.sh — one-shot local build & run for macOS on Apple Silicon.
#
# Hydrates the Git LFS installers, installs dependencies, bootstraps the
# checksum-pinned runtime, runs the checks, packages the app, and opens it.
#
# Usage:
#   bash scripts/mac-local-setup.sh            # full pipeline, then open the app
#   bash scripts/mac-local-setup.sh --no-open  # build only, do not launch
#   bash scripts/mac-local-setup.sh --no-package  # stop after `npm run check`
#
set -euo pipefail

OPEN_APP=1
DO_PACKAGE=1
for arg in "$@"; do
  case "$arg" in
    --no-open) OPEN_APP=0 ;;
    --no-package) DO_PACKAGE=0 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $arg" >&2; exit 2 ;;
  esac
done

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# --- Preflight -------------------------------------------------------------
step "Checking prerequisites"

case "$(uname -s)" in
  Darwin) ;;
  *) fail "Packaging is macOS-only. Run this on macOS (Apple Silicon)." ;;
esac

command -v node >/dev/null 2>&1 || fail "Node.js not found. Install Node 26.5.x (see .nvmrc)."
node_major_minor="$(node -p 'process.versions.node.split(".").slice(0,2).join(".")')"
if [ "$node_major_minor" != "26.5" ]; then
  echo "WARNING: Node $(node -v) detected; this project targets 26.5.x (see .nvmrc)."
  echo "         If you use nvm: 'nvm install 26.5.0 && nvm use'."
fi

command -v git >/dev/null 2>&1 || fail "git not found."
if ! git lfs version >/dev/null 2>&1; then
  fail "git-lfs not found. Install it: 'brew install git-lfs && git lfs install'."
fi

# --- Git LFS ---------------------------------------------------------------
step "Hydrating Git LFS installers"
git lfs install --local >/dev/null
git lfs pull
dmg="research-archives/original/0.18.0/macos-arm64/Grok_Bot_0.18.0.dmg"
if [ ! -f "$dmg" ] || [ "$(wc -c < "$dmg")" -lt 1000000 ]; then
  fail "The pinned DMG is still an LFS pointer. Check your LFS access, then re-run."
fi

# --- Build pipeline --------------------------------------------------------
step "Installing dependencies (npm ci)"
npm ci

step "Bootstrapping the checksum-pinned runtime (npm run bootstrap)"
npm run bootstrap

step "Running checks (npm run check)"
npm run check

if [ "$DO_PACKAGE" -eq 0 ]; then
  step "Done (checks only; --no-package)."
  exit 0
fi

step "Packaging the app (npm run package)"
npm run package

app="dist/Grok Bot 0.18 Reconstructed.app"
[ -d "$app" ] || fail "Packaging finished but $app was not found."

step "Build complete: $app"
if [ "$OPEN_APP" -eq 1 ]; then
  step "Launching the app"
  open "$app"
else
  echo "Skipping launch (--no-open). Start it with: open \"$app\""
fi
