\set ON_ERROR_STOP on
\if :apply_liability_migration
\ir ../migrations/20270602000428_finance_liability_source_projections.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.read_finance_liability_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000201');
RESET ROLE;
INSERT INTO connected_bank_accounts(id,user_id,is_active,account_id,plaid_environment)
 VALUES('40000000-0000-0000-0000-000000000228','10000000-0000-0000-0000-000000000001',true,'synthetic-business-card','sandbox');
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000228','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid','40000000-0000-0000-0000-000000000228','sandbox','synthetic-business-card','verified','60000000-0000-0000-0000-000000000228',now());
CREATE FUNCTION public.fixture_liability_write(payload jsonb,expected bigint DEFAULT 0,account_version bigint DEFAULT 1) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.replace_finance_liability_source_snapshot('50000000-0000-0000-0000-000000000228',1,account_version,expected,'2026-01-01T00:00:00Z',repeat('d',64),payload);
$$;
CREATE FUNCTION public.fixture_liability_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.read_finance_liability_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000228');
$$;
CREATE FUNCTION public.fixture_liability_payload(patch jsonb DEFAULT '{}') RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_array('{"nativeId":"synthetic-business-card","sourceLabel":"Company Card","product":"credit_card","currency":"USD","outstandingBalance":"100.50","principalBalance":null,"creditLimit":"1000","availableCredit":"899.5","minimumPayment":"20","nextPaymentDueDate":"2026-01-15","aprs":[{"percentage":"19.9","sourceType":"purchase_apr","subjectBalance":null,"interestCharge":null}],"companyOwnershipVerified":false,"accountingClassificationVerified":false}'::jsonb||patch);
$$;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write('[]')$q$,'40001');
SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000228',1,0,'2026-01-01T00:00:00Z','partial',true,repeat('a',64),
 '[{"native_id":"synthetic-business-card","source_label":"Company Card","product":"credit_card","currency":"USD","current_balance":"100.50","credit_limit":"1000","available_credit":"899.5"}]');
