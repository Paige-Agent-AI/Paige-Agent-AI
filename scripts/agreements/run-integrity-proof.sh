#!/usr/bin/env bash
# INT-163 — executable proof that the agreements engine's integrity guarantees are real.
#
# WHY THIS EXISTS. Every immutability claim in `20270401000000_agreements_engine_records.sql` — the
# one-way status machine, the freeze at send, the write-once seal, the append-only audit trail, the
# cross-tenant refusal — is enforced by a TRIGGER, because RLS does not bind `service_role` and the
# real writers are service-role edge functions. A trigger that is believed to fire and does not is
# indistinguishable, in the schema, from one that works. So this drives each guarantee and asserts
# the exact SQLSTATE, and it drives POSITIVE controls too: negatives that pass because the statement
# was malformed prove nothing at all.
#
# It stands up its own throwaway cluster, so it needs no credentials and touches no real database.
#
#   ./scripts/agreements/run-integrity-proof.sh
#
# Exit 0 means every negative was refused with the expected code and every positive succeeded.
#
# WHAT IT DOES NOT PROVE (§13). The fixture schema is a stand-in for the real `clients` /
# `tenant_products` / auth-helper surface, and it is NOT production. One property is deliberately
# NOT reproduced and was previously mis-stated here: the cluster is created with
# `initdb -U proofrunner`, so these tables are owned by the BOOTSTRAP SUPERUSER, not by a
# non-superuser role as on Supabase. What the service-role section does prove is the part that
# matters for the trigger guarantees — `service_role` BYPASSRLS, is not a superuser, and is not a
# member of the owning role, so it cannot disable a trigger or set session_replication_role.
# Confirming the same behaviour on prod is a separate §32 step for a session with database access.
set -euo pipefail

# Postgres refuses to run as root. Containers and CI images frequently ARE root, so rather than
# failing with a hint nobody can act on, drop to an unprivileged user and re-exec once.
if [ "$(id -u)" -eq 0 ]; then
  RUNNER="${PROOF_RUNNER_USER:-pgproof}"
  id "$RUNNER" >/dev/null 2>&1 || useradd -m "$RUNNER" >/dev/null 2>&1 || true
  if [ "${PROOF_REEXEC:-}" = "1" ]; then
    echo "already re-executed and still root — refusing to run postgres as root"; exit 2
  fi
  export PROOF_REEXEC=1
  exec su "$RUNNER" -c "PROOF_REEXEC=1 PGBIN='${PGBIN:-}' TMPDIR=/var/tmp $(printf '%q' "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")")"
fi

# Find the server binaries. GitHub runners ship PostgreSQL but the major version moves, so the
# version is discovered rather than pinned; PGBIN overrides everything.
if [ -z "${PGBIN:-}" ]; then
  for candidate in /usr/lib/postgresql/*/bin /usr/pgsql-*/bin /opt/homebrew/opt/postgresql@*/bin; do
    [ -x "$candidate/initdb" ] && PGBIN="$candidate"
  done
  : "${PGBIN:=$(dirname "$(command -v initdb 2>/dev/null || echo /nonexistent/x)")}"
fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MIGRATION="$REPO/supabase/migrations/20270401000000_agreements_engine_records.sql"
MIGRATION2="$REPO/supabase/migrations/20270402000000_agreements_read_and_expiry.sql"
MIGRATION4="$REPO/supabase/migrations/20270404000000_agreement_signing_contract.sql"
MIGRATION5="$REPO/supabase/migrations/20270405000000_agreement_signer_seam.sql"
MIGRATION6="$REPO/supabase/migrations/20270407000000_agreement_view_tracking.sql"
MIGRATION7="$REPO/supabase/migrations/20270532110000_agreement_link_provenance.sql"
WORK="$(mktemp -d)"
PORT="${PGPORT:-55432}"

cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

