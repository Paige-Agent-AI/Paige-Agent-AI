\set ON_ERROR_STOP on
\set apply_budget_migration :apply_finance_migration
\set apply_finance_migration 1
\ir finance_source_authority.sql
DO $$ BEGIN
 IF to_regclass('public.fixture_current_retirement') IS NOT NULL THEN
  EXECUTE (SELECT definition FROM public.fixture_current_retirement);
 END IF;
END $$;
SELECT set_config('test.source_retirement_disposition',public.operator_retirement_disposition('finance_source_observations'),false);
\if :apply_budget_migration
\ir ../migrations/20271020000310_finance_budget_versions.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT set_config('test.refuse_receipt','no',false);
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',0,'managed_entity','Controlled budget company');
-- Failing-first seam is the actual planning RPC, never a structural assertion.
SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',0,'EUR','2026-10-01','2026-10-31','October plan','[{"id":"rent","source_label":"Loyer / original label","direction":"expense","planned_amount_decimal":"100.00"}]','Owner assumption: unchanged rent');
RESET ROLE;
CREATE FUNCTION public.fixture_budget_save(_expected bigint,_title text DEFAULT 'October plan') RETURNS jsonb LANGUAGE sql AS $$
 SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',_expected,'EUR','2026-10-01','2026-10-31',_title,'[{"id":"rent","source_label":"Loyer / original label","direction":"expense","planned_amount_decimal":"100.00"}]','Owner assumption: unchanged rent')
$$;
-- Retained revisions must remain addressable during Auth erasure and company
-- retirement; an active-only index cannot cover terminal history.
DO $$ BEGIN
 IF (SELECT count(*) FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
     WHERE c.relname IN ('finance_budget_actor','finance_budget_company','finance_budget_version_actor','finance_budget_version_scope')
       AND i.indisvalid AND i.indpred IS NULL) <> 4 THEN
  RAISE EXCEPTION 'Budget retained-history foreign-key indexes missing';
 END IF;
END $$;
SET ROLE service_role;
SELECT public.fixture_expect_error('INSERT INTO finance_budgets SELECT * FROM finance_budgets WHERE false','42501');
SELECT public.fixture_expect_error('UPDATE finance_budgets SET title=title WHERE false','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_budgets WHERE false','42501');
SELECT public.fixture_expect_error('INSERT INTO finance_budget_versions SELECT * FROM finance_budget_versions WHERE false','42501');
SELECT public.fixture_expect_error('UPDATE finance_budget_versions SET title=title WHERE false','42501');
SELECT public.fixture_expect_error('DELETE FROM finance_budget_versions WHERE false','42501');
RESET ROLE;
SET ROLE authenticated;
DO $$ DECLARE result jsonb; BEGIN
 result:=public.fixture_budget_save(0);
 IF result->>'version'<>'1' OR result->>'replayed'<>'true' THEN RAISE EXCEPTION 'Budget retry duplicated'; END IF;
 result:=public.read_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009');
 IF result->>'currency'<>'EUR' OR result->>'basis'<>'owner_entered_plan' OR result->'actuals'<>'null'::jsonb
  OR result->'lines'->0->>'source_label'<>'Loyer / original label' THEN RAISE EXCEPTION 'Budget source meaning changed'; END IF;
END $$;
SELECT public.fixture_expect_error('SELECT * FROM finance_budgets','42501');
SELECT public.fixture_expect_error('SELECT * FROM finance_budget_versions','42501');
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(0,''Conflict'')','40001');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_budget('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',1,'60000000-0000-0000-0000-000000000009')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',2,'60000000-0000-0000-0000-000000000009')$q$,'40001');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',1,'USD','2026-10-01','2026-10-31','October plan','[]','')$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',1,'EUR','2026-10-01','2026-10-31','October plan','[{"id":"x","source_label":"x","direction":"expense","planned_amount_decimal":100}]','')$q$,'22023');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',1,'EUR','2026-10-01','2026-10-31','October plan','[{"id":"x","source_label":"x","direction":"expense","planned_amount_decimal":"-1"}]','')$q$,'22023');
SELECT set_config('test.refuse_receipt','yes',false);
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(1,''Rollback plan'')','P0001');
SELECT set_config('test.refuse_receipt','no',false);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT version FROM finance_budgets WHERE id='60000000-0000-0000-0000-000000000009')<>1
 OR (SELECT count(*) FROM finance_budget_versions)<>1 THEN RAISE EXCEPTION 'Receipt failure did not roll back budget'; END IF;
