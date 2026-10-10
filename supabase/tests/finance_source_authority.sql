\set ON_ERROR_STOP on
-- Disposable PostgreSQL fixture only. Production acceptance is a separate proof.
DO $$ BEGIN
 IF current_database() NOT LIKE 'finance_fixture_%' THEN RAISE EXCEPTION 'Disposable Finance database required'; END IF;
END $$;
CREATE SCHEMA auth;
DO $$ BEGIN
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
 IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END $$;
CREATE TABLE auth.users(id uuid PRIMARY KEY, deleted_at timestamptz, banned_until timestamptz);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE public.tenants(id uuid PRIMARY KEY, status text, brand jsonb DEFAULT '{}');
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,PRIMARY KEY(tenant_id,user_id));
CREATE TABLE public.user_roles(user_id uuid,role text);
CREATE TABLE public.quickbooks_connections(id uuid PRIMARY KEY,user_id uuid,is_active boolean);
CREATE TABLE public.connected_bank_accounts(id uuid PRIMARY KEY,user_id uuid,is_active boolean);
-- Existing canonical authority contracts are dependencies, not Finance role semantics.
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid() $$;
CREATE FUNCTION public.is_tenant_admin_as(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.agency_can_manage_child(_child uuid,_actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE TABLE public.fixture_receipts(id uuid PRIMARY KEY,tenant_id uuid,actor_id uuid,capability_key text);
CREATE FUNCTION public.record_capability_run(_tenant uuid,_actor uuid,_key text,_outcome text,_run uuid,_agent text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.refuse_receipt',true)='yes' THEN RAISE EXCEPTION 'Receipt unavailable'; END IF;
 INSERT INTO public.fixture_receipts VALUES(_run,_tenant,_actor,_key);
END $$;
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001',null,null),('10000000-0000-0000-0000-000000000002',null,null),('10000000-0000-0000-0000-000000000003',null,null);
INSERT INTO tenants VALUES ('20000000-0000-0000-0000-000000000001','active','{"business_brief":{"legalName":"Test Company A"}}'),('20000000-0000-0000-0000-000000000002','active','{"business_brief":{"legalName":"Test Company B"}}');
INSERT INTO profiles VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001');
INSERT INTO tenant_members VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner','active'),('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','member','active');
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
-- Missing seam is the failing-first proof; the runner applies the migration before this line for the passing leg.
\if :apply_finance_migration
\ir ../migrations/20270602000401_finance_company_source_authority.sql
\endif
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001');
RESET ROLE;
CREATE FUNCTION public.fixture_expect_error(statement text,expected_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE caught boolean:=false;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  caught:=true;
  IF SQLSTATE<>expected_state THEN RAISE EXCEPTION 'Expected %, received %: %',expected_state,SQLSTATE,SQLERRM; END IF;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'Expected refusal: %',statement; END IF;
END $$;

SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT * FROM public.finance_company_entities$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000002')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'workspace_company','Test Customer Company')$q$,'22023');
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'workspace_company','Test Company A');
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',0,'workspace_company','Test Company A');
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',0,'managed_entity','Test Managed Company');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003',0,'managed_entity','Conflicting Test Company')$q$,'40001');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000003',false);
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000004',0,'managed_entity','Test Unauthorized Company')$q$,'42501');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000002',false);
SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002',0,'workspace_company','Test Company B');
SELECT public.fixture_expect_error($q$SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000003',0,'managed_entity','Test Foreign Company')$q$,'42501');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM fixture_receipts)<>3 THEN RAISE EXCEPTION 'Canonical receipt replay failed'; END IF;
 IF (SELECT count(*) FROM finance_company_entities)<>3 THEN RAISE EXCEPTION 'Entity isolation failed'; END IF;
END $$;
INSERT INTO quickbooks_connections VALUES('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001',true);
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-realm-1','verified','60000000-0000-0000-0000-000000000001',now());
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET entity_id='30000000-0000-0000-0000-000000000003',revision=revision+1$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET revision=revision$q$,'40001');
INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,currency,reporting_basis,source_observed_at,coverage,pages_complete,evidence_digest)
 VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-account-1','bank_accounts',null,'not_supplied',now(),'partial',false,repeat('a',64));
SELECT public.fixture_expect_error($q$UPDATE finance_source_observations SET coverage='complete'$q$,'42501');
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest) VALUES('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001',1,'test-foreign','bank_accounts',now(),'partial',false,repeat('b',64))$q$,'42501');
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-incomplete','income_statement',now(),'complete',false,repeat('b',64))$q$,'23514');
UPDATE quickbooks_connections SET is_active=false;
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-revoked','bank_accounts',now(),'partial',repeat('b',64))$q$,'42501');
UPDATE quickbooks_connections SET is_active=true;
UPDATE finance_source_bindings SET revision=revision+1,verification_state='revoked';
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET revision=revision+1,verification_state='verified'$q$,'40001');
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace)
 VALUES('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-realm-1');
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000003',1,'test-unverified-reconnect','bank_accounts',now(),'partial',repeat('d',64))$q$,'42501');
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-stale-revision','bank_accounts',now(),'partial',repeat('b',64))$q$,'42501');
UPDATE tenant_members SET status='revoked' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
UPDATE tenant_members SET status='active' WHERE user_id='10000000-0000-0000-0000-000000000001';
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000001' WHERE user_id='10000000-0000-0000-0000-000000000001';
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
UPDATE auth.users SET banned_until=NULL WHERE id='10000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT set_config('test.refuse_receipt','yes',false);
SELECT public.fixture_expect_error($q$SELECT public.save_finance_company_entity('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000009',0,'managed_entity','Test Rolled Back Company')$q$,'P0001');
RESET ROLE;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000009') THEN RAISE EXCEPTION 'Write survived failed canonical receipt'; END IF;
 IF has_function_privilege('anon','public.read_finance_source_catalog(uuid)','EXECUTE') OR has_function_privilege('service_role','public.read_finance_source_catalog(uuid)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected catalog principal'; END IF;
 IF EXISTS(SELECT 1 FROM finance_source_observations WHERE currency IS NOT NULL OR coverage<>'partial' OR pages_complete) THEN RAISE EXCEPTION 'Missing data became complete'; END IF;
END $$;
SELECT 'Finance source authority PASS: synthetic PostgreSQL only; authenticated/provider acceptance owed' AS result;
