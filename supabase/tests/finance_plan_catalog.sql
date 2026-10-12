\set ON_ERROR_STOP on
\set apply_catalog_migration :apply_finance_migration
\set apply_finance_migration 1
\ir finance_cash_scenarios.sql
\if :apply_catalog_migration
\ir ../migrations/20271023000100_finance_plan_catalog.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1);
RESET ROLE;
DO $$ DECLARE r jsonb; BEGIN
 r:=public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1);
 IF r->>'entity_id'<>'30000000-0000-0000-0000-000000000009'
  OR jsonb_array_length(r->'budgets')<>1 OR jsonb_array_length(r->'cash_scenarios')<>1
  OR r#>>'{budgets,0,currency}'<>'EUR' OR r#>>'{budgets,0,basis}'<>'owner_entered_plan'
  OR r#>>'{cash_scenarios,0,basis}'<>'owner_entered_assumptions'
  OR r->'monetary_values_included'<>'false'::jsonb OR r->'bank_balances_established'<>'false'::jsonb
  OR r#>'{budgets,0,lines}' IS NOT NULL OR r#>'{cash_scenarios,0,config}' IS NOT NULL
 THEN RAISE EXCEPTION 'Plan identity, currency, basis or bounded metadata lost'; END IF;
END $$;
SET ROLE authenticated;
SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,
 '60000000-0000-0000-0000-000000000010',0,'USD','2026-10-01','2026-10-31','October plan',
 '[{"id":"rent","source_label":"Original owner wording","direction":"expense","planned_amount_decimal":"0"}]','Controlled second-currency plan');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1);
 IF jsonb_array_length(r->'budgets')<>2
  OR (SELECT count(DISTINCT p->>'id') FROM jsonb_array_elements(r->'budgets') p)<>2
  OR (SELECT count(DISTINCT p->>'currency') FROM jsonb_array_elements(r->'budgets') p)<>2
 THEN RAISE EXCEPTION 'Shared labels collapsed identities or currencies'; END IF;
END $$;
RESET ROLE;
BEGIN;
SET LOCAL ROLE authenticated;
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1,'managed_entity','Controlled revised company');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',2);
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(r->'budgets'||r->'cash_scenarios') p WHERE p->'company_identity_current'<>'false'::jsonb)
 THEN RAISE EXCEPTION 'Historical company identity became current'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE finance_company_entities SET is_active=false WHERE id='30000000-0000-0000-0000-000000000009';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
ROLLBACK;
BEGIN;
INSERT INTO finance_budgets
 SELECT format('60000000-0000-0000-0001-%s',lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000009',1,'EUR','2026-10-01','2026-10-31','Controlled bounded plan',1,
  '10000000-0000-0000-0000-000000000001',gen_random_uuid(),clock_timestamp() FROM generate_series(1,201) i;
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'54000');
ROLLBACK;
BEGIN;
INSERT INTO finance_budgets VALUES('60000000-0000-0000-0000-000000000020','20000000-0000-0000-0000-000000000001',
 '30000000-0000-0000-0000-000000000009',1,'EUR','2026-10-01','2026-10-31',repeat(' ',300)||'A',1,
 '10000000-0000-0000-0000-000000000001',gen_random_uuid(),clock_timestamp());
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'54000');
ROLLBACK;
SET ROLE anon;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
RESET ROLE;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
RESET ROLE;
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',1)$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',2)$q$,'40001');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000002',false);
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
RESET ROLE;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
BEGIN;
UPDATE tenant_members SET role='member' WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE tenant_members SET role='admin' WHERE tenant_id='20000000-0000-0000-0000-000000000001' AND user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
RESET ROLE;
INSERT INTO agency_team_members VALUES('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','agency_specialist','active',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
SET LOCAL ROLE authenticated;
SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1);
ROLLBACK;
BEGIN;
UPDATE tenants SET lifecycle_execution_paused=true WHERE id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE auth.users SET deleted_at=clock_timestamp() WHERE id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',1)$q$,'42501');
ROLLBACK;
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000002',false);
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000019',0,'managed_entity','Controlled standalone planning');
SELECT public.save_finance_budget('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000019',1,
 '60000000-0000-0000-0000-000000000019',0,'USD','2026-10-01','2026-10-31','Standalone plan',
 '[{"id":"rent","source_label":"Original label","direction":"expense","planned_amount_decimal":"100"}]','Controlled assumption');
DO $$ DECLARE r jsonb; BEGIN
 r:=public.read_finance_plan_catalog('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000019',1);
 IF jsonb_array_length(r->'budgets')<>1 OR r#>>'{budgets,0,id}'<>'60000000-0000-0000-0000-000000000019'
  OR jsonb_array_length(r->'cash_scenarios')<>0 THEN RAISE EXCEPTION 'Standalone catalogue scope failed'; END IF;
END $$;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
RESET ROLE;
SELECT 'Finance plan catalogue authority PASS';