END $$;
SET ROLE authenticated;
SELECT public.fixture_budget_save(1,'Revised October plan');
DO $$ DECLARE result jsonb; BEGIN
 result:=public.read_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'60000000-0000-0000-0000-000000000009',1);
 IF result->>'title'<>'October plan' OR result->>'current_version'<>'2' THEN RAISE EXCEPTION 'Immutable historical version lost'; END IF;
END $$;
RESET ROLE;
SELECT public.fixture_expect_error($q$UPDATE finance_budget_versions SET title='Tampered'$q$,'42501');
SELECT public.fixture_expect_error('DELETE FROM finance_budget_versions','42501');
DO $$ BEGIN
 IF has_function_privilege('anon','public.save_finance_budget(uuid,uuid,bigint,uuid,bigint,text,date,date,text,jsonb,text)','EXECUTE')
 OR has_function_privilege('service_role','public.save_finance_budget(uuid,uuid,bigint,uuid,bigint,text,date,date,text,jsonb,text)','EXECUTE')
 OR has_function_privilege('anon','public.read_finance_budget(uuid,uuid,bigint,uuid,bigint)','EXECUTE') THEN RAISE EXCEPTION 'Budget RPC ACL leaked'; END IF;
END $$;
BEGIN;
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(2,''Switched'')','42501');
ROLLBACK;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000003',true);
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(2,''Member'')','42501');
ROLLBACK;
BEGIN;
UPDATE finance_company_entities SET version=version+1 WHERE id='30000000-0000-0000-0000-000000000009';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(2,''Company changed'')','40001');
DO $$ DECLARE result jsonb; BEGIN
 result:=public.read_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',2,'60000000-0000-0000-0000-000000000009');
 IF result->>'company_identity_current'<>'false' THEN RAISE EXCEPTION 'Historical plan hid changed company identity'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE tenants SET lifecycle_execution_paused=true WHERE id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(2,''Paused'')','42501');
ROLLBACK;
BEGIN;
UPDATE tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_budget_save(2,''Revoked'')','42501');
ROLLBACK;
BEGIN;
INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000990',NULL,NULL);
INSERT INTO profiles VALUES('10000000-0000-0000-0000-000000000990','20000000-0000-0000-0000-000000000002');
INSERT INTO tenant_members VALUES('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000990','owner','active');
SET LOCAL ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000990',true);
SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',1,'60000000-0000-0000-0000-000000000990',0,'EUR','2026-10-01','2026-10-31','Actor erasure plan','[]','Controlled assumption');
RESET ROLE;
SELECT public.fixture_expect_error($q$UPDATE finance_budget_versions SET actor_id=NULL WHERE budget_id='60000000-0000-0000-0000-000000000990'$q$,'42501');
DELETE FROM auth.users WHERE id='10000000-0000-0000-0000-000000000990';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_budgets WHERE id='60000000-0000-0000-0000-000000000990' AND updated_by IS NULL)
  OR NOT EXISTS(SELECT 1 FROM finance_budget_versions WHERE budget_id='60000000-0000-0000-0000-000000000990' AND actor_id IS NULL AND assumptions='Controlled assumption')
 THEN RAISE EXCEPTION 'Budget actor erasure blocked or changed planning history'; END IF;
END $$;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
INSERT INTO user_roles VALUES('10000000-0000-0000-0000-000000000001','platform_admin');
INSERT INTO operator_account_archives VALUES('90000000-0000-0000-0000-000000000990','archived',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
UPDATE tenants SET archived_at=now(),lifecycle_execution_paused=true,archive_operation_id='90000000-0000-0000-0000-000000000990' WHERE id='20000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error('DELETE FROM finance_budget_versions','42501');
UPDATE operator_account_archives SET state='deleting';
DELETE FROM finance_budget_versions WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DELETE FROM finance_budgets WHERE tenant_id='20000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM finance_budgets WHERE tenant_id='20000000-0000-0000-0000-000000000001')
  OR EXISTS(SELECT 1 FROM finance_budget_versions WHERE tenant_id='20000000-0000-0000-0000-000000000001')
  OR NOT EXISTS(SELECT 1 FROM finance_budgets WHERE id='60000000-0000-0000-0000-000000000990' AND tenant_id='20000000-0000-0000-0000-000000000002')
  OR public.operator_retirement_disposition('finance_budgets')<>'delete'
  OR public.operator_retirement_disposition('finance_budget_versions')<>'delete'
  OR public.operator_retirement_disposition('finance_source_observations')<>current_setting('test.source_retirement_disposition')
  OR public.operator_retirement_disposition('profiles')<>'preserve'
 THEN RAISE EXCEPTION 'Budget canonical retirement failed'; END IF;
END $$;
ROLLBACK;
SELECT 'Finance budget authority PASS';
