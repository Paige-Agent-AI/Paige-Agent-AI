\set ON_ERROR_STOP on
\set apply_scenario_migration :apply_finance_migration
\set apply_finance_migration 1
\ir finance_budget_versions.sql
\if :apply_scenario_migration
\ir ../migrations/20271020000320_finance_cash_scenario_versions.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.save_finance_cash_scenario('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'61000000-0000-0000-0000-000000000009',0,
'{"title":"Owner scenario","currency":"EUR","start_date":"2026-11-01","horizon_days":30,"opening_cash":null,"cash_floor":"100","events":[],"assumptions":"Opening cash not supplied"}');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE c.relname IN ('finance_scenario_actor','finance_scenario_company','finance_scenario_version_actor','finance_scenario_version_scope')
       AND i.indisvalid AND i.indpred IS NULL) <> 4 THEN
  RAISE EXCEPTION 'Scenario retained-history foreign-key indexes missing';
 END IF;
END $$;
SET ROLE service_role;
SELECT public.fixture_expect_error('INSERT INTO finance_cash_scenarios SELECT * FROM finance_cash_scenarios WHERE false','42501');
SELECT public.fixture_expect_error('UPDATE finance_cash_scenarios SET config=config WHERE false','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_cash_scenarios WHERE false','42501');
SELECT public.fixture_expect_error('INSERT INTO finance_cash_scenario_versions SELECT * FROM finance_cash_scenario_versions WHERE false','42501');
SELECT public.fixture_expect_error('UPDATE finance_cash_scenario_versions SET config=config WHERE false','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_cash_scenario_versions WHERE false','42501');
RESET ROLE;
CREATE FUNCTION public.fixture_scenario_save(_expected bigint,_title text DEFAULT 'Owner scenario') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.save_finance_cash_scenario('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'61000000-0000-0000-0000-000000000009',_expected,
 jsonb_build_object('title',_title,'currency','EUR','start_date','2026-11-01','horizon_days',30,'opening_cash',NULL,'cash_floor','100','events','[]'::jsonb,'assumptions','Opening cash not supplied'))
