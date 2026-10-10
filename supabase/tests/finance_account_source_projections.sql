\set ON_ERROR_STOP on
\if :apply_account_migration
\ir ../migrations/20270602000423_finance_account_source_projections.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.read_finance_account_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001');
RESET ROLE;
INSERT INTO quickbooks_connections VALUES('40000000-0000-0000-0000-000000000200','10000000-0000-0000-0000-000000000001',true);
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000200','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000200','sandbox','synthetic-account-projection','verified','60000000-0000-0000-0000-000000000200',now());
CREATE FUNCTION public.fixture_account_write(payload jsonb,expected bigint DEFAULT 0,digest text DEFAULT repeat('d',64)) RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000200',1,expected,'2026-01-01T00:00:00Z','complete',true,digest,payload);
$$;
CREATE FUNCTION public.fixture_account_read() RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.read_finance_account_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000200');
$$;
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT * FROM finance_account_source_snapshots$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[]')$q$,'42501');
DO $$ BEGIN IF public.fixture_account_read()->>'coverage'<>'unavailable' OR public.fixture_account_read()->'accounts'<>'null'::jsonb THEN RAISE EXCEPTION 'Missing snapshot fabricated financial accounts'; END IF; END $$;
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_account_write('[{"native_id":"101","source_label":"Operating","product":"deposit","currency":"USD","current_balance":"100.10","available_cash":null},{"native_id":"102","source_label":"Operating","product":"deposit","currency":"EUR","current_balance":null}]');
RESET ROLE;
SET ROLE authenticated;
DO $$ DECLARE read jsonb:=public.fixture_account_read(); BEGIN
 IF jsonb_array_length(read->'accounts')<>2 OR read#>>'{accounts,0,native_id}'<>'101' OR read#>>'{accounts,1,native_id}'<>'102'
  OR read#>>'{accounts,0,current_balance}'<>'100.10' OR read#>'{accounts,1,current_balance}'<>'null'::jsonb OR read->'calculated_totals'<>'null'::jsonb
  OR read->>'institution_freshness_verified'<>'false' OR read->>'temporal_basis'<>'source_snapshot' THEN
  RAISE EXCEPTION 'Native account identity, nullable balance or currency boundary lost';
 END IF;
END $$;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_account_source('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000200')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_account_source('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000200')$q$,'42501');
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$UPDATE finance_account_source_snapshots SET accounts='[]',normalized_digest=encode(sha256(convert_to('[]','UTF8')),'hex') WHERE binding_id='50000000-0000-0000-0000-000000000200'$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","source_updated_at":"yesterday"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","source_updated_at":"2026-02-30T00:00:00Z"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","source_updated_at":"2026-01-02T00:00:00Z"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Card","product":"credit_card","available_cash":"100"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","available_credit":"100"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Accounting Bank","product":"deposit","available_cash":"100"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","current_balance":100}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"source_label":"Missing identity","product":"deposit"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","product":"deposit"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Duplicate","product":"deposit"},{"native_id":"1","source_label":"Duplicate","product":"deposit"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[{"native_id":"1","source_label":"Bank","product":"deposit","token":"forbidden"}]',1)$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[]',0,repeat('a',64))$q$,'40001');
BEGIN;
SELECT set_config('test.refuse_receipt','yes',true);
SELECT public.fixture_expect_error($q$SELECT public.fixture_account_write('[]',1,repeat('b',64))$q$,'P0001');
ROLLBACK;
RESET ROLE;
DO $$ BEGIN IF (SELECT version FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000200')<>1 THEN RAISE EXCEPTION 'Failed receipt mutated snapshot'; END IF; END $$;
SET ROLE service_role;
SELECT public.fixture_account_write('[{"native_id":"101","source_label":"Operating","product":"deposit","currency":"USD","current_balance":"0"}]',1,repeat('e',64));
RESET ROLE;
DO $$ BEGIN IF (SELECT accounts#>>'{0,current_balance}' FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000200')<>'0' THEN RAISE EXCEPTION 'Explicit source zero lost'; END IF; END $$;
UPDATE quickbooks_connections SET is_active=false WHERE id='40000000-0000-0000-0000-000000000200';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000200') THEN RAISE EXCEPTION 'Revocation retained account projection'; END IF; END $$;
SET ROLE authenticated;
DO $$ BEGIN IF public.fixture_account_read()->>'coverage'<>'unavailable' OR public.fixture_account_read()->'accounts'<>'null'::jsonb THEN RAISE EXCEPTION 'Revoked source returned financial figures'; END IF; END $$;
RESET ROLE;
INSERT INTO connected_bank_accounts(id,user_id,is_active,account_id) VALUES('40000000-0000-0000-0000-000000000201','10000000-0000-0000-0000-000000000001',true,'synthetic-native-card');
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000201','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid','40000000-0000-0000-0000-000000000201','sandbox','synthetic-item-card','verified','60000000-0000-0000-0000-000000000201',now());
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000201',1,0,'2026-01-01T00:00:00Z','complete',true,repeat('a',64),'[{"native_id":"another-account","source_label":"Card","product":"credit_card"}]')$q$,'22023');
SELECT public.replace_finance_account_source_snapshot('50000000-0000-0000-0000-000000000201',1,0,'2026-01-01T00:00:00Z','complete',true,repeat('a',64),'[{"native_id":"synthetic-native-card","source_label":"Company Card","product":"credit_card","currency":"USD","current_balance":"10","credit_limit":"100","available_credit":"90"}]');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT normalized_digest FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000201') IS DISTINCT FROM
  (SELECT encode(sha256(convert_to(accounts::text,'UTF8')),'hex') FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000201') THEN RAISE EXCEPTION 'Snapshot digest not derived from normalized records'; END IF;
END $$;
UPDATE connected_bank_accounts SET account_id='replacement-native-card' WHERE id='40000000-0000-0000-0000-000000000201';
DO $$ BEGIN IF EXISTS(SELECT 1 FROM finance_account_source_snapshots WHERE binding_id='50000000-0000-0000-0000-000000000201') THEN RAISE EXCEPTION 'Native replacement retained account projection'; END IF; END $$;
SELECT 'Finance account projections PASS: controlled source cache only; provider and authenticated runtime proof owed' AS result;
DO $$ BEGIN
 IF public.operator_retirement_disposition('finance_account_source_snapshots')<>'delete'
 OR public.operator_retirement_disposition('finance_source_observations')<>'delete'
 OR public.operator_retirement_disposition('profiles')<>'preserve' THEN RAISE EXCEPTION 'Projection canonical retirement policy drift'; END IF;
END $$;
