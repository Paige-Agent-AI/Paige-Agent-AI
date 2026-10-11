\set ON_ERROR_STOP on
\ir finance_source_authority.sql
SELECT set_config('test.refuse_receipt','',false);
-- Canonical JWT claim dependency shape, in this disposable database only.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('test.actor',true),''))::uuid
$$;
\if :apply_quickbooks_migration
\ir ../migrations/20270602000436_quickbooks_company_oauth_attempts.sql
\endif
CREATE TABLE public.fixture_qb_result(value jsonb);
GRANT ALL ON fixture_qb_result TO authenticated,service_role;
CREATE FUNCTION public.fixture_qb_prepare() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 DELETE FROM fixture_qb_result;
 INSERT INTO fixture_qb_result SELECT public.begin_quickbooks_company_authorization('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'sandbox');
END $$;
CREATE FUNCTION public.fixture_qb_input() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('attempt_id',value->>'attempt_id','state_hash',encode(sha256(convert_to(value->>'state','UTF8')),'hex'),
  'launch_hash',encode(sha256(convert_to(value->>'launch_ticket','UTF8')),'hex'),'launch_proof_hash',encode(sha256(convert_to(value->>'launch_proof','UTF8')),'hex'),'binding_hash',repeat('c',64)) FROM fixture_qb_result
$$;
SET ROLE authenticated;
SELECT public.fixture_qb_prepare();
SELECT public.fixture_expect_error($q$SELECT count(*) FROM public.quickbooks_oauth_attempts$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume','{}')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.begin_quickbooks_company_authorization('20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001',1,'sandbox')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.begin_quickbooks_company_authorization('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',1,'sandbox')$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.begin_quickbooks_company_authorization('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',2,'sandbox')$q$,'40001');
SELECT public.fixture_expect_error($q$SELECT public.begin_quickbooks_company_authorization('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'other')$q$,'22023');
RESET ROLE;
DO $$ DECLARE result jsonb; BEGIN
 SELECT value INTO result FROM fixture_qb_result;
 IF result->>'requested_scope'<>'com.intuit.quickbooks.accounting' OR (result->>'provider_connected')::boolean THEN RAISE EXCEPTION 'Prepared consent claimed provider/payment authority'; END IF;
 IF EXISTS(SELECT 1 FROM quickbooks_oauth_attempts WHERE state_hash=result->>'state' OR launch_hash=result->>'launch_ticket') THEN RAISE EXCEPTION 'Raw nonce persisted'; END IF;
END $$;
SET ROLE service_role;
SELECT public.fixture_expect_error('INSERT INTO quickbooks_oauth_attempts SELECT * FROM quickbooks_oauth_attempts WHERE false','42501');
SELECT public.fixture_expect_error('UPDATE quickbooks_oauth_attempts SET status=status WHERE false','42501');
SELECT public.fixture_expect_error('DELETE FROM quickbooks_oauth_attempts WHERE false','42501');
RESET ROLE;
SELECT set_config('test.paused_receipt_count',(SELECT count(*) FROM fixture_receipts)::text,false);
BEGIN;
UPDATE tenants SET lifecycle_execution_paused=true WHERE id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error('SELECT public.fixture_qb_prepare()','42501');
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM fixture_receipts)::text<>current_setting('test.paused_receipt_count')
  OR (SELECT count(*) FROM quickbooks_oauth_attempts)<>1 OR (SELECT status FROM quickbooks_oauth_attempts)<>'pending' THEN
  RAISE EXCEPTION 'Paused preparation changed prior attempt or receipt'; END IF;
END $$;
ROLLBACK;
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('launch',public.fixture_qb_input()||jsonb_build_object('launch_proof_hash',repeat('d',64)))$q$,'42501');
SELECT public.quickbooks_oauth_attempt_service('launch',public.fixture_qb_input());
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('launch',public.fixture_qb_input())$q$,'42501');
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input()||jsonb_build_object('binding_hash',repeat('d',64)))$q$,'42501');
RESET ROLE;
-- Actor/workspace/company changes cannot be bypassed by an otherwise valid nonce.
BEGIN;
UPDATE tenant_members SET status='inactive' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE profiles SET active_tenant_id='20000000-0000-0000-0000-000000000002' WHERE user_id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE auth.users SET banned_until=now()+interval '1 day' WHERE id='10000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE tenants SET lifecycle_execution_paused=true WHERE id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
ROLLBACK;
BEGIN;
UPDATE finance_company_entities SET version=version+1 WHERE id='30000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'40001');
ROLLBACK;
SET ROLE service_role;
SELECT set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',false);
SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input());
DO $$ BEGIN IF current_setting('request.jwt.claim.sub')<>'10000000-0000-0000-0000-000000000003' THEN RAISE EXCEPTION 'Stored-actor check leaked claims'; END IF; END $$;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'42501');
SELECT public.quickbooks_oauth_attempt_service('validate_exchange',public.fixture_qb_input());
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('finish',public.fixture_qb_input()||jsonb_build_object('outcome','succeeded'))$q$,'42501');
SELECT public.quickbooks_oauth_attempt_service('finish',public.fixture_qb_input()||jsonb_build_object('outcome','failed'));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','',false);
SELECT public.fixture_expect_error($q$UPDATE quickbooks_oauth_attempts SET actor_id='10000000-0000-0000-0000-000000000002'$q$,'42501');
SELECT public.fixture_expect_error($q$UPDATE quickbooks_oauth_attempts SET status='pending'$q$,'40001');
-- Receipt refusal rolls back preparation and preserves the prior attempt state.
BEGIN;
SELECT set_config('test.refuse_receipt','yes',true);
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.fixture_qb_prepare()$q$,'P0001');
ROLLBACK;
DO $$ BEGIN IF (SELECT count(*) FROM quickbooks_oauth_attempts)<>1 THEN RAISE EXCEPTION 'OAuth attempt survived failed receipt'; END IF; END $$;
INSERT INTO quickbooks_oauth_attempts(tenant_id,entity_id,entity_version,actor_id,environment,state_hash,launch_hash,launch_proof_hash,binding_hash,status,created_at,expires_at)
 VALUES('20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'10000000-0000-0000-0000-000000000001','sandbox',repeat('1',64),repeat('2',64),repeat('3',64),repeat('c',64),'launched',clock_timestamp()-interval '20 minutes',clock_timestamp()-interval '10 minutes');
SET ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',jsonb_build_object('state_hash',repeat('1',64),'binding_hash',repeat('c',64)))$q$,'42501');
RESET ROLE;
SET ROLE authenticated;
SELECT public.fixture_qb_prepare();
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM quickbooks_oauth_attempts WHERE status='pending')<>1 OR EXISTS(SELECT 1 FROM quickbooks_oauth_attempts WHERE status='launched') THEN RAISE EXCEPTION 'Replacement consent did not cancel old attempt'; END IF;
 IF has_function_privilege('authenticated','public.quickbooks_oauth_attempt_service(text,jsonb)','EXECUTE') OR has_function_privilege('anon','public.begin_quickbooks_company_authorization(uuid,uuid,bigint,text)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected OAuth authority principal'; END IF;
END $$;
SET ROLE service_role;
SELECT public.quickbooks_oauth_attempt_service('launch',public.fixture_qb_input());
RESET ROLE;
BEGIN;
UPDATE tenants SET brand=jsonb_set(brand,'{business_brief,legalName}','"Other Company"') WHERE id='20000000-0000-0000-0000-000000000001';
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',public.fixture_qb_input())$q$,'40001');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT public.fixture_expect_error($q$SELECT public.fixture_qb_prepare()$q$,'40001');
ROLLBACK;
BEGIN;
INSERT INTO auth.users VALUES('10000000-0000-0000-0000-000000000990',NULL,NULL);
INSERT INTO quickbooks_oauth_attempts(id,tenant_id,entity_id,entity_version,actor_id,environment,state_hash,launch_hash,launch_proof_hash,binding_hash,status)
 VALUES('70000000-0000-0000-0000-000000000990','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',1,'10000000-0000-0000-0000-000000000990','sandbox',repeat('d',64),repeat('e',64),repeat('f',64),repeat('a',64),'launched');
SELECT public.fixture_expect_error($q$UPDATE quickbooks_oauth_attempts SET actor_id=NULL WHERE id='70000000-0000-0000-0000-000000000990'$q$,'42501');
DELETE FROM auth.users WHERE id='10000000-0000-0000-0000-000000000990';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM quickbooks_oauth_attempts WHERE id='70000000-0000-0000-0000-000000000990' AND actor_id IS NULL AND status='launched') THEN RAISE EXCEPTION 'Auth erasure changed consent history'; END IF;
END $$;
SET LOCAL ROLE service_role;
SELECT public.fixture_expect_error($q$SELECT public.quickbooks_oauth_attempt_service('consume',jsonb_build_object('state_hash',repeat('d',64),'binding_hash',repeat('a',64)))$q$,'42501');
SELECT public.fixture_expect_error($q$DELETE FROM quickbooks_oauth_attempts WHERE id='70000000-0000-0000-0000-000000000990'$q$,'42501');
RESET ROLE;
INSERT INTO user_roles VALUES('10000000-0000-0000-0000-000000000001','platform_admin');
INSERT INTO operator_account_archives VALUES('90000000-0000-0000-0000-000000000991','archived',ARRAY['20000000-0000-0000-0000-000000000001'::uuid]);
UPDATE tenants SET archived_at=now(),lifecycle_execution_paused=true,archive_operation_id='90000000-0000-0000-0000-000000000991' WHERE id='20000000-0000-0000-0000-000000000001';
SELECT set_config('test.actor','10000000-0000-0000-0000-000000000001',true);
SELECT public.fixture_expect_error($q$DELETE FROM quickbooks_oauth_attempts WHERE id='70000000-0000-0000-0000-000000000990'$q$,'42501');
UPDATE operator_account_archives SET state='deleting';
DELETE FROM quickbooks_oauth_attempts WHERE id='70000000-0000-0000-0000-000000000990';
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM quickbooks_oauth_attempts WHERE id='70000000-0000-0000-0000-000000000990')
  OR public.operator_retirement_disposition('quickbooks_oauth_attempts')<>'delete'
  OR public.operator_retirement_disposition('profiles')<>'preserve' THEN RAISE EXCEPTION 'Consent retirement disposition mismatch'; END IF;
END $$;
ROLLBACK;
SELECT 'QuickBooks OAuth authority PASS: nonce correlation only; no provider, tokens, connection or authenticated production acceptance' AS result;