$$;
SET ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.fixture_scenario_save(0);
 IF result->>'replayed'<>'true' THEN RAISE EXCEPTION 'Scenario retry duplicated'; END IF;
 result:=public.read_finance_cash_scenario('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'61000000-0000-0000-0000-000000000009');
 IF result->'config'->'opening_cash'<>'null'::jsonb OR result->'verified_opening_cash'<>'null'::jsonb
  OR result->>'guaranteed_result'<>'false' THEN RAISE EXCEPTION 'Assumptions became verified cash'; END IF;
END $$;
SELECT public.fixture_expect_error('SELECT * FROM finance_cash_scenarios','42501');
SELECT public.fixture_expect_error('SELECT public.fixture_scenario_save(0,''Conflict'')','40001');
SELECT set_config('test.refuse_receipt','yes',false);
SELECT public.fixture_expect_error('SELECT public.fixture_scenario_save(1,''Rollback'')','P0001');
SELECT set_config('test.refuse_receipt','no',false);
RESET ROLE;
DO $$ BEGIN IF (SELECT version FROM finance_cash_scenarios)<>1 OR (SELECT count(*) FROM finance_cash_scenario_versions)<>1 THEN RAISE EXCEPTION 'Scenario receipt rollback failed'; END IF; END $$;
SELECT public.fixture_expect_error('DELETE FROM finance_cash_scenarios','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_cash_scenario_versions','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_budgets','42501');
SELECT public.fixture_expect_error($q$UPDATE finance_cash_scenarios SET config=config||'{"title":"Tampered"}'$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE finance_cash_scenario_versions SET config=config||'{"title":"Tampered"}'$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public._finance_validate_cash_scenario('[]')$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public._finance_validate_cash_scenario('{"title":"x","currency":"EUR","start_date":"2026-11-01","horizon_days":30,"opening_cash":100,"cash_floor":null,"events":[],"assumptions":""}')$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public._finance_validate_cash_scenario('{"title":"x","currency":"EUR","start_date":"2026-02-30","horizon_days":30,"opening_cash":null,"cash_floor":null,"events":[],"assumptions":""}')$q$,'22023');
SET ROLE authenticated;
SELECT public.fixture_scenario_save(1,'Revised scenario');
BEGIN;
SELECT public.fixture_budget_save(2,'Budget header guard regression');
ROLLBACK;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.read_finance_cash_scenario('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'61000000-0000-0000-0000-000000000009',1);
 IF result->'config'->>'title'<>'Owner scenario' OR result->>'current_version'<>'2' THEN RAISE EXCEPTION 'Scenario history changed'; END IF;
END $$;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_cash_scenario('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000009',1,'61000000-0000-0000-0000-000000000009')$q$,'42501');
RESET ROLE;
BEGIN;
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_scenario_save(2,''Switched'')','42501');
ROLLBACK;
BEGIN;
UPDATE tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_scenario_save(2,''Revoked'')','42501');
ROLLBACK;
BEGIN;
INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000991',NULL,NULL);
INSERT INTO profiles VALUES('10000000-0000-0000-0000-000000000991','20000000-0000-0000-0000-000000000002');
INSERT INTO tenant_members VALUES('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000991','owner','active');
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000991',true);
SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'60000000-0000-0000-0000-000000000991',0,'EUR','2026-11-01','2026-11-30','Retained budget','[]','Controlled assumption');
SELECT public.save_finance_cash_scenario('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'61000000-0000-0000-0000-000000000991',0,
'{"title":"Retained assumption","currency":"EUR","start_date":"2026-11-01","horizon_days":90,"opening_cash":"-100.000001","cash_floor":null,"events":[],"assumptions":"Controlled negative opening assumption"}');
RESET ROLE;
SELECT public.fixture_expect_error($q$UPDATE finance_cash_scenarios SET updated_by=NULL WHERE id='61000000-0000-0000-0000-000000000991'$q$,'42501');
DELETE FROM auth.users WHERE id='10000000-0000-0000-0000-000000000991';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_cash_scenarios WHERE id='61000000-0000-0000-0000-000000000991' AND updated_by IS NULL)
 OR NOT EXISTS(SELECT 1 FROM finance_cash_scenario_versions WHERE scenario_id='61000000-0000-0000-0000-000000000991' AND actor_id IS NULL AND config->>'opening_cash'='-100.000001') THEN RAISE EXCEPTION 'Scenario actor erasure lost history'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance_budgets WHERE id='60000000-0000-0000-0000-000000000991' AND updated_by IS NULL) THEN RAISE EXCEPTION 'Budget header guard blocked actor erasure'; END IF;
END $$;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
INSERT INTO user_roles VALUES('10000000-0000-0000-0000-000000000001','platform_admin');
INSERT INTO operator_account_archives VALUES('90000000-0000-0000-0000-000000000991','archived',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
UPDATE tenants SET archived_at=now(),lifecycle_execution_paused=true,archive_operation_id='90000000-0000-0000-0000-000000000991' WHERE id='20000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error('DELETE FROM finance_cash_scenario_versions','42501');
UPDATE operator_account_archives SET state='deleting';
DELETE FROM finance_cash_scenario_versions WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DELETE FROM finance_cash_scenarios WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DELETE FROM finance_budget_versions WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DELETE FROM finance_budgets WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM finance_cash_scenarios WHERE tenant_id='20000000-0000-0000-0000-000000000001')
 OR NOT EXISTS(SELECT 1 FROM finance_cash_scenarios WHERE id='61000000-0000-0000-0000-000000000991')
 OR public.operator_retirement_disposition('finance_cash_scenarios')<>'delete'
 OR public.operator_retirement_disposition('finance_cash_scenario_versions')<>'delete' THEN RAISE EXCEPTION 'Scenario retirement crossed scope'; END IF;
END $$;
ROLLBACK;
SELECT 'Finance cash scenario authority PASS';