[ -x "$PGBIN/initdb" ] || {
  echo "FAIL — no PostgreSQL server binaries found (looked for initdb; PGBIN='$PGBIN')."
  echo "This proof is the only thing asserting the engine's integrity triggers actually fire."
  echo "Install postgresql or set PGBIN. It is deliberately NOT skipped: a silently skipped"
  echo "integrity proof reads exactly like a passing one."
  exit 2
}
[ -f "$MIGRATION" ] || { echo "migration not found: $MIGRATION"; exit 2; }

"$PGBIN/initdb" -D "$WORK/data" -U proofrunner --auth=trust >/dev/null
"$PGBIN/pg_ctl" -D "$WORK/data" -l "$WORK/server.log" -o "-p $PORT -k $WORK" start >/dev/null
for _ in $(seq 1 20); do "$PGBIN/pg_isready" -h "$WORK" -p "$PORT" >/dev/null 2>&1 && break; sleep 0.5; done

psql() { "$PGBIN/psql" -h "$WORK" -p "$PORT" -U proofrunner -d proof "$@"; }
"$PGBIN/psql" -h "$WORK" -p "$PORT" -U proofrunner -d postgres -q -c 'CREATE DATABASE proof' >/dev/null

psql -v ON_ERROR_STOP=1 -q -f "$HERE/_fixture-schema.sql" >/dev/null
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION" >/dev/null 2>&1
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION2" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the read/expiry migration did not apply"; exit 1; }
# The agreements chat tools ship Spine-registered (agreement.send as an external_effect on
# public.issue_agreement_signing_link) and their autonomy-catalogue toggles arrive in
# 20270532120000, re-emitted from the catalogue body current at this PR's base.
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION4" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the signing-contract migration did not apply"; exit 1; }
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION5" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the signer-seam migration did not apply"; exit 1; }
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION6" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the view-tracking migration did not apply"; exit 1; }
# The counterparty trigger function as production runs it NOW, not as 20270405000000 first wrote
# it: 20270519010000 moved it onto contact methods. Taken from the newest migration that defines
# it, so a later restatement is exercised here without editing this runner.
SEED_SRC="$(grep -l "FUNCTION public.seed_agreement_counterparty()" "$REPO"/supabase/migrations/*.sql | sort | tail -1)"
awk '/^CREATE OR REPLACE FUNCTION public\.seed_agreement_counterparty\(\)/{p=1} p{print} p&&/^\$(function)?\$;/{exit}' "$SEED_SRC" > "$WORK/seed_counterparty.sql"
grep -q '^\$\(function\)\?\$;' "$WORK/seed_counterparty.sql" || { echo "FAIL — could not read seed_agreement_counterparty from $SEED_SRC"; exit 1; }
psql -v ON_ERROR_STOP=1 -q -f "$WORK/seed_counterparty.sql" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the current counterparty trigger function did not apply"; exit 1; }
psql -v ON_ERROR_STOP=1 -q -f "$MIGRATION7" 2>&1 | grep -iE "^psql.*error" && { echo "FAIL — the link-provenance migration did not apply"; exit 1; }
echo "migrations 20270401/02/04/05/07/11 applied to a clean database, counterparty trigger from $(basename "$SEED_SRC")"
echo

