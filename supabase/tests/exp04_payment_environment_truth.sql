-- EXP04 O5 selected-schema regression, invoked by the original owned local
-- native proof. Requires the six neutral input cases and e04_balance_before.
-- Synthetic source proof only: no JWT, provider, financial writer or customer QA.
CREATE TEMP TABLE e04_environment_checks(label text PRIMARY KEY);
CREATE FUNCTION pg_temp.e04_environment_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 INSERT INTO e04_environment_checks VALUES(label);
END $$;

SELECT pg_temp.e04_environment_assert(
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY invoice_id) FROM public._sales_invoice_balance_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') b)
 IS NOT DISTINCT FROM
 (SELECT jsonb_agg(to_jsonb(b) ORDER BY invoice_id) FROM e04_balance_before b),
 'original seven-column compatibility rows remain exact');
SELECT pg_temp.e04_environment_assert(
 (SELECT allocated_minor=50000 AND remaining_minor=50000 AND test_provider_minor=50000 FROM public._sales_invoice_balance_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001')),
 'legacy TEST projection remains explicit for existing Finance consumers');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_allocated_minor=0 AND receivable_remaining_minor=100000 AND test_provider_minor=50000 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001')),
 'TEST-only verification does not reduce the business receivable');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_allocated_minor=40000 AND receivable_remaining_minor=60000 AND test_provider_minor=20000 AND manual_minor=10000 AND live_provider_minor=30000 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004')),
 'mixed manual and live allocation excludes TEST exactly once');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_remaining_minor=50000 AND receivable_allocated_minor=50000 AND test_provider_minor=0 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000002')),
 'live receipt keeps its original business allocation');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_remaining_minor=75000 AND manual_minor=25000 AND provider_minor=0 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000003')),
 'human-recorded evidence retains its distinct original allocation');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_remaining_minor=100000 AND receivable_allocated_minor=0 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000005')),
 'full manual correction preserves original zero net allocation');
SELECT pg_temp.e04_environment_assert(
 (SELECT receivable_remaining_minor=100000 AND receivable_allocated_minor=0 AND test_provider_minor=0 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000006')),
 'TEST receipt and correction never become real collected money');

INSERT INTO public.paige_invoices VALUES('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',500000);
INSERT INTO public.paige_invoice_payments VALUES('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','receipt',400000,'provider_verified','live');
SELECT pg_temp.e04_environment_assert(
 (SELECT count(*)=6 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')),
 'foreign source rows do not enter this tenant projection');
SELECT pg_temp.e04_environment_assert(
 NOT EXISTS(SELECT 1 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','22222222-2222-4222-8222-222222222222')),
 'an original invoice selector cannot cross the tenant boundary');
SELECT pg_temp.e04_environment_assert(
 NOT EXISTS(SELECT 1 FROM public._sales_invoice_financial_position_rows(NULL)),
 'absent tenant context yields no financial rows');
SELECT pg_temp.e04_environment_assert(
 (SELECT p.prosecdef AND p.provolatile='s' AND p.proconfig=ARRAY['search_path=""']::text[]
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE')
  FROM pg_catalog.pg_proc p WHERE p.oid='public._sales_invoice_financial_position_rows(uuid,uuid)'::regprocedure),
 'the canonical core stays stable empty-search-path and private to its owning caller');
SELECT pg_temp.e04_environment_assert(
 (SELECT count(*)=1 FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004'))
 AND (SELECT count(*)=10 FROM jsonb_object_keys((SELECT to_jsonb(b) FROM public._sales_invoice_financial_position_rows('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004') b))),
 'the bounded original-record projection has the exact declared ten-column shape');

DO $$
BEGIN
 IF (SELECT count(*) FROM e04_environment_checks)<>13 THEN
  RAISE EXCEPTION 'FAIL: all13 financial environment controls must execute';
 END IF;
END $$;
SELECT jsonb_build_object('proof','E04_CANONICAL_PAYMENT_ENVIRONMENT_POSITION','checks',count(*),'status','PASS',
 'boundary','Original balance core and seven-column adapter on selected synthetic tables; no writer, hosted Auth, provider or customer acceptance')
FROM e04_environment_checks;

