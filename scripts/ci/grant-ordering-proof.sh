#!/usr/bin/env bash
# Proves, against the real local stack, that reproducing production's grants never overwrites the
# change under review. Runs at the end of database-contract, after every proof has used the database.
#
# Two migrations production has not recorded are written at runtime (never committed):
#   - NEWER than anything production has, which creates a table, GRANTs it to authenticated, and
#     REVOKEs production's EXECUTE on is_tenant_admin(uuid);
#   - OLDER than production's newest recorded migration (out of order, as ten merged migrations were
#     between 2026-09-08 and 2026-09-26), which creates a table, GRANTs it, and REVOKEs production's
#     SELECT on clients.
# The job's own sequence (reproduce-production-grants.sh) then runs, and both migrations' GRANTs and
# REVOKEs must survive it.
#
# Negative control: the grant reconcile is then run on its own. Production knows nothing of the probe
# tables and does grant what the probes revoked, so the reconcile alone must erase both GRANTs and
# restore both REVOKEs. That proves production really holds what the probes revoke (the proof cannot
# pass vacuously) and that the sequence, not luck, is what kept the change under review intact.
set -euo pipefail
prod="${1:?usage: grant-ordering-proof.sh <prod-baseline-dir>}"
db=postgresql://postgres:postgres@127.0.0.1:54322/postgres
tool=scripts/ci/reproduce-production-grants.mjs

v="$(node "$tool" --reset-version --recorded "$prod/recorded_versions.txt" --aside-list /dev/null)"
# One version below V, as an integer: versions in this tree are not always real dates (hour 35,
# day 48), and date arithmetic rolled those forward, which made the "older" probe newer than V and
# the out-of-order path silently untested (§39 final read on #1487).
older="$(node -e 'process.stdout.write((BigInt(process.argv[1]) - 1n).toString().padStart(14, "0"))' "$v")"
if [[ ! "$older" < "$v" ]]; then echo "::error::out-of-order probe $older is not older than $v"; exit 1; fi
newer_probe=supabase/migrations/29991231235959_ci_grant_ordering_probe.sql
older_probe="supabase/migrations/${older}_ci_grant_ordering_probe_out_of_order.sql"
if ls supabase/migrations/"${older}"_* >/dev/null 2>&1; then echo "::error::probe version $older already exists"; exit 1; fi
trap 'rm -f "$newer_probe" "$older_probe"' EXIT

cat > "$newer_probe" <<'SQL'
CREATE TABLE public._ci_grant_ordering_probe (id int);
GRANT SELECT ON public._ci_grant_ordering_probe TO authenticated;
REVOKE EXECUTE ON FUNCTION public.is_tenant_admin(uuid) FROM PUBLIC, authenticated;
SQL
cat > "$older_probe" <<'SQL'
CREATE TABLE public._ci_grant_ordering_probe_older (id int);
GRANT SELECT ON public._ci_grant_ordering_probe_older TO authenticated;
REVOKE SELECT ON public.clients FROM authenticated;
SQL

q() { psql -X -A -t -v ON_ERROR_STOP=1 "$db" -c "$1"; }
expect() { # label, sql, expected
  local got; got="$(q "$2")"
  if [ "$got" = "$3" ]; then echo "  ok   $1"; else echo "::error::grant-ordering proof: $1 — expected $3, got $got"; exit 1; fi
}

out="$(scripts/ci/reproduce-production-grants.sh "$prod" 2>&1 | tee /dev/stderr)"
# The out-of-order probe must actually have taken the set-aside path, or this proof tests nothing new.
if ! grep -q "1 of them older than $v, set aside" <<<"$out"; then
  echo "::error::grant-ordering proof: the out-of-order probe was not set aside for the rebuild"; exit 1
fi

expect "the newer unrecorded migration's GRANT survives" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe','SELECT')" t
expect "the newer unrecorded migration's REVOKE survives" \
  "select has_function_privilege('authenticated','public.is_tenant_admin(uuid)','EXECUTE')" f
expect "the out-of-order ($older < $v) migration's GRANT survives" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe_older','SELECT')" t
expect "the out-of-order migration's REVOKE survives" \
  "select has_table_privilege('authenticated','public.clients','SELECT')" f

node "$tool" --dump "$prod/baseline_schema.sql" --db "$db" > /dev/null
expect "negative control: the reconcile alone erases the newer migration's GRANT" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe','SELECT')" f
expect "negative control: production grants what the newer migration REVOKEd" \
  "select has_function_privilege('authenticated','public.is_tenant_admin(uuid)','EXECUTE')" t
expect "negative control: the reconcile alone erases the out-of-order migration's GRANT" \
  "select has_table_privilege('authenticated','public._ci_grant_ordering_probe_older','SELECT')" f
expect "negative control: production grants what the out-of-order migration REVOKEd" \
  "select has_table_privilege('authenticated','public.clients','SELECT')" t
echo "grant-ordering proof: the change under review keeps its own grants and revokes, in order and out of order."
