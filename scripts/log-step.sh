#!/usr/bin/env bash
# Prepend a build-log entry from stdin, keeping the header/NEXT UP block intact.
# Usage:  ./scripts/log-step.sh "Step 4: Search page" < entry-body.md
set -euo pipefail
TITLE="$1"
LOG="docs/BUILD_LOG.md"
BODY=$(cat)
ANCHOR=$(grep -n '^## 20' "$LOG" | head -1 | cut -d: -f1)
{
  head -n $((ANCHOR - 1)) "$LOG"
  printf '## %s — %s\n\n%s\n\n---\n\n' "$(date +%Y-%m-%d)" "$TITLE" "$BODY"
  tail -n +"$ANCHOR" "$LOG"
} > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
echo "Logged: $TITLE"
