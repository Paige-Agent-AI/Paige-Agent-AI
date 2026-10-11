-- ============================================================================
-- ANT-43/S7 slice 2 — SendGrid receipt journal: validate, dedup, append-once.
--
-- Failing-first: before 20271020000340 the ingest RPC, journal, and 'dropped'
-- status do not exist (first statement errors). After the migration every
-- assertion holds. Synthetic fixtures only; the transaction always rolls back.
-- Run: psql "$DB_URL" -1 -f supabase/tests/sendgrid_receipt_ingest.sql
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.require_true(value boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', label; END IF; END $$;

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
-- The door's REAL role: prove service_role can write through the grant.
SET LOCAL ROLE service_role;

-- 1. A verified event appends exactly one email_send_log row (sendgrid marker).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m1:delivered:2026-10-11','m1','delivered','Cust@Example.test','2026-10-11T01:00:00Z') = 'processed',
  'first delivery event processed');
SELECT pg_temp.require_true(
  (SELECT count(*) FROM public.email_send_log WHERE message_id='m1' AND sender_account='sendgrid') = 1,
  'exactly one appended row');
SELECT pg_temp.require_true(
  (SELECT recipient_email FROM public.email_send_log WHERE message_id='m1' AND sender_account='sendgrid') = 'cust@example.test',
  'recipient email allowlisted + normalized');

-- 2. Duplicate event identity writes NOTHING (replay/redelivery protection).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m1:delivered:2026-10-11','m1','delivered','Cust@Example.test','2026-10-11T01:00:00Z') = 'duplicate',
  'identical redelivery is a duplicate');
SELECT pg_temp.require_true(
  (SELECT count(*) FROM public.email_send_log WHERE message_id='m1' AND sender_account='sendgrid') = 1,
  'no second row after redelivery');

-- 3. A conflicting payload under the same receipt id is refused (no overwrite).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m1:delivered:2026-10-11','m1','bounced','other@example.test',NULL) = 'duplicate',
  'conflicting payload under same identity refused');

-- 4. Distinct events each append (timeline survives — append-only).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m1:open:2026-10-11','m1','opened',NULL,'2026-10-11T02:00:00Z') = 'processed',
  'subsequent open event processed');
SELECT pg_temp.require_true(
  (SELECT count(*) FROM public.email_send_log WHERE message_id='m1' AND sender_account='sendgrid') = 2,
  'two rows = two events, nothing updated');

-- 5. 'dropped' is recorded truthfully (the new CHECK value).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m2:dropped:x','m2','dropped','b@example.test',NULL) = 'processed',
  'dropped recorded as dropped');

-- 6. Validation refuses garbage (fail-closed; nothing written).
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('bad id!','m3','delivered',NULL,NULL) = 'invalid', 'bad receipt id invalid');
SELECT pg_temp.require_true(
  public.ingest_sendgrid_receipt('sg:m3:delivered:x','m3','probably-delivered',NULL,NULL) = 'invalid', 'unknown status invalid');
SELECT pg_temp.require_true(
  (SELECT count(*) FROM public.email_send_log WHERE message_id='m3') = 0, 'nothing written for invalid');

-- 7. The journal is invisible to anon/authenticated (private processing state).
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"sub":"b4a00000-0000-4000-8000-000000000003","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  BEGIN
    PERFORM count(*) FROM public.sendgrid_receipt_processing;
    RAISE EXCEPTION 'FAIL: authenticated role can read the journal';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT ILIKE '%permission denied%' THEN RAISE; END IF;
  END;
END $$;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
RESET ROLE;
SELECT 'SENDGRID_RECEIPT_INGEST_PROVEN' AS result;
ROLLBACK;