OUT="$WORK/out.txt"
psql -v ON_ERROR_STOP=1 -q -f "$HERE/integrity-proof.sql"     2>&1 | grep -E '^(P[0-9]|C[0-9]|---)' | tee "$OUT"
echo
psql -v ON_ERROR_STOP=1 -q -f "$HERE/service-role-proof.sql"  2>&1 | grep -E '^(table|service_role|acting|S[0-9])' | tee -a "$OUT"
echo
# psql prefixes a NOTICE with "<file>:<line>: NOTICE:  ", so strip anything before the marker
# rather than anchoring at the start of the line.
psql -v ON_ERROR_STOP=1 -q -f "$HERE/read-and-expiry-proof.sql" 2>&1 | sed -E 's/^.*NOTICE:  //' | grep -E '^(E[0-9]|---)' | tee -a "$OUT"
echo
psql -v ON_ERROR_STOP=1 -q -f "$HERE/contract-proof.sql" 2>&1 | sed -E 's/^.*NOTICE:  //' | grep -E '^(K[0-9]|---)' | tee -a "$OUT"
echo
psql -v ON_ERROR_STOP=1 -q -f "$HERE/signer-seam-proof.sql" 2>&1 | sed -E 's/^.*NOTICE:  //' | grep -E '^(N[0-9]|---)' | tee -a "$OUT"
echo
psql -v ON_ERROR_STOP=1 -q -f "$HERE/link-provenance-proof.sql" 2>&1 | sed -E 's/^.*NOTICE:  //' | grep -E '^(L[0-9]|---)' | tee -a "$OUT"
echo

if grep -qE 'NO ERROR - GUARANTEE IS FALSE|UNEXPECTED|SUCCEEDED - INTEGRITY CLAIM IS FALSE' "$OUT"; then
  echo "FAIL — at least one integrity guarantee did not hold."
  exit 1
fi
# The floor exists so a suite that silently SHRANK cannot pass by asserting less. It was written at
# 25 against a suite that produced 30, and it was not raised when rows were added — by the time the
# suite produced 35 it tolerated 10 vanished negatives instead of 5. Raise it with the suite, or it
# stops being a floor and becomes a formality. Count at the time of writing: 35.
if [ "$(grep -c 'PASS' "$OUT")" -lt 33 ]; then
  echo "FAIL — fewer negatives ran than expected; the proof itself is broken."
  exit 1
fi
if ! grep -q 'E2 status = expired' "$OUT" || ! grep -q 'E3 revoked = true' "$OUT"; then
  echo "FAIL — the expiry sweep did not expire the agreement or did not revoke its live token."
  exit 1
fi
if ! grep -q 'E8 refused' "$OUT" || ! grep -q 'E9 refused' "$OUT"; then
  echo "FAIL — the overview did not refuse a foreign workspace or a non-member."
  exit 1
fi
# The UI contract: the page's three depended-on properties, proven rather than asserted.
if ! grep -q 'K3 raw_token_stored = false' "$OUT"; then
  echo "FAIL — the raw signing token was found stored on the row; only its hash may be."; exit 1
fi
if ! grep -q 'K5 leaks = 0' "$OUT"; then
  echo "FAIL — peek_agreement_signing exposes a tenant id, an email or a token column."; exit 1
fi
for row in 'K6a unknown  = false cols_null=true' 'K6b malformed= false cols_null=true' 'K6c expired  = false cols_null=true' 'K8 declined  = false cols_null=true'; do
  grep -qF "$row" "$OUT" || { echo "FAIL — refusals are distinguishable: missing [$row]"; exit 1; }
done
if ! grep -q 'K7c decline after signing = false' "$OUT"; then
  echo "FAIL — a signer who already signed was told their decline was recorded."; exit 1
fi
if ! grep -q 'K10b hash_gone = true' "$OUT" || ! grep -q 'K10c voided_refuses = false' "$OUT"; then
  echo "FAIL — voiding left a usable link behind."; exit 1
fi
# The positive controls for peek. Without these, a peek that ALWAYS refused would pass every
# refusal assertion above.
if ! grep -q 'K4 Services Agreement valid=true' "$OUT"; then
  echo "FAIL — peek did not return a live agreement; the refusal assertions prove nothing."; exit 1
fi
if ! grep -q 'K4b amount=250000 ccy=usd term=recurring valid=true' "$OUT"; then
  echo "FAIL — peek did not return the agreed figure for a priced agreement."; exit 1
fi
if ! grep -q 'K12 reached: draft -> sent -> viewed -> completed' "$OUT"; then
  echo "FAIL — a state this design claims is reachable was not reached."; exit 1
fi
if ! grep -q 'K12 expired reachable: expired' "$OUT"; then
  echo "FAIL — expired is unreachable."; exit 1
