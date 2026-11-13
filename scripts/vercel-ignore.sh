#!/usr/bin/env bash
# ANT-165 — Vercel Ignored Build Step.
# Exit 0 = build CANCELED (skip); exit 1 = build continues. (Vercel's documented
# contract — the polarity is the opposite of what the messages suggest; do not
# "fix" it.) Only 0/1 are ever returned; anything else is a Vercel ERROR state.
#
# Skip when every changed file vs the previously deployed commit is
# documentation (docs/**, *.md, *.mdx, .zcode/**) — an empty diff (a same-SHA
# redeploy) also skips, which suppresses the duplicate-redeploy waste.
# Anything else builds. public/ always builds (served assets live there).
# Unknown state (no/unreachable VERCEL_GIT_PREVIOUS_SHA) fails OPEN to building.

set -u

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$PREV" ] || ! git cat-file -e "$PREV" 2>/dev/null; then
  echo "vercel-ignore: no reachable previous commit — building."
  exit 1
fi

CHANGED="$(git diff --name-only "$PREV" HEAD 2>/dev/null || true)"
if [ -z "$CHANGED" ]; then
  echo "vercel-ignore: empty diff (same-SHA redeploy) — skipping build."
  exit 0
fi

if printf '%s\n' "$CHANGED" | grep -q '^public/'; then
  echo "vercel-ignore: public/ assets changed — building."
  exit 1
fi

NON_DOC="$(printf '%s\n' "$CHANGED" | grep -vEv '^(docs/|\.zcode/)' | grep -vE '\.(md|mdx)$' || true)"
if [ -n "$NON_DOC" ]; then
  echo "vercel-ignore: application-affecting files present — building."
  exit 1
fi

echo "vercel-ignore: documentation-only change — skipping build."
exit 0
