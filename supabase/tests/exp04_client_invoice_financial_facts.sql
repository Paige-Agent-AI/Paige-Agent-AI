-- Selected-schema original financial query proof only. No customer/Auth proof.
CREATE TEMP TABLE e04_client_financial_checks(label text PRIMARY KEY);
CREATE FUNCTION pg_temp.e04_client_financial_assert(ok boolean,label text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 INSERT INTO e04_client_financial_checks VALUES(label);
END $$;
SELECT pg_temp.e04_client_financial_assert(
 (SELECT (value-'read_at')=(public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',40,NULL,'2026-01-11')-'read_at') FROM e04_original_client_facts),
 'the whole legacy payload including original source identity survives exact caller adaptation');
CREATE TEMP TABLE e04_actual_client_facts AS SELECT public._client_portal_invoice_facts_for_client(
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',40,NULL,'2026-01-11',2) value;
SELECT pg_temp.e04_client_financial_assert(
 (SELECT value->>'payment_evidence_version'='2' AND value->>'invoice_count'='6' AND value->>'open_count'='6' FROM e04_actual_client_facts),
 'the native actual position is explicitly versioned without hiding the original invoices');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='100000' AND invoice->>'provider_verified_minor'='0' AND invoice->>'test_provider_minor'='50000'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000001'),
 'TEST-only evidence does not reduce actual client debt or become live money');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='60000' AND invoice->>'provider_verified_minor'='30000'
   AND invoice->>'manual_recorded_minor'='10000' AND invoice->>'test_provider_minor'='20000'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000004'),
 'mixed original receipts expose one correct native client business position');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='50000' AND invoice->>'provider_verified_minor'='50000' AND invoice->>'test_provider_minor'='0'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000002'),
 'actual LIVE partial payment remains distinct from TEST');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='75000' AND invoice->>'manual_recorded_minor'='25000' AND invoice->>'provider_verified_minor'='0'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000003'),
 'business-recorded money is retained without provider verification');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='100000' AND invoice->>'manual_recorded_minor'='0'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000005'),
 'an original full human correction removes only its allocation');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT invoice->>'remaining_minor'='100000' AND invoice->>'provider_verified_minor'='0' AND invoice->>'test_provider_minor'='0'
  FROM e04_actual_client_facts f CROSS JOIN LATERAL jsonb_array_elements(f.value->'invoices') invoice WHERE invoice->>'id'='11111111-1111-4111-8111-000000000006'),
 'full TEST reversal leaves actual debt and cash unchanged');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT value#>>'{balances,0,remaining_minor}'='485000' AND value#>>'{balances,0,provider_verified_minor}'='80000'
   AND value#>>'{balances,0,manual_recorded_minor}'='35000' AND value#>>'{balances,0,test_provider_minor}'='70000' FROM e04_actual_client_facts),
 'all-page native currency totals use actual receivable and separate LIVE human and TEST evidence');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT first->'balances'=all_facts.value->'balances' AND first->'invoice_count'=all_facts.value->'invoice_count'
   AND first->'open_count'=all_facts.value->'open_count' AND first->>'has_more'='true' AND jsonb_array_length(first->'invoices')=1
  FROM e04_actual_client_facts all_facts CROSS JOIN LATERAL (SELECT public._client_portal_invoice_facts_for_client(
   'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',1,NULL,'2026-01-11',2) first) page),
 'pagination retains original all-page totals and counts rather than summing one row');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT old_page->'next_cursor'=new_page->'next_cursor' AND old_page#>'{invoices,0,id}'=new_page#>'{invoices,0,id}'
  FROM (SELECT public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',1,NULL,'2026-01-11') old_page,
   public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',1,NULL,'2026-01-11',2) new_page) page),
 'the original page ordering and cursor identity are representation-independent');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(old_facts.value->'invoices') original
   JOIN jsonb_array_elements(new_facts.value->'invoices') actual ON original->'id'=actual->'id'
   WHERE original-ARRAY['remaining_minor','provider_verified_minor'] IS DISTINCT FROM actual-ARRAY['remaining_minor','provider_verified_minor'])
  FROM e04_original_client_facts old_facts CROSS JOIN e04_actual_client_facts new_facts),
 'invoice client-facing identity version due-date and other minimized fields remain exact');
SELECT pg_temp.e04_client_financial_assert(
 public._client_portal_invoice_facts_for_client('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444',40,NULL,'2026-01-11',2)->>'invoice_count'='0'
 AND public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555',40,NULL,'2026-01-11',2)->>'invoice_count'='0',
 'private query selectors never cross tenant or client record identity');
DO $$ DECLARE mode integer;refused boolean; BEGIN
 FOREACH mode IN ARRAY ARRAY[NULL,0,3] LOOP
  refused:=false;BEGIN PERFORM public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',40,NULL,'2026-01-11',mode);
  EXCEPTION WHEN invalid_parameter_value THEN refused:=true;END;
  IF NOT refused THEN RAISE EXCEPTION 'FAIL: unsupported financial mode';END IF;
 END LOOP;
 PERFORM pg_temp.e04_client_financial_assert(true,'only the exact native legacy or actual financial representation is accepted');
END $$;
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public._client_portal_invoice_facts_for_client(NULL,'44444444-4444-4444-8444-444444444444',40,NULL,'2026-01-11',2);
 EXCEPTION WHEN insufficient_privilege THEN refused:=true;END;
 PERFORM pg_temp.e04_client_financial_assert(refused,'the original null-scope refusal is retained');
END $$;
DO $$ DECLARE refused boolean:=false; BEGIN
 BEGIN PERFORM public._client_portal_invoice_facts_for_client('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444',41,NULL,'2026-01-11',2);
 EXCEPTION WHEN invalid_parameter_value THEN refused:=true;END;
 PERFORM pg_temp.e04_client_financial_assert(refused,'the original page limit and refusal are retained');
END $$;
SELECT pg_temp.e04_client_financial_assert(
 (SELECT jsonb_agg(to_jsonb(p) ORDER BY invoice_id,kind,evidence_kind,provider_environment,amount_cents) FROM public.paige_invoice_payments p)
  =(SELECT value FROM e04_original_client_payments),
 'financial representation reads never change original money records');
SELECT pg_temp.e04_client_financial_assert(
 (SELECT count(*)=2 AND bool_and(NOT p.prosecdef AND p.provolatile='v' AND p.proconfig=ARRAY['search_path=""']::text[]
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee<>p.proowner AND a.privilege_type='EXECUTE'))
  FROM pg_proc p WHERE p.oid IN ('public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date)'::regprocedure,
   'public._client_portal_invoice_facts_for_client(uuid,uuid,integer,jsonb,date,integer)'::regprocedure)),
 'the original adapter and one extended query remain private invokers without public execution');
DO $$ BEGIN IF (SELECT count(*) FROM e04_client_financial_checks)<>18 THEN RAISE EXCEPTION 'FAIL: all18 client financial controls must execute';END IF;END $$;
SELECT jsonb_build_object('proof','E04_ORIGINAL_CLIENT_FINANCIAL_FACTS','checks',count(*),'status','PASS',
 'boundary','Original native query on selected synthetic tables; no caller Auth, provider, public RPC, full-schema or customer acceptance')
FROM e04_client_financial_checks;
