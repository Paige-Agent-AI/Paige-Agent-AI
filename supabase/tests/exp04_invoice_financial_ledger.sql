-- Selected-schema proof against the ORIGINAL native ledger/getter bodies.
-- No Auth, provider invocation, production or customer acceptance is claimed.
CREATE TEMP TABLE e04_ledger_checks(label text PRIMARY KEY);
CREATE FUNCTION pg_temp.e04_ledger_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 INSERT INTO e04_ledger_checks VALUES(label);
END $$;
-- These two controls exercise the explicit actual-receivable representation.
SELECT set_config('request.headers','{"x-paige-invoice-evidence-version":"2"}',true);
INSERT INTO public.paige_invoices(id,tenant_id,amount_total_cents,invoice_number,billing_document,billing_document_digest)
 SELECT '11111111-1111-4111-8111-000000000007',tenant_id,amount_total_cents,'SYNTHETIC-EMPTY',billing_document,billing_document_digest
 FROM public.paige_invoices WHERE id='11111111-1111-4111-8111-000000000001';
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='100000' AND r->>'allocated_cents'='0'
  AND r#>'{payment_ledger,rows}'='[]'::jsonb AND r#>>'{payment_ledger,count}'='0'
  AND r#>>'{payment_ledger,receivable_receipt_total_cents}'='0'
  AND r#>>'{payment_ledger,receivable_reversal_total_cents}'='0'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000007',100,NULL) r) q),
 'an original empty native history has zero real payments and the full outstanding amount');
DELETE FROM public.paige_invoices WHERE id='11111111-1111-4111-8111-000000000007';
DO $$
DECLARE r jsonb; refused boolean:=false; old_version bigint;
BEGIN
 r:=public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004',1,NULL);
 SELECT billing_lifecycle_version INTO old_version FROM public.paige_invoices WHERE id='11111111-1111-4111-8111-000000000004';
 UPDATE public.paige_invoices SET billing_lifecycle_version=old_version+1 WHERE id='11111111-1111-4111-8111-000000000004';
 BEGIN PERFORM public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004',1,r->'next_cursor');
 EXCEPTION WHEN serialization_failure THEN refused:=true; END;
 UPDATE public.paige_invoices SET billing_lifecycle_version=old_version WHERE id='11111111-1111-4111-8111-000000000004';
 PERFORM pg_temp.e04_ledger_assert(refused,'the original stale-version cursor refuses instead of mixing native histories');
END $$;
SELECT set_config('request.headers','{}',true);
SELECT pg_temp.e04_ledger_assert(
 (SELECT md5(prosrc)='f15ea4d49f4da35d7aeb5b25c2ac1080' FROM pg_proc
  WHERE oid='public._sales_invoice_payment_ledger_before_provider(uuid,uuid,integer,jsonb)'::regprocedure),
 'the actual original locked document and cursor query is unchanged');
SELECT pg_temp.e04_ledger_assert(
 NOT EXISTS(SELECT 1 FROM e04_ledger_legacy_before b WHERE b.payload IS DISTINCT FROM
  public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b.invoice_id,b.page_limit,NULL)),
 'every complete and partial legacy payload remains exact after the owner getter adopts actual balances');
SELECT set_config('request.headers','{"x-paige-invoice-evidence-version":"2"}',true);
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'payment_evidence_version'='2' AND r->>'remaining_cents'='100000'
  AND r->>'allocated_cents'='0' AND r->>'provider_verified_cents'='0' AND r->>'test_provider_verified_cents'='50000'
  AND r#>>'{payment_ledger,receipt_total_cents}'='50000' AND r#>>'{payment_ledger,receivable_receipt_total_cents}'='0'
  AND r#>>'{payment_ledger,rows,0,provider_environment}'='test'
  AND r#>>'{payment_ledger,rows,0,running_remaining_cents}'='50000'
  AND r#>>'{payment_ledger,rows,0,receivable_running_remaining_cents}'='100000'
  AND r->>'settlement'='unpaid'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',100,NULL) r) q),
 'TEST-only history retains its receipt while native business debt remains fully outstanding');
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='60000' AND r->>'allocated_cents'='40000'
  AND r->>'manual_recorded_cents'='10000' AND r->>'provider_verified_cents'='30000'
  AND r->>'test_provider_verified_cents'='20000'
  AND r#>>'{payment_ledger,receipt_total_cents}'='60000'
  AND r#>>'{payment_ledger,receivable_receipt_total_cents}'='40000'
  AND r#>>'{payment_ledger,rows,2,receivable_running_remaining_cents}'='60000'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004',100,NULL) r) q),
 'mixed human LIVE and TEST evidence has the same canonical real balance and native final running amount');
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='75000' AND r->>'manual_recorded_cents'='25000'
  AND r->>'provider_verified_cents'='0' AND r#>'{payment_ledger,rows,0,provider_environment}'='null'::jsonb
  AND r#>>'{payment_ledger,rows,0,evidence_kind}'='manual_recorded'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000003',100,NULL) r) q),
 'human evidence stays human and never acquires a provider environment');
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='50000' AND r->>'provider_verified_cents'='50000'
  AND r#>>'{payment_ledger,rows,0,provider_environment}'='live'
  AND r#>>'{payment_ledger,rows,0,receivable_running_remaining_cents}'='50000'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000002',100,NULL) r) q),
 'LIVE partial settlement remains provider verified and retains its native running balance');