fi
# THE REACHABILITY CONTROL. The independent review found that nothing in the repository inserted a
# signer, so the whole engine was correct and unusable. This asserts the product's own create path
# produces a signer AND that the link the approved page issues now succeeds.
if ! grep -q 'N1 signers=1 email=a-client@example.com order=1' "$OUT"; then
  echo "FAIL — creating an agreement did not produce its counterparty signer; the engine is unreachable again."; exit 1
fi
if ! grep -q 'N1 link issued = sent' "$OUT"; then
  echo "FAIL — a signing link could not be issued for an agreement the product itself created."; exit 1
fi
if ! grep -q 'N2 agency refused 42501 PASS' "$OUT"; then
  echo "FAIL — a top-level agency created an agreement; the §61 tier gate is not enforced."; exit 1
fi
if ! grep -q 'N6 token_hash readable=f full_name readable=t PASS' "$OUT"; then
  echo "FAIL — authenticated can read token_hash, or can no longer read the columns it needs."; exit 1
fi
# Opening the page IS the view. Nothing wrote it for a whole round, which made "sent and ignored"
# and "opened and being read" the same thing on the owner's surface.
if ! grep -q 'N7 first view: signer=viewed agreement=viewed events=1 PASS' "$OUT"; then
  echo "FAIL — opening the signing page did not record the view."; exit 1
fi
if ! grep -q 'N7 reload: events=1 PASS' "$OUT"; then
  echo "FAIL — a reload recorded a second view; the trail counts page loads, not openings."; exit 1
fi
if ! grep -q 'N7 agreement viewed_at set = PASS' "$OUT"; then
  echo "FAIL — the agreement row carries no viewed_at; a per-agreement reader would have to aggregate signers."; exit 1
fi
if ! grep -q 'N7 viewed_at is FIRST not latest = PASS' "$OUT"; then
  echo "FAIL — a later opening rewrote viewed_at; it records the FIRST open."; exit 1
fi
# #1395's twin door. `agreement-send` refuses a document frozen before the uploaded-document fix;
# so must the manual link, or the owner simply uses the other control and the signer sees the blank
# page anyway. The positive controls are load-bearing: without L2 and L4 a function that refused
# every agreement would satisfy every negative below it.
for row in 'L1 pre-fix blank refused' 'L3 frozen-without-key refused' 'L7 lookalike key refused'; do
  grep -qF "$row" "$OUT" && grep -F "$row" "$OUT" | grep -q 'PASS' \
    || { echo "FAIL — the manual link path still issues a link for a document frozen before the fix: [$row]"; exit 1; }
done
if ! grep -q 'L1b token_hash_still_null = true' "$OUT"; then
  echo "FAIL — the refusal minted a token before raising."; exit 1
fi
if ! grep -q 'L2 token_is_64_hex = true' "$OUT"; then
  echo "FAIL — an upload frozen by the FIXED path was refused a link; the refusals above prove nothing."; exit 1
fi
if ! grep -q 'L4 token_is_64_hex = true' "$OUT"; then
  echo "FAIL — an ordinary text agreement was refused a link; the new check is catching everything."; exit 1
fi
if ! grep -F 'L5 unsent upload -> send path' "$OUT" | grep -q 'PASS'; then
  echo "FAIL — an unsent upload was told its document predates the fix; the new refusal shadowed the old one."; exit 1
fi
if ! grep -F 'L6 document refusal precedes signer' "$OUT" | grep -q 'PASS'; then
  echo "FAIL — an owner was sent to add a signer to an agreement that can never be sent."; exit 1
fi
if ! grep -q 'C1 .*signed' "$OUT" || ! grep -q 'C2 .*signed' "$OUT"; then
  echo "FAIL — positive controls did not succeed, so the negatives prove nothing."
  exit 1
fi
echo "OK — every negative refused with its expected SQLSTATE; positive controls succeeded."
