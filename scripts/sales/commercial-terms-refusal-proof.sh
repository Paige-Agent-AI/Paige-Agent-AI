#!/usr/bin/env bash
# Commercial terms — proof that every refusal raises a code the surface can act on.
#
# WHY THIS EXISTS. `tenant_client_agreements` had zero rows in production and nobody could say why:
# 30 of the 38 refusals in the two writers were bare `RAISE EXCEPTION`, defaulting to P0001, which
# the surface maps to nothing and renders as "The save could not be confirmed." Coding them is only
# half a fix — a migration that merely *contains* the right text proves nothing about what a caller
# receives. This drives the real functions and asserts the SQLSTATE and the message that come back.
#
# It stands up a throwaway cluster, so it needs no credentials and touches no real database.
#
#   ./scripts/sales/commercial-terms-refusal-proof.sh
#
# WHAT IT DOES NOT PROVE (§13). The dependencies are STUBS — `is_tenant_admin` returns true and
# `current_user_tenant_id()` is fixed — so this proves the REFUSAL VOCABULARY, not tenant isolation
# or role enforcement. Those live in the full-schema pgTAP suite. A green run here means every
# refusal a caller can trip announces itself with a code; it does not mean the gates are correct.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  RUNNER="${PROOF_RUNNER_USER:-pgproof}"
  id "$RUNNER" >/dev/null 2>&1 || useradd -m "$RUNNER" >/dev/null 2>&1 || true
  [ "${PROOF_REEXEC:-}" = "1" ] && { echo "re-executed and still root — refusing to run postgres as root"; exit 2; }
  MIG_COPY=/var/tmp/commercial-terms-proof-migration.sql
  cp "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/migrations/20270532100000_commercial_terms_refusals_reach_the_operator.sql" "$MIG_COPY"
  chmod 644 "$MIG_COPY"
  SHARED_COPY=/var/tmp/commercial-terms-shared-writer.sql
  cp "$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/supabase/migrations/20270586000000_sales_shared_commercial_writer.sql" "$SHARED_COPY"
  chmod 644 "$SHARED_COPY"
  export PROOF_REEXEC=1
  exec su "$RUNNER" -s /bin/bash -c "PROOF_REEXEC=1 PGBIN='${PGBIN:-}' MIGRATION='$MIG_COPY' SHARED_MIGRATION='$SHARED_COPY' TMPDIR=/var/tmp $(printf '%q' "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")")"
fi

if [ -z "${PGBIN:-}" ]; then
  for c in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /opt/homebrew/opt/postgresql@*/bin; do [ -x "$c/initdb" ] && PGBIN="$c"; done
  : "${PGBIN:=$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")}"
fi
[ -x "$PGBIN/initdb" ] || { echo "FAIL — no PostgreSQL server binaries (PGBIN='$PGBIN'). Deliberately NOT skipped: a skipped proof reads exactly like a passing one."; exit 2; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATION="${MIGRATION:-$HERE/../../supabase/migrations/20270532100000_commercial_terms_refusals_reach_the_operator.sql}"
[ -f "$MIGRATION" ] || { echo "migration not found: $MIGRATION"; exit 2; }
WORK="$(mktemp -d -p "${TMPDIR:-/tmp}")"; PORT="${PGPORT:-55450}"
cleanup() { "$PGBIN/pg_ctl" -D "$WORK/d" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"$PGBIN/initdb" -D "$WORK/d" -U p --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/d" -o "-p $PORT -k $WORK" -l "$WORK/log" start >/dev/null
for _ in $(seq 1 20); do "$PGBIN/pg_isready" -h "$WORK" -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done
psql() { "$PGBIN/psql" -h "$WORK" -p "$PORT" -U p -d postgres "$@"; }

psql -q -v ON_ERROR_STOP=1 -f "$HERE/_stub-schema.sql" >/dev/null
psql -q -f "$MIGRATION" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the migration did not apply"; exit 1; }
SHARED_MIGRATION="${SHARED_MIGRATION:-$HERE/../../supabase/migrations/20270586000000_sales_shared_commercial_writer.sql}"
psql -q -v ON_ERROR_STOP=1 -f "$SHARED_MIGRATION" >/dev/null
psql -q -v ON_ERROR_STOP=1 -f "$SHARED_MIGRATION" >/dev/null

OUT="$WORK/out"
psql -q -f "$HERE/refusal-drive.sql" 2>&1 | grep -E '^(D[0-9]|---)' | tee "$OUT"

if grep -qE 'NO ERROR|UNEXPECTED' "$OUT"; then
  echo "FAIL — a refusal did not fire, or fired with the wrong code."; exit 1
fi
if ! grep -q 'D9 echoed value clamped to 40 = true' "$OUT"; then
  echo "FAIL — a rejected value is echoed back unbounded; the raise-site clamp is not holding."; exit 1
fi
# The floor moves with the suite. Eight driven refusals plus the clamp assertion today.
if [ "$(grep -c 'PASS' "$OUT")" -lt 8 ]; then
  echo "FAIL — fewer refusals ran than expected; the proof itself is broken."; exit 1
fi
echo "OK — every driven refusal announced itself with the code its class requires."
psql -q -v ON_ERROR_STOP=1 -f "$HERE/shared-commercial-writer-drive.sql"
