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
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('test.actor',true),''))::uuid $$;
CREATE TYPE public.tenant_status AS ENUM('trial','active','past_due','canceled','suspended');
CREATE TABLE public.tenants(id uuid PRIMARY KEY, status public.tenant_status, brand jsonb DEFAULT '{}',archived_at timestamptz,lifecycle_execution_paused boolean NOT NULL DEFAULT false,parent_tenant_id uuid,archive_operation_id uuid);
CREATE TABLE public.operator_account_archives(id uuid PRIMARY KEY,state text,scope_ids uuid[]);
CREATE TABLE public.profiles(user_id uuid PRIMARY KEY,active_tenant_id uuid);
CREATE TABLE public.tenant_members(tenant_id uuid,user_id uuid,role text,status text,PRIMARY KEY(tenant_id,user_id));
CREATE TABLE public.user_roles(user_id uuid,role text);
CREATE FUNCTION public.operator_can_retire_accounts() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role='platform_admin') $$;
CREATE TABLE public.agency_team_members(agency_tenant_id uuid,user_id uuid,agency_role text,status text,scoped_subaccounts uuid[]);
CREATE TABLE public.quickbooks_connections(id uuid PRIMARY KEY,user_id uuid,is_active boolean,qb_realm_id text DEFAULT 'test-realm',environment text DEFAULT 'sandbox',business_id uuid,scope text DEFAULT 'com.intuit.quickbooks.accounting');
CREATE TABLE public.quickbooks_financials(id uuid PRIMARY KEY,qb_connection_id uuid REFERENCES public.quickbooks_connections(id) ON DELETE CASCADE);
CREATE TABLE public.quickbooks_transactions(id uuid PRIMARY KEY,qb_connection_id uuid REFERENCES public.quickbooks_connections(id) ON DELETE CASCADE);
CREATE TABLE public.connected_bank_accounts(id uuid PRIMARY KEY,user_id uuid,is_active boolean,plaid_item_id text DEFAULT 'test-item',account_id text DEFAULT 'test-account',business_id uuid,transactions_cursor text,last_sync_at timestamptz);
CREATE TABLE public.connected_bank_account_secrets(account_row_id uuid PRIMARY KEY REFERENCES public.connected_bank_accounts(id) ON DELETE CASCADE,plaid_access_token_ct bytea);
-- Existing canonical authority contracts are dependencies, not Finance role semantics.
CREATE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT active_tenant_id FROM public.profiles WHERE user_id=auth.uid() $$;
CREATE FUNCTION public.is_tenant_admin_as(_actor uuid,_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS(SELECT 1 FROM public.tenant_members WHERE user_id=_actor AND tenant_id=_tenant AND status='active' AND role IN ('owner','admin')) $$;
CREATE FUNCTION public.agency_can_manage_child(_child uuid,_actor uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT EXISTS(SELECT 1 FROM public.agency_team_members atm JOIN public.tenants child ON child.parent_tenant_id=atm.agency_tenant_id WHERE atm.user_id=_actor AND child.id=_child AND atm.status='active' AND _child=ANY(atm.scoped_subaccounts)) $$;
CREATE TABLE public.fixture_receipts(id uuid PRIMARY KEY,tenant_id uuid,actor_id uuid,capability_key text);
CREATE FUNCTION public.record_capability_run(_tenant uuid,_actor uuid,_key text,_outcome text,_run uuid,_agent text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.refuse_receipt',true)='yes' THEN RAISE EXCEPTION 'Receipt unavailable'; END IF;
 INSERT INTO public.fixture_receipts VALUES(_run,_tenant,_actor,_key);
END $$;
-- Repository replay can install both canonical signatures; current production metadata has ten only.
-- Keep the stricter two-signature overload resolution in the proof.
CREATE FUNCTION public.record_capability_run(_tenant uuid,_actor uuid,_key text,_outcome text,_run uuid,_agent text DEFAULT NULL,_job text DEFAULT NULL,_trace uuid DEFAULT NULL,_release text DEFAULT NULL,_detail jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF current_setting('test.refuse_receipt',true)='yes' THEN RAISE EXCEPTION 'Receipt unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tenant_members WHERE tenant_id=_tenant AND user_id=_actor AND status='active') THEN RAISE EXCEPTION 'Canonical receipt seat unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO public.fixture_receipts VALUES(_run,_tenant,_actor,_key);
END $$;
INSERT INTO auth.users VALUES ('10000000-0000-0000-0000-000000000001',null,null),('10000000-0000-0000-0000-000000000002',null,null),('10000000-0000-0000-0000-000000000003',null,null);
INSERT INTO tenants(id,status,brand) VALUES ('20000000-0000-0000-0000-000000000001','active','{"business_brief":{"legalName":"Test Company A"}}'),('20000000-0000-0000-0000-000000000002','active','{"business_brief":{"legalName":"Test Company B"}}');
INSERT INTO profiles VALUES ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001');
INSERT INTO tenant_members VALUES ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','owner','active'),('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','owner','active'),('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000003','member','active');
GRANT USAGE ON SCHEMA auth TO authenticated,anon,service_role;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated,anon,service_role;
-- Missing seam is the failing-first proof; the runner applies the migration before this line for the passing leg.
\if :apply_finance_migration
\ir ../migrations/20270602000421_finance_company_source_authority.sql
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
INSERT INTO quickbooks_connections VALUES('40000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000002',true);
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000099','sandbox','test-foreign-owner')$q$,'42501');
DELETE FROM quickbooks_connections WHERE id='40000000-0000-0000-0000-000000000099';
INSERT INTO connected_bank_accounts VALUES('40000000-0000-0000-0000-000000000099','10000000-0000-0000-0000-000000000002',true);
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid','40000000-0000-0000-0000-000000000099','sandbox','test-foreign-bank-owner')$q$,'42501');
DELETE FROM connected_bank_accounts WHERE id='40000000-0000-0000-0000-000000000099';
DO $$ BEGIN IF coalesce(current_setting('request.jwt.claim.sub',true),'')<>'' THEN RAISE EXCEPTION 'Source owner claims leaked after refusal'; END IF; END $$;
UPDATE tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-revoked-source-owner')$q$,'42501');
UPDATE tenant_members SET status='active' WHERE user_id='10000000-0000-0000-0000-000000000001';
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-realm-1','verified','60000000-0000-0000-0000-000000000001',now());
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET entity_id='30000000-0000-0000-0000-000000000003',revision=revision+1$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET revision=revision$q$,'40001');
INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,currency,reporting_basis,source_observed_at,coverage,pages_complete,evidence_digest)
 VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-account-1','bank_accounts',null,'not_supplied',now(),'partial',false,repeat('a',64));
SELECT public.fixture_expect_error($q$UPDATE finance_source_observations SET coverage='complete'$q$,'42501');
UPDATE tenants SET lifecycle_execution_paused=true WHERE id='20000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-paused','bank_accounts',now(),'partial',repeat('e',64))$q$,'42501');
UPDATE tenants SET lifecycle_execution_paused=false WHERE id='20000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest) VALUES('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001',1,'test-foreign','bank_accounts',now(),'partial',false,repeat('b',64))$q$,'42501');
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-incomplete','income_statement',now(),'complete',false,repeat('b',64))$q$,'23514');
UPDATE quickbooks_connections SET is_active=false;
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,evidence_digest) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',1,'test-revoked','bank_accounts',now(),'partial',repeat('b',64))$q$,'42501');
UPDATE quickbooks_connections SET is_active=true;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000001' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'Connection deactivation did not revoke historical binding'; END IF;
END $$;
SELECT public.fixture_expect_error($q$DELETE FROM finance_source_bindings$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE finance_source_bindings SET revision=revision+1,verification_state='verified'$q$,'40001');
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace)
 VALUES('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-realm-1');
