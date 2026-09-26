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
# --role-only excludes Supabase-managed roles by design, so it restores onto stock roles.
supabase db dump --linked --role-only -f "$out/baseline_roles.sql"
supabase db dump --linked -f "$out/baseline_schema.sql"
# Versions already recorded on production (the Remote column). A migration already applied there
# is not "pending", whatever this branch contains.
supabase migration list --linked > "$out/migration_list.txt" || true
awk -F'|' '{gsub(/[^0-9]/,"",$3); if (length($3)==14) print $3}' "$out/migration_list.txt" \
  | sort -u > "$out/recorded_versions.txt" || true
echo "Production has $(grep -c . "$out/recorded_versions.txt" || echo 0) recorded migration versions."
# Leave nothing linked behind: every later step in the calling job must reach only its own
# local database, never production, even by accident of a default.
supabase unlink >/dev/null 2>&1 || true
rm -rf supabase/.temp/project-ref supabase/.temp/pooler-url