RESET ROLE;
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT * FROM finance_liability_source_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write('[]')$q$,'42501');
DO $$ BEGIN IF public.fixture_liability_read()->>'coverage'<>'unavailable' OR public.fixture_liability_read()->'records'<>'null'::jsonb THEN RAISE EXCEPTION 'Absent terms fabricated zero debt'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"nativeId":"unselected-account"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"currency":"EUR"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"product":"revolving_line"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"principalBalance":"100"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"availableCredit":"888"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"minimumPayment":20}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"minimumPayment":"-20"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"nextPaymentDueDate":"2026-02-30"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"nextPaymentDueDate":"yesterday"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"principalPayment":"10"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"companyOwnershipVerified":true}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"accountingClassificationVerified":true}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"guaranteeVerified":true}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"account_number":"forbidden"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"aprs":[{"percentage":19.9}]}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload('{"aprs":[{"percentage":"19.9","private_field":"forbidden"}]}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload()||public.fixture_liability_payload())$q$,'22023');
SELECT public.fixture_liability_write(public.fixture_liability_payload());
SELECT public.fixture_expect_error($q$DELETE FROM finance_liability_source_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE finance_liability_source_snapshots SET receipt_run_id=gen_random_uuid()$q$,'42501');
RESET ROLE;
SET ROLE authenticated;
DO $$ DECLARE r jsonb:=public.fixture_liability_read(); BEGIN
 IF r->>'coverage'<>'partial' OR r#>>'{records,0,outstandingBalance}'<>'100.50' OR r#>'{records,0,principalBalance}'<>'null'::jsonb
  OR r->'scheduled_debt_service'<>'null'::jsonb OR r->'company_wide_debt'<>'null'::jsonb OR r->>'institution_freshness_verified'<>'false' THEN
  RAISE EXCEPTION 'Liability meaning or unknown fields changed'; END IF;
END $$;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_liability_source('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000228')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_liability_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000228')$q$,'42501');
RESET ROLE;
BEGIN;
SELECT set_config('test.refuse_receipt','yes',true);
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write('[]',1)$q$,'P0001');
ROLLBACK;
DO $$ BEGIN IF (SELECT version FROM finance_liability_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000228')<>1 THEN RAISE EXCEPTION 'Failed receipt changed liability records'; END IF; END $$;
SET ROLE service_role;
SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000228',1,1,'2026-01-01T00:00:00Z','partial',true,repeat('b',64),
 '[{"native_id":"synthetic-business-card","source_label":"Company Card","product":"credit_card","currency":"USD","current_balance":"100.50","credit_limit":"1000","available_credit":"899.5"}]');
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN IF public.fixture_liability_read()->>'reason'<>'account_evidence_changed' OR public.fixture_liability_read()->'records'<>'null'::jsonb THEN RAISE EXCEPTION 'Terms mixed with a different account version'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.fixture_liability_write(public.fixture_liability_payload(),1,1)$q$,'40001');
SELECT public.fixture_liability_write(public.fixture_liability_payload(),1,2);
RESET ROLE;
BEGIN;
UPDATE connected_bank_accounts SET is_active=false WHERE id='40000000-0000-0000-0000-000000000228';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM finance_liability_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000228') THEN RAISE EXCEPTION 'Revoked source retained terms'; END IF; END $$;
SET LOCAL ROLE authenticated;
DO $$ BEGIN IF public.fixture_liability_read()->>'coverage'<>'unavailable' OR public.fixture_liability_read()->'records'<>'null'::jsonb THEN RAISE EXCEPTION 'Revoked financing remained readable'; END IF; END $$;
ROLLBACK;
-- Multiple same-label accounts remain distinct; card, LOC and loan meanings differ.
DO $$ DECLARE spec jsonb; row_id uuid; binding_id uuid; account jsonb; term jsonb; BEGIN
 FOR spec IN SELECT value FROM jsonb_array_elements('[
  {"suffix":"229","native":"synthetic-second-card","product":"credit_card","currency":"EUR","balance":"0","limit":"0","capacity":"0"},
  {"suffix":"230","native":"synthetic-company-loc","product":"revolving_line","currency":"USD","balance":"50","limit":"200","capacity":"150"},
  {"suffix":"231","native":"synthetic-company-loan","product":"loan_obligation","currency":"USD","balance":"1000"}]'::jsonb) LOOP
  row_id:=format('40000000-0000-0000-0000-%s',lpad(spec->>'suffix',12,'0'))::uuid;
  binding_id:=format('50000000-0000-0000-0000-%s',lpad(spec->>'suffix',12,'0'))::uuid;
  INSERT INTO connected_bank_accounts(id,user_id,is_active,account_id,plaid_environment) VALUES(row_id,'10000000-0000-0000-0000-000000000001',true,spec->>'native','sandbox');
  INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace,verification_state,verification_reference,verified_at)
   VALUES(binding_id,'20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid',row_id,'sandbox',spec->>'native','verified',gen_random_uuid(),now());
  account:=jsonb_build_object('native_id',spec->>'native','source_label','Same provider label','product',spec->>'product','currency',spec->>'currency','current_balance',spec->>'balance',
   'credit_limit',CASE WHEN spec->>'product'='credit_card' THEN spec->>'limit' ELSE NULL END,
   'available_credit',CASE WHEN spec->>'product'='credit_card' THEN spec->>'capacity' ELSE NULL END);
  PERFORM public.replace_finance_account_source_snapshot(binding_id,1,0,'2026-01-01T00:00:00Z','partial',true,repeat('a',64),jsonb_build_array(account));
  term:=jsonb_build_object('nativeId',spec->>'native','sourceLabel','Same provider label','product',spec->>'product','currency',spec->>'currency','outstandingBalance',spec->>'balance',
   'creditLimit',spec->>'limit','availableCredit',spec->>'capacity','principalBalance',CASE WHEN spec->>'product'='loan_obligation' THEN spec->>'balance' ELSE NULL END,
   'originalPrincipal',CASE WHEN spec->>'product'='loan_obligation' THEN '1200' ELSE NULL END,
   'nextPayment',CASE WHEN spec->>'product'='loan_obligation' THEN '100' ELSE NULL END,
   'maturityDate',CASE WHEN spec->>'product'='loan_obligation' THEN '2027-01-15' ELSE NULL END,
   'drawPeriodEndDate',CASE WHEN spec->>'product'='revolving_line' THEN '2030-12-31' ELSE NULL END);
  PERFORM public.replace_finance_liability_source_snapshot(binding_id,1,1,0,'2026-01-01T00:00:00Z',repeat('b',64),jsonb_build_array(term));
 END LOOP;
 IF (SELECT count(*) FROM finance_liability_source_snapshots WHERE records#>>'{0,sourceLabel}'='Same provider label')<>3 THEN RAISE EXCEPTION 'Same labels collapsed multiple accounts'; END IF;
 IF (SELECT s.records#>>'{0,outstandingBalance}' FROM finance_liability_source_snapshots s WHERE s.binding_id='50000000-0000-0000-0000-000000000229')<>'0' THEN RAISE EXCEPTION 'Explicit source zero lost'; END IF;
END $$;
DO $$ BEGIN IF public.operator_retirement_disposition('finance_liability_source_snapshots')<>'delete' THEN RAISE EXCEPTION 'Canonical liability cache retirement absent'; END IF; END $$;
SELECT 'Finance liability projections PASS: controlled source only; consent/provider/runtime proof owed';