SELECT public.fixture_expect_error($q$DELETE FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000003'$q$,'42501');
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
-- Scoped agency delegation is a canonical dependency fixture; no agency role engine is added.
BEGIN;
UPDATE finance_company_entities SET version=version+1 WHERE id='30000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000003' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'Company revision reused previous source verification'; END IF;
END $$;
ROLLBACK;
-- Finance must not prevent canonical Auth erasure or account retirement.
BEGIN;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
SELECT set_config('test.refuse_receipt','no',true);
INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000990',NULL,NULL);
INSERT INTO finance_company_entities(id,tenant_id,kind,legal_name,identity_basis,identity_reference,declared_by,updated_by)
 VALUES('30000000-0000-0000-0000-000000000990','20000000-0000-0000-0000-000000000001','managed_entity','Retirement controlled company','owner_declaration','30000000-0000-0000-0000-000000000990','10000000-0000-0000-0000-000000000990','10000000-0000-0000-0000-000000000990');
DELETE FROM auth.users WHERE id='10000000-0000-0000-0000-000000000990';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000990' AND declared_by IS NULL AND updated_by IS NULL AND version=1)
 THEN RAISE EXCEPTION 'Auth erasure lost company history or remained blocked'; END IF;
 IF public.operator_retirement_disposition('finance_company_entities')<>'delete'
  OR public.operator_retirement_disposition('finance_source_bindings')<>'delete'
  OR public.operator_retirement_disposition('finance_source_observations')<>'delete'
  OR public.operator_retirement_disposition('clients')<>'delete'
  OR public.operator_retirement_disposition('profiles')<>'preserve'
  OR public.operator_retirement_disposition('unknown_finance_table')<>'blocked' THEN RAISE EXCEPTION 'Canonical disposition changed outside Finance'; END IF;
END $$;
INSERT INTO quickbooks_connections(id,user_id,is_active) VALUES('40000000-0000-0000-0000-000000000990','10000000-0000-0000-0000-000000000001',true);
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000990','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000990','quickbooks','40000000-0000-0000-0000-000000000990','sandbox','retirement-controlled-native','verified',gen_random_uuid(),now());
INSERT INTO finance_source_observations(tenant_id,entity_id,binding_id,binding_revision,source_record_key,domain,source_observed_at,coverage,pages_complete,evidence_digest)
 VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000990','50000000-0000-0000-0000-000000000990',1,'retirement-controlled-observation','bank_accounts',now(),'complete',true,repeat('a',64));
INSERT INTO user_roles VALUES('10000000-0000-0000-0000-000000000001','platform_admin');
INSERT INTO operator_account_archives VALUES('90000000-0000-0000-0000-000000000990','archived',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
UPDATE tenants SET archived_at=now(),lifecycle_execution_paused=true,archive_operation_id='90000000-0000-0000-0000-000000000990' WHERE id='20000000-0000-0000-0000-000000000001';
SELECT public.fixture_expect_error($q$DELETE FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000990'$q$,'42501');
UPDATE operator_account_archives SET state='deleting',scope_ids=ARRAY['20000000-0000-0000-0000-000000000002'::uuid];
SELECT public.fixture_expect_error($q$DELETE FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000990'$q$,'42501');
UPDATE operator_account_archives SET scope_ids=ARRAY['20000000-0000-0000-0000-000000000001'::uuid];
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000002',true);
SELECT public.fixture_expect_error($q$DELETE FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000990'$q$,'42501');
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
DELETE FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000990';
DELETE FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000990';
DELETE FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000990';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM finance_source_observations WHERE binding_id='50000000-0000-0000-0000-000000000990')
  OR EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000990')
  OR EXISTS(SELECT 1 FROM finance_company_entities WHERE id='30000000-0000-0000-0000-000000000990') THEN RAISE EXCEPTION 'Canonical retirement left Finance rows'; END IF;
END $$;
ROLLBACK;
BEGIN;
UPDATE quickbooks_connections SET qb_realm_id='test-different-company',environment='production' WHERE id='40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000003' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'Realm/environment change reused company verification'; END IF;
END $$;
ROLLBACK;
BEGIN;
INSERT INTO quickbooks_financials VALUES('70000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001');
INSERT INTO quickbooks_transactions VALUES('70000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001');
DELETE FROM quickbooks_connections WHERE id='40000000-0000-0000-0000-000000000001';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM quickbooks_connections) OR EXISTS(SELECT 1 FROM quickbooks_financials) OR EXISTS(SELECT 1 FROM quickbooks_transactions) THEN RAISE EXCEPTION 'Finance history prevented QuickBooks credential/cache erasure'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000003' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'QuickBooks deletion did not retain revoked history'; END IF;
END $$;
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks','40000000-0000-0000-0000-000000000001','sandbox','test-erased-realm')$q$,'42501');
ROLLBACK;
BEGIN;
INSERT INTO connected_bank_accounts VALUES('40000000-0000-0000-0000-000000000011','10000000-0000-0000-0000-000000000001',true);
INSERT INTO connected_bank_account_secrets VALUES('40000000-0000-0000-0000-000000000011',decode('73796e746865746963','hex'));
INSERT INTO finance_source_bindings(id,tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace,verification_state,verification_reference,verified_at)
 VALUES('50000000-0000-0000-0000-000000000011','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid','40000000-0000-0000-0000-000000000011','sandbox','test-plaid-account','verified','60000000-0000-0000-0000-000000000011',now());
UPDATE connected_bank_accounts SET transactions_cursor='test-next',last_sync_at=now() WHERE id='40000000-0000-0000-0000-000000000011';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000011' AND verification_state='verified' AND revision=1) THEN RAISE EXCEPTION 'Ordinary cursor update invalidated unchanged account identity'; END IF;
END $$;
SAVEPOINT before_native_change;
UPDATE connected_bank_accounts SET account_id='test-different-native-account' WHERE id='40000000-0000-0000-0000-000000000011';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000011' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'Native account change reused company verification'; END IF;
END $$;
ROLLBACK TO SAVEPOINT before_native_change;
UPDATE connected_bank_accounts SET is_active=false WHERE id='40000000-0000-0000-0000-000000000011';
UPDATE connected_bank_accounts SET is_active=true WHERE id='40000000-0000-0000-0000-000000000011';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000011' AND verification_state='revoked' AND revision=2) THEN RAISE EXCEPTION 'Plaid reactivation restored old authority'; END IF;
END $$;
DELETE FROM connected_bank_accounts WHERE id='40000000-0000-0000-0000-000000000011';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM connected_bank_account_secrets) THEN RAISE EXCEPTION 'Finance history prevented credential erasure'; END IF;
 IF NOT EXISTS(SELECT 1 FROM finance_source_bindings WHERE id='50000000-0000-0000-0000-000000000011' AND verification_state='revoked') THEN RAISE EXCEPTION 'Historical source erased'; END IF;
END $$;
SELECT public.fixture_expect_error($q$INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,plaid_account_anchor_id,environment,source_namespace) VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','plaid','40000000-0000-0000-0000-000000000011','sandbox','test-erased-account')$q$,'42501');
ROLLBACK;
INSERT INTO tenants(id,status) VALUES('20000000-0000-0000-0000-000000000003','active');
UPDATE tenants SET parent_tenant_id='20000000-0000-0000-0000-000000000003' WHERE id='20000000-0000-0000-0000-000000000001';
INSERT INTO agency_team_members VALUES('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','agency_specialist','active',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
-- Match the real agency switch: a persistent child admin seat, not a member seat.
UPDATE tenant_members SET role='admin' WHERE user_id='10000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000003',false);
SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001');
RESET ROLE;
UPDATE agency_team_members SET status='inactive';
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
UPDATE agency_team_members SET status='active';
UPDATE tenants SET archived_at=now() WHERE id='20000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
UPDATE tenants SET archived_at=NULL WHERE id='20000000-0000-0000-0000-000000000003';
DELETE FROM agency_team_members;
SET ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'42501');
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',false);
RESET ROLE;
-- Oversized catalogs refuse explicitly rather than presenting truncated account coverage.
BEGIN;
INSERT INTO finance_company_entities(id,tenant_id,kind,legal_name,identity_basis,identity_reference,declared_by,updated_by)
 SELECT format('30000000-0000-0000-0001-%s',lpad(i::text,12,'0'))::uuid,'20000000-0000-0000-0000-000000000001','managed_entity','Test bounded company','owner_declaration','test-bound-'||i,'10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001' FROM generate_series(1,201) i;
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'54000');
ROLLBACK;
BEGIN;
INSERT INTO quickbooks_connections SELECT format('40000000-0000-0000-0001-%s',lpad(i::text,12,'0'))::uuid,'10000000-0000-0000-0000-000000000001',true FROM generate_series(1,1001) i;
INSERT INTO finance_source_bindings(tenant_id,entity_id,provider,quickbooks_connection_id,environment,source_namespace)
 SELECT '20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','quickbooks',format('40000000-0000-0000-0001-%s',lpad(i::text,12,'0'))::uuid,'sandbox','test-catalog-realm-'||i FROM generate_series(1,1001) i;
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.read_finance_source_catalog('20000000-0000-0000-0000-000000000001')$q$,'54000');
ROLLBACK;
