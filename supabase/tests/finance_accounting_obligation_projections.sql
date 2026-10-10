\set ON_ERROR_STOP on
\if :apply_obligation_migration
\ir ../migrations/20270602000429_finance_accounting_obligation_projections.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.read_finance_accounting_obligations('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','bills');
RESET ROLE;
INSERT INTO quickbooks_connections(id,user_id,is_active,qb_realm_id) VALUES('40000000-0000-0000-0000-000000000240','10000000-0000-0000-0000-000000000001',true,'synthetic-obligations');
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000240','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000240','sandbox','synthetic-obligations','verified','60000000-0000-0000-0000-000000000240',now());
SET ROLE service_role;
SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000240',1,0,'2026-01-01T00:00:00Z','complete',true,repeat('1',64),'[]');
RESET ROLE;
CREATE FUNCTION public.fixture_obligation_write(payload jsonb,expected bigint DEFAULT 0,account_version bigint DEFAULT 1,domain text DEFAULT 'bills') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.replace_finance_accounting_obligations('50000000-0000-0000-0000-000000000240',1,account_version,domain,expected,'2026-01-01T00:00:00Z','partial',false,repeat('2',64),payload);
$$;
CREATE FUNCTION public.fixture_obligation_read(domain text DEFAULT 'bills') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.read_finance_accounting_obligations('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000240',domain);
$$;
CREATE FUNCTION public.fixture_bill() RETURNS jsonb LANGUAGE sql AS $$
 SELECT '{"nativeId":"bill-1","documentNumber":"Vendor original reference","vendor":{"nativeId":"vendor-1","sourceLabel":"Original vendor"},"currency":"USD","transactionDate":"2025-12-30","dueDate":"2026-01-15","recordedTotal":"100.50","recordedOutstanding":"80.50","accountingStatus":"recorded_outstanding","issues":[],"bankSettlementVerified":false,"paymentExecutionSupported":false}'::jsonb;
$$;
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT * FROM finance_accounting_obligation_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write('[]')$q$,'42501');
DO $$ BEGIN IF public.fixture_obligation_read()->'records'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing bills fabricated records'; END IF; END $$;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_accounting_obligations('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000240','bills')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_accounting_obligations('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000240','bills')$q$,'42501');
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_read()$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"recordedOutstanding":"101"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"recordedTotal":100.5}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"recordedOutstanding":"-1"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"currency":"usd"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"dueDate":"2026-02-30"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"bankSettlementVerified":true}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"paymentExecutionSupported":true}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"accountingStatus":"paid"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"access_token":"private"}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()||'{"vendor":{"nativeId":"v","sourceLabel":"original","bankAccountNumber":"private"}}'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill(),public.fixture_bill()))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill()-'recordedOutstanding'))$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.replace_finance_accounting_obligations('50000000-0000-0000-0000-000000000240',1,1,'bills',0,'2026-01-01Z','complete',false,repeat('3',64),'[]')$q$,'22023');
SELECT public.fixture_obligation_write(jsonb_build_array(public.fixture_bill(),public.fixture_bill()||'{"nativeId":"bill-2","currency":"EUR","recordedOutstanding":null,"accountingStatus":"unknown","issues":["balance_unknown"]}',public.fixture_bill()||'{"nativeId":"bill-3","recordedOutstanding":"0","accountingStatus":"recorded_zero_balance"}'));
SELECT public.fixture_expect_error($q$UPDATE finance_accounting_obligation_snapshots SET records='[]'$q$,'42501');
SELECT public.fixture_expect_error($q$DELETE FROM finance_accounting_obligation_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$INSERT INTO finance_accounting_obligation_snapshots SELECT * FROM finance_accounting_obligation_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write('[]')$q$,'40001');
SELECT set_config('test.refuse_receipt','yes',false);
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write('[]',1)$q$,'P0001');
SELECT set_config('test.refuse_receipt','no',false);
RESET ROLE;
SET ROLE authenticated;
DO $$ DECLARE r jsonb:=public.fixture_obligation_read(); BEGIN
 IF r->>'coverage'<>'partial' OR r->>'temporal_basis'<>'source_snapshot' OR r->'recognized_expenses'<>'null'::jsonb
  OR r->'bank_settlement_verified'<>'false'::jsonb OR r->'payment_execution_supported'<>'false'::jsonb
  OR jsonb_array_length(r->'records')<>3 OR r->'records'->1->'recordedOutstanding'<>'null'::jsonb
  OR r->'records'->2->>'recordedOutstanding'<>'0' OR r->'records'->0->'vendor'->>'sourceLabel'<>'Original vendor'
  OR r->>'version'<>'1' THEN RAISE EXCEPTION 'Bill projection changed source meaning or receipt rollback'; END IF;
END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_obligation_write('[{"nativeId":"purchase-1","documentNumber":null,"entity":null,"paymentAccount":{"nativeId":"credit-card-1","sourceLabel":"Original card"},"currency":"USD","transactionDate":"2026-01-01","recordedTotal":"100","paymentType":"CreditCard","isCredit":false,"recognizedExpense":null,"bankSettlementVerified":false}]',0,1,'expenses');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write('[{"nativeId":"p","documentNumber":null,"entity":null,"paymentAccount":null,"currency":null,"transactionDate":null,"recordedTotal":null,"paymentType":null,"isCredit":null,"recognizedExpense":"100","bankSettlementVerified":false}]',1,1,'expenses')$q$,'22023');
SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000240',1,1,'2026-01-01T00:00:00Z','complete',true,repeat('4',64),'[]');
SELECT public.fixture_expect_error($q$SELECT public.fixture_obligation_write('[]',1,1)$q$,'40001');
RESET ROLE;
SET ROLE authenticated;
DO $$ BEGIN IF public.fixture_obligation_read()->>'reason'<>'account_evidence_changed' THEN RAISE EXCEPTION 'Old account version retained accounting evidence'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_obligation_write('[]',1,2);
RESET ROLE;
BEGIN;
UPDATE quickbooks_connections SET is_active=false WHERE id='40000000-0000-0000-0000-000000000240';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM finance_accounting_obligation_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000240') THEN RAISE EXCEPTION 'Revoked accounting cache retained'; END IF; END $$;
SET ROLE authenticated;
DO $$ BEGIN IF public.fixture_obligation_read()->>'coverage'<>'unavailable' THEN RAISE EXCEPTION 'Revoked accounting read retained'; END IF; END $$;
ROLLBACK;
DO $$ BEGIN IF public.operator_retirement_disposition('finance_accounting_obligation_snapshots')<>'delete' THEN RAISE EXCEPTION 'Canonical retirement not registered'; END IF; END $$;
SELECT 'Finance accounting obligations PASS';
