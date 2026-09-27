#!/usr/bin/env bash
# READ-ONLY baseline of production's database, for CI jobs that must compare against it.
#
# One home for the one way CI reads production (§18): premerge-migration-proof restores this
# baseline to prove new migrations apply on top of production, and the PAIGE Spine
# database-contract job reproduces production's API-role grants from it. Before this script, the
# steps lived inline in premerge-migration-proof.yml; a second copy would have been a second way
# in with its own credential handling.
#
# What it touches on production: `supabase db dump` (pg_dump — schema and roles only, never
# `--data-only`, so no rows or PII leave production) and `supabase migration list` (the ledger).
# Nothing is written to production.
#
# Usage: prod-readonly-baseline.sh <out-dir>
#   env: SUPABASE_ACCESS_TOKEN, SUPABASE_DB_PASSWORD (required), SUPABASE_PROJECT_ID (optional;
#        falls back to supabase/config.toml)
# Writes: <out-dir>/baseline_roles.sql, baseline_schema.sql, migration_list.txt,
#         recorded_versions.txt
set -euo pipefail
out="${1:?usage: prod-readonly-baseline.sh <out-dir>}"
mkdir -p "$out"
if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_DB_PASSWORD:-}" ]; then
  echo "::error::SUPABASE_ACCESS_TOKEN and SUPABASE_DB_PASSWORD are required for the read-only production baseline."
  exit 1
fi
ref="${SUPABASE_PROJECT_ID:-}"
if [ -z "$ref" ]; then
  ref="$(sed -n 's/^project_id = "\(.*\)"/\1/p' supabase/config.toml | head -1)"
fi
if [ -z "$ref" ]; then echo "::error::could not resolve the production project ref"; exit 1; fi
echo "Linking the production project (read-only usage: dump + migration list only)"
supabase link --project-ref "$ref"
# The ledger is read BEFORE the dump and again AFTER it. On a push to main, deploy-migrations may
# apply a migration while this runs; if the two reads differ, production changed mid-read and the
# baseline is taken again (once), rather than pairing a ledger with a dump from a different moment.
read_ledger() {
  supabase migration list --linked > "$1" || true
  # Read by the table's "Remote" header (or the JSON form), never by column number: in CI the CLI
  # prints the table without a leading pipe, and a positional read took the Time column, so every
  # local-only migration counted as recorded (measured with CLI 2.109.1, CI=true).
  node scripts/ci/reproduce-production-grants.mjs --parse-ledger "$1"
}
for attempt in 1 2; do
  read_ledger "$out/migration_list.txt" > "$out/recorded_versions.txt"
  if [ ! -s "$out/recorded_versions.txt" ]; then
    echo "::error::production's migration ledger could not be read (supabase migration list returned no recorded versions)."
    exit 1
  fi
  # --role-only excludes Supabase-managed roles by design, so it restores onto stock roles.
  supabase db dump --linked --role-only -f "$out/baseline_roles.sql"
  supabase db dump --linked -f "$out/baseline_schema.sql"
  if read_ledger "$out/migration_list_after.txt" | cmp -s - "$out/recorded_versions.txt"; then break; fi
  if [ "$attempt" = 2 ]; then
    echo "::error::production's migration ledger changed while the baseline was being read, twice (a deploy is in progress). Re-run once it finishes."
    exit 1
  fi
  echo "::warning::production's migration ledger changed while the baseline was being read; reading it again."
done
echo "Production has $(grep -c . "$out/recorded_versions.txt" || echo 0) recorded migration versions."
# Leave nothing linked behind: every later step in the calling job must reach only its own local
# database, never production, even by accident of a default.
supabase unlink >/dev/null 2>&1 || true
rm -rf supabase/.temp
if [ -e supabase/.temp/project-ref ]; then echo "::error::production link state survived unlink"; exit 1; fi