INSERT INTO public.paige_invoice_payments(id,tenant_id,invoice_id,kind,amount_cents,evidence_kind,provider_environment,provider,provider_verified_at,method)
 VALUES('77777777-7777-4777-8777-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',
  'receipt',100000,'provider_verified','live','stripe','2026-01-01T00:00:00Z','stripe');
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='0' AND r->>'allocated_cents'='100000'
  AND r->>'provider_verified_cents'='100000' AND r->>'test_provider_verified_cents'='50000'
  AND r->>'settlement'='provider_verified_settled'
  AND r#>>'{payment_ledger,receivable_receipt_total_cents}'='100000'
  AND r#>>'{payment_ledger,rows,1,receivable_running_remaining_cents}'='0'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',100,NULL) r) q),
 'a real full receipt settles the actual invoice despite retained TEST history and negative legacy running debt');
DELETE FROM public.paige_invoice_payments WHERE id='77777777-7777-4777-8777-000000000001';
SELECT pg_temp.e04_ledger_assert(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.paige_invoice_payments p)=(SELECT payload FROM e04_receipts_before),
 'the causal full-payment fixture restores every original receipt before further checks');
SELECT pg_temp.e04_ledger_assert(
 (SELECT r->>'remaining_cents'='100000' AND r#>>'{payment_ledger,receivable_receipt_total_cents}'='25000'
  AND r#>>'{payment_ledger,receivable_reversal_total_cents}'='25000'
  AND r#>>'{payment_ledger,rows,1,reverses_payment_id}'=r#>>'{payment_ledger,rows,0,id}'
  AND r#>>'{payment_ledger,rows,1,receivable_running_remaining_cents}'='100000'
  FROM (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000005',100,NULL) r) q),
 'a full original manual correction retains receipt identity and restores business debt');
SELECT pg_temp.e04_ledger_assert(
 NOT EXISTS(SELECT 1 FROM e04_ledger_legacy_before b
  CROSS JOIN LATERAL (SELECT public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b.invoice_id,b.page_limit,NULL) r) q
  WHERE b.payload->'document' IS DISTINCT FROM r->'document'
   OR b.payload->'document_input_digest' IS DISTINCT FROM r->'document_input_digest'
   OR b.payload->'invoice_id' IS DISTINCT FROM r->'invoice_id'
   OR b.payload->'version' IS DISTINCT FROM r->'version'
   OR b.payload->'next_cursor' IS DISTINCT FROM r->'next_cursor'
   OR b.payload->'has_more' IS DISTINCT FROM r->'has_more'),
 'exact frozen documents identities versions cursor and page boundaries are conserved');
DO $$
DECLARE r jsonb; next_page jsonb; assembled jsonb:='[]'; cursor jsonb:=NULL; n integer:=0;
BEGIN
 r:=public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004',100,NULL);
 LOOP
  next_page:=public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000004',1,cursor);
  PERFORM pg_temp.e04_ledger_assert(next_page->'remaining_cents'=r->'remaining_cents'
   AND next_page#>'{payment_ledger,receivable_receipt_total_cents}'=r#>'{payment_ledger,receivable_receipt_total_cents}',
   'native financial totals are independent of page '||n);
  assembled:=assembled||(next_page#>'{payment_ledger,rows}');n:=n+1;
  EXIT WHEN next_page->>'has_more'='false';
  IF n>3 THEN RAISE EXCEPTION 'Unbounded fixture cursor'; END IF;
  cursor:=next_page->'next_cursor';
 END LOOP;
 PERFORM pg_temp.e04_ledger_assert(assembled=r#>'{payment_ledger,rows}' AND n=3,
  'original server cursor reconstructs exact native running history across three pages');
END $$;
SELECT pg_temp.e04_ledger_assert(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.paige_invoice_payments p)=(SELECT payload FROM e04_receipts_before),
 'all original payment rows and reversal evidence remain unchanged');
DO $$
DECLARE refused boolean:=false;
BEGIN
 BEGIN PERFORM public._sales_invoice_payment_ledger('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','11111111-1111-4111-8111-000000000001',100,NULL);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true; END;
 PERFORM pg_temp.e04_ledger_assert(refused,'foreign invoice refusal remains the original locked-reader decision');
END $$;
DO $$
DECLARE h jsonb; refused boolean;
BEGIN
 FOREACH h IN ARRAY ARRAY['[]'::jsonb,'null'::jsonb,'{"x-paige-invoice-evidence-version":2}'::jsonb,
  '{"x-paige-invoice-evidence-version":null}'::jsonb,'{"x-paige-invoice-evidence-version":"3"}'::jsonb] LOOP
  PERFORM set_config('request.headers',h::text,true);refused:=false;
  BEGIN PERFORM public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-000000000001',100,NULL);
  EXCEPTION WHEN invalid_parameter_value THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'Malformed financial representation admitted'; END IF;
 END LOOP;
 PERFORM pg_temp.e04_ledger_assert(true,'unknown and non-primitive evidence versions refuse without a legacy fallback');
END $$;
SELECT set_config('request.headers','{}',true);
SELECT pg_temp.e04_ledger_assert(
 NOT EXISTS(SELECT 1 FROM e04_ledger_legacy_before b WHERE b.payload IS DISTINCT FROM
  public._sales_invoice_payment_ledger('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b.invoice_id,b.page_limit,NULL)),
 'returning to a legacy caller preserves its exact original financial semantics');
SELECT jsonb_build_object('proof','E04_ORIGINAL_INVOICE_FINANCIAL_LEDGER','status','PASS','checks',count(*)) FROM e04_ledger_checks;
