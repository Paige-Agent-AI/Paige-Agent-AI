-- O5 selected-schema actual ORIGINAL getter integration. The driver loads the
-- immutable lifecycle getter and its exact native fingerprint, never a fake
-- success port. This proves read projection only, not Auth/provider/writer QA.
CREATE TEMP TABLE e04_invoice_read_checks(label text PRIMARY KEY);
CREATE FUNCTION pg_temp.e04_invoice_read_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 INSERT INTO e04_invoice_read_checks VALUES(label);
END $$;
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT md5(prosrc)='1d5f5ed876cc95722dc0ef72cb1090f6' FROM pg_catalog.pg_proc WHERE oid='public._sales_invoice_read_before_provider(uuid,uuid,integer)'::regprocedure),
 'the immutable original getter matches the actual deployed native body');
SELECT pg_temp.e04_invoice_read_assert(
 (public._sales_invoice_read_before_provider('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001')->>'remaining_cents')::bigint=50000,
 'the actual original getter reproduces the TEST balance baseline');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'payment_evidence_version'='2' AND r->>'remaining_cents'='100000'
  AND r->>'allocated_cents'='0' AND r->>'provider_verified_cents'='0'
  AND r->>'test_provider_verified_cents'='50000' AND r->>'settlement'='unpaid'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001') r) s),
 'TEST verification is explicit and never claims real payment or reduced business debt');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r#>>'{payments,0,provider_environment}'='test' AND r#>>'{payments,0,evidence_kind}'='provider_verified'
  AND r#>>'{payments,0,provenance}'='provider_verified'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001') r) s),
 'the original receipt preserves its actual TEST environment and evidence class');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'remaining_cents'='60000' AND r->>'allocated_cents'='40000'
  AND r->>'manual_recorded_cents'='10000' AND r->>'provider_verified_cents'='30000'
  AND r->>'test_provider_verified_cents'='20000' AND r->>'settlement'='mixed_recorded_partial'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004') r) s),
 'mixed human live and TEST evidence returns one correct business position');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'remaining_cents'='50000' AND r->>'provider_verified_cents'='50000'
  AND r->>'test_provider_verified_cents'='0' AND r->>'settlement'='provider_verified_partial'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000002') r) s),
 'live partial capture retains its original truthful payment state');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'remaining_cents'='75000' AND r->>'manual_recorded_cents'='25000'
  AND r->>'provider_verified_cents'='0' AND r->>'settlement'='manually_recorded_partial'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000003') r) s),
 'human-recorded money remains distinct from provider verification');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'remaining_cents'='100000' AND r->>'allocated_cents'='0' AND r->>'settlement'='unpaid'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'payments') p WHERE p->>'kind'='reversal'
   AND jsonb_typeof(p->'original_receipt')='object' AND p#>>'{original_receipt,id}'=p->>'reverses_payment_id')
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000005') r) s),
 'full manual correction retains the original receipt and removes its allocation');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->'payments'='[]'::jsonb AND r->>'payments_count'='1' AND r->>'payments_has_more'='true'
  AND r->>'test_provider_verified_cents'='50000' AND r->>'remaining_cents'='100000'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',0) r) s),
 'pagination never turns a partial receipt page into a balance calculation');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT (old_r-ARRAY['manual_recorded_cents','remaining_cents','payments','settlement'])
  =(new_r-ARRAY['payment_evidence_version','manual_recorded_cents','provider_verified_cents','test_provider_verified_cents','allocated_cents','remaining_cents','payments','settlement'])
  FROM (SELECT public._sales_invoice_read_before_provider('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004') old_r,
   public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004') new_r) s),
 'original invoice identity frozen document versions and receipt counts remain exact');
SELECT pg_temp.e04_invoice_read_assert(
 public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004')
 =public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004'),
 'reopening the same unchanged native record returns the same financial evidence');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.paige_invoice_payments p)
 =(SELECT payload FROM e04_receipts_before),
 'customer reads never change any original payment or correction');
DO $$
DECLARE refused boolean:=false;
BEGIN
 BEGIN PERFORM public._sales_invoice_read('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-000000000001');
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.e04_invoice_read_assert(refused,'a foreign tenant cannot select this original invoice');
END $$;
DO $$
DECLARE refused boolean:=false;
BEGIN
 BEGIN PERFORM public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',51);
 EXCEPTION WHEN invalid_parameter_value THEN refused:=true; END;
 PERFORM pg_temp.e04_invoice_read_assert(refused,'the original receipt-page bound and refusal remain');
END $$;
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT p.prosecdef AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE')
  FROM pg_catalog.pg_proc p WHERE p.oid='public._sales_invoice_read(uuid,uuid,integer)'::regprocedure),
 'the original private definer getter gains no public execution grant');
UPDATE public.paige_invoices SET status='void' WHERE id='11111111-1111-4111-8111-000000000005';
SELECT pg_temp.e04_invoice_read_assert(
 public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000005')->>'settlement'='void',
 'void state remains separate from paid or corrected receipt history');
INSERT INTO public.paige_invoice_payments(tenant_id,invoice_id,kind,amount_cents,evidence_kind,provider_environment,provider,provider_verified_at)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000002','receipt',50000,'provider_verified','live','stripe','2026-01-01T00:00:00Z');
SELECT pg_temp.e04_invoice_read_assert(
 (SELECT r->>'remaining_cents'='0' AND r->>'allocated_cents'='100000' AND r->>'provider_verified_cents'='100000'
  AND r->>'test_provider_verified_cents'='0' AND r->>'settlement'='provider_verified_settled'
  FROM (SELECT public._sales_invoice_read('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000002') r) s),
 'only real live allocation yields the provider-verified settled state');
DO $$
BEGIN
 IF (SELECT count(*) FROM e04_invoice_read_checks)<>17 THEN RAISE EXCEPTION 'FAIL: all17 original customer-read controls must execute'; END IF;
END $$;
SELECT jsonb_build_object('proof','E04_ORIGINAL_INVOICE_ENVIRONMENT_READ','checks',count(*),'status','PASS',
 'boundary','Actual immutable getter and canonical position on selected synthetic schema; no caller Auth, guarded writer, provider or customer acceptance')
FROM e04_invoice_read_checks;

