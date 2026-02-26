#!/bin/sh
# Pre-launch guard: detect stale installed extension that would shadow F5 dev builds.
# Called by .vscode/launch.json preLaunchTask.

STALE_DIR="$HOME/.vscode/extensions/claude-dashboard.claude-agent-dashboard-"*

for dir in $STALE_DIR; do
  if [ -d "$dir" ]; then
    echo "ERROR: Stale installed extension found at $dir"
    echo "VS Code will load this instead of your local dev build."
    echo ""
    echo "Fix: rm -rf \"$dir\" then relaunch."
    exit 1
  fi
done

echo "No stale extension found. Good to go."
