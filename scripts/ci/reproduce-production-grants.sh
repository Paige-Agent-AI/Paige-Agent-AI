#!/usr/bin/env bash
# The whole sequence database-contract uses to give its rebuilt database production's API-role
# grants without overwriting the change under review. One home: the workflow step and
# grant-ordering-proof.sh both run exactly this.
#
#   1. Set aside every migration production has not recorded that is OLDER than V, the newest
#      migration production has recorded that this tree also has (else the rebuild applies it before
#      the grants are reproduced and it loses its own grants — §39 re-review on #1487).
#   2. Rebuild up to V: production's schema, as far as this tree knows it.
#   3. Reproduce production's object grants (reproduce-production-grants.mjs), and production's
#      default privileges for objects `postgres` creates in public (--defaults), so the change under
#      review's new objects start where they will on production.
#   4. Put the set-aside migrations back and apply every unrecorded one — the change under review —
#      exactly as written, as production's `db push --include-all` would.
#
# Usage: scripts/ci/reproduce-production-grants.sh <prod-baseline-dir>   (from prod-readonly-baseline.sh)
set -euo pipefail
prod="${1:?usage: reproduce-production-grants.sh <prod-baseline-dir>}"
db="${RECONCILE_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
tool=scripts/ci/reproduce-production-grants.mjs
aside="$(mktemp -d)"
list="$aside/list.txt"

v="$(node "$tool" --reset-version --recorded "$prod/recorded_versions.txt" --aside-list "$list")"

restore() {
  while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$aside/$f" ] && mv "$aside/$f" "supabase/migrations/$f"
  done < "$list"
}
trap restore EXIT
while IFS= read -r f; do
  [ -n "$f" ] && mv "supabase/migrations/$f" "$aside/$f"
done < "$list"

echo "::group::Rebuild up to production's newest recorded migration ($v)"
supabase db reset --version "$v"
echo "::endgroup::"

node "$tool" --dump "$prod/baseline_schema.sql" --db "$db"
node "$tool" --defaults --dump "$prod/baseline_schema.sql" --db "$db"

restore
trap - EXIT

echo "::group::Apply the migrations production has not recorded (the change under review)"
supabase migration up --include-all --local
echo "::endgroup::"
