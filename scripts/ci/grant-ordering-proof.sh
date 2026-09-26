#!/usr/bin/env bash
# Proves, against the real local stack, that reproducing production's grants never overwrites the
# change under review. Runs at the end of database-contract, after every proof has used the database.
#
# A migration production has not recorded is written at runtime (never committed) that creates a
# table, GRANTs it to authenticated, and REVOKEs a grant production holds. The job's own three steps
# then run — rebuild up to production's newest recorded version, reproduce production's grants,
# apply the unrecorded migrations — and the migration's grant and revoke must both survive.
#
# Negative control: the reconcile is then run again on its own. Production knows nothing of the
# probe table and does grant the revoked function, so the reconcile alone must erase the grant and
# restore the revoke. If it did not, this proof could not tell the fix from a no-op. That erasure is
# exactly what happened while pending migrations were detected by name (§39 review on #1487).
set -euo pipefail
db=postgresql://postgres:postgres@127.0.0.1:54322/postgres
prod="${1:?usage: grant-ordering-proof.sh <prod-baseline-dir>}"
probe=supabase/migrations/29991231235959_ci_grant_ordering_probe.sql
trap 'rm -f "$probe"' EXIT

cat > "$probe" <<'SQL'
CREATE TABLE public._ci_grant_ordering_probe (id int);
GRANT SELECT ON public._ci_grant_ordering_probe TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC, authenticated;
SQL

q() { psql -X -A -t -v ON_ERROR_STOP=1 "$db" -c "$1"; }
expect() { # label, sql, expected
  local got; got="$(q "$2")"
  if [ "$got" = "$3" ]; then echo "  ok   $1"; else echo "::error::grant-ordering proof: $1 — expected $3, got $got"; exit 1; fi
}

v="$(node scripts/ci/reproduce-production-grants.mjs --reset-version --recorded "$prod/recorded_versions.txt")"
supabase db reset --version "$v"
node scripts/ci/reproduce-production-grants.mjs --dump "$prod/baseline_schema.sql" --db "$db" > /dev/null
expect "production's grant on is_tenant_admin(uuid) is in place before the change" \
  "select has_function_privilege('authenticated','public.is_tenant_admin(uuid)','EXECUTE')" t
supabase migration up --include-all --local

expect "the unrecorded migration's GRANT survives" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe','SELECT')" t
expect "the unrecorded migration's REVOKE survives" \
  "select has_function_privilege('authenticated','public.is_tenant_admin(uuid)','EXECUTE')" f

node scripts/ci/reproduce-production-grants.mjs --dump "$prod/baseline_schema.sql" --db "$db" > /dev/null
expect "negative control: the reconcile alone erases the migration's GRANT" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe','SELECT')" f
expect "negative control: the reconcile alone restores what the migration REVOKEd" \
  "select has_function_privilege('authenticated','public.is_tenant_admin(uuid)','EXECUTE')" t
echo "grant-ordering proof: the change under review keeps its own grants and revokes."
