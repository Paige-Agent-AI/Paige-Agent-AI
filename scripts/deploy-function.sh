#!/usr/bin/env bash
# Deploy a Supabase edge function directly via the Management API.
#
# Why this exists: the Supabase CLI's HTTP client bypasses this environment's
# egress proxy (TransportError).
# curl honors the proxy and reads files straight from disk (exact bytes), so this
# is the reliable way to ship an edge function — including large multi-file ones.
#
# Usage:  SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/deploy-function.sh <function-slug> [--no-verify-jwt]
# Example: SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/deploy-function.sh paige-ai-chat
#
# It auto-discovers the function's transitive local (_shared) dependencies from
# its index.ts imports and uploads them all with correct relative paths.
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-xygzykjyynhzqytbqnzu}"
SLUG="${1:?usage: deploy-function.sh <slug> [--no-verify-jwt]}"
VERIFY_JWT=true
[[ "${2:-}" == "--no-verify-jwt" ]] && VERIFY_JWT=false

# Accept the management token under the canonical name OR common alternates — an
# operator may name the Claude Code env var differently (Supabase reserves the
# SUPABASE_ prefix for its own *function* secrets; the Claude Code env has no such
# rule, but people often carry the alt name over anyway). Get one at
# supabase.com/dashboard/account/tokens (starts with sbp_).
SUPABASE_ACCESS_TOKEN="${SUPABASE_ACCESS_TOKEN:-${SUPA_TOKEN:-${SUPABASE_TOKEN:-${SUPA_ACCESS_TOKEN:-${SB_ACCESS_TOKEN:-${SUPABASE_PAT:-}}}}}}"
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN (or SUPA_TOKEN) in the Claude Code environment — get one at supabase.com/dashboard/account/tokens}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

ENTRY="supabase/functions/${SLUG}/index.ts"
[[ -f "$ENTRY" ]] || { echo "no entrypoint at $ENTRY" >&2; exit 1; }

# Collect the entrypoint + its transitive relative deps (repo-relative paths).
# Uses Node (a hard dependency of this repo, so always present where this runs)
# rather than python3 — python3 is frequently absent on Windows, and because a
# process-substitution failure isn't caught by `set -e`, a missing interpreter
# would silently yield an EMPTY file list and deploy a zero-file function over
# production. Node is portable here and the walk output is byte-identical.
mapfile -t FILES < <(ENTRY="$ENTRY" node <<'JS'
const fs = require("fs"), path = require("path");
const seen = [];
function walk(p) {
  // POSIX-normalize: these strings become upload filenames for a Linux API and
  // MUST use forward slashes on every host OS. On Windows path.normalize()/join()
  // emit backslashes, which (a) fail the entrypoint guard below and (b) if they
  // slipped past, would upload "supabase\functions\..." names the Supabase API
  // can't match to metadata.entrypoint_path (declared with forward slashes).
  p = path.normalize(p).split(path.sep).join("/");
  if (seen.includes(p) || !fs.existsSync(p)) return;
  seen.push(p);
  const src = fs.readFileSync(p, "utf8");
  const re = /from\s+['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(src))) {
    const imp = m[1];
    if (imp.startsWith(".")) walk(path.join(path.dirname(p), imp));
  }
}
walk(process.env.ENTRY);
console.log(seen.join("\n"));
JS
)

# Drop any blank entries (a non-resolving entrypoint makes Node print an empty
# line, which mapfile would otherwise keep as a phantom element).
_CLEAN=(); for _f in "${FILES[@]}"; do [[ -n "$_f" ]] && _CLEAN+=("$_f"); done
FILES=("${_CLEAN[@]}")

# Never deploy an empty function. If the dependency walk produced nothing — a
# missing Node, an unreadable entrypoint, a moved file — abort loudly instead of
# shipping a zero-file (broken) deploy over a working production version.
if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "ERROR: dependency walk produced 0 files — refusing to deploy an empty function." >&2
  echo "  Check that Node is installed and on PATH, and that '$ENTRY' is readable." >&2
  exit 1
fi
if [[ "${FILES[0]}" != "$ENTRY" ]]; then
  echo "ERROR: entrypoint '$ENTRY' missing from the resolved file set — aborting." >&2
  exit 1
fi

echo "Deploying '${SLUG}' (${#FILES[@]} files, verify_jwt=${VERIFY_JWT}):"
FORM=(-F "metadata={\"entrypoint_path\":\"${ENTRY}\",\"name\":\"${SLUG}\",\"verify_jwt\":${VERIFY_JWT}};type=application/json")
for f in "${FILES[@]}"; do
  echo "  + $f"
  FORM+=(-F "file=@${f};filename=${f};type=application/typescript")
done

curl -sS -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${SLUG}" \
  -H "Authorization: Bearer ${SUPABASE_ACCESS_TOKEN}" \
  --max-time 240 "${FORM[@]}" \
  -w "\nHTTP_STATUS:%{http_code}\n"
