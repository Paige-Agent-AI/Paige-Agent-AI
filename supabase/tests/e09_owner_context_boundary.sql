-- Original owner read, real Auth roles, synthetic records and outer rollback only.
-- No customer login, provider, publication, send, role activation or production fixture.
BEGIN;
SELECT plan(22);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data) VALUES
 ('e0980100-0000-4000-8000-000000000001','authenticated','authenticated','context-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}','{}'),
 ('e0980100-0000-4000-8000-000000000002','authenticated','authenticated','context-staff@tests.invalid',now(),'{"comms_provider_execution":"disabled"}','{}'),
 ('e0980100-0000-4000-8000-000000000003','authenticated','authenticated','context-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}','{}'),
 ('e0980100-0000-4000-8000-000000000004','authenticated','authenticated','context-label@tests.invalid',now(),'{"comms_provider_execution":"disabled"}','{"role":"owner"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,features,brand) VALUES
 ('e0980200-0000-4000-8000-000000000001','test-tenant-owner-context-a','Northwind Studio','active','standalone','{"playbook_config":{"persona":{"name":"Private A","domain":"internal A"}}}','{"business_brief":{"internal":"A"}}'),
 ('e0980200-0000-4000-8000-000000000002','test-tenant-owner-context-b','Harbor Lane Advisors','active','standalone','{"finance_in_scope":true,"playbook_config":{"persona":{"name":"Private B","domain":"internal B"}}}','{"business_brief":{"internal":"B"}}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0980200-0000-4000-8000-000000000001','e0980100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0980200-0000-4000-8000-000000000002','e0980100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0980200-0000-4000-8000-000000000002','e0980100-0000-4000-8000-000000000002','admin','active',false,now());
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0980300-0000-4000-8000-000000000002','e0980200-0000-4000-8000-000000000001','e0980100-0000-4000-8000-000000000002','e0980100-0000-4000-8000-000000000001','Casey','Morgan','active'),
 ('e0980300-0000-4000-8000-000000000003','e0980200-0000-4000-8000-000000000001','e0980100-0000-4000-8000-000000000003','e0980100-0000-4000-8000-000000000001','Jordan','Rivera','active');
UPDATE public.profiles SET active_tenant_id='e0980200-0000-4000-8000-000000000001'
 WHERE user_id='e0980100-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e0980200-0000-4000-8000-000000000002'
 WHERE user_id='e0980100-0000-4000-8000-000000000002';
CREATE FUNCTION pg_temp.context_as(actor uuid,statement text,hint uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE answer jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('request.headers',CASE WHEN hint IS NULL THEN '{}' ELSE jsonb_build_object('x-client-portal-business',hint)::text END,true);
 SET LOCAL ROLE authenticated;
 BEGIN EXECUTE statement INTO answer; EXCEPTION WHEN OTHERS THEN answer:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true); PERFORM set_config('request.headers','{}',true); RETURN answer;
END $test$;
CREATE FUNCTION pg_temp.owner_context(actor uuid,hint uuid DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $test$
 SELECT pg_temp.context_as(actor,'SELECT to_jsonb(p) FROM public.get_paige_persona_context() p',hint) $test$;

SELECT ok(pg_temp.owner_context('e0980100-0000-4000-8000-000000000003') IS NULL,'a customer relationship does not supply owner context');
SELECT ok(pg_temp.owner_context('e0980100-0000-4000-8000-000000000004') IS NULL,'untrusted role metadata supplies no owner standing');
SELECT throws_ok($attempt$UPDATE public.profiles SET active_tenant_id='e0980200-0000-4000-8000-000000000001' WHERE user_id='e0980100-0000-4000-8000-000000000003'$attempt$,
 '42501','active_tenant_id must be a tenant you belong to or manage','original profile guard refuses a customer-only staff-workspace pointer');
SELECT throws_ok($attempt$UPDATE public.profiles SET active_tenant_id='e0980200-0000-4000-8000-000000000001' WHERE user_id='e0980100-0000-4000-8000-000000000004'$attempt$,
 '42501','active_tenant_id must be a tenant you belong to or manage','a forged owner label cannot bypass the original profile guard');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000001')->>'tenant_id','e0980200-0000-4000-8000-000000000001','owner reads original active workspace A');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000001')#>>'{playbook_config,persona,domain}','internal A','owner retains its authorized private Playbook');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000002')->>'tenant_id','e0980200-0000-4000-8000-000000000002','staff workspace B wins over a separate customer relationship A');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000002')#>>'{brand,business_brief,internal}','B','staff retains only its original workspace business brief');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000001')->>'funding_enabled','false','original unentitled owner finance expression remains false');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000002')->>'funding_enabled','true','original explicit owner finance fact remains true');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.owner_context('e0980100-0000-4000-8000-000000000001')) k),ARRAY['brand','funding_enabled','playbook_config','playbook_slug','tenant_id','tenant_name'],'original six-field owner projection is preserved');
SELECT ok(pg_temp.owner_context(NULL) IS NULL,'missing subject yields no owner context');
SELECT ok(pg_temp.owner_context('e0980100-0000-4000-8000-000000000003','e0980200-0000-4000-8000-000000000001') IS NULL,'customer hint cannot grant owner standing');
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000002','e0980200-0000-4000-8000-000000000001')->>'tenant_id','e0980200-0000-4000-8000-000000000002','customer hint cannot replace original authorized staff workspace');
SELECT is(pg_temp.context_as('e0980100-0000-4000-8000-000000000003','SELECT public.client_portal_frame()')#>>'{profile,tenant_id}','e0980200-0000-4000-8000-000000000001','original customer frame remains available');
UPDATE public.profiles SET active_tenant_id='e0980200-0000-4000-8000-000000000002' WHERE user_id='e0980100-0000-4000-8000-000000000001';
SELECT is(pg_temp.owner_context('e0980100-0000-4000-8000-000000000001')->>'tenant_id','e0980200-0000-4000-8000-000000000002','owner switch follows canonical authorized active workspace');
DELETE FROM public.tenant_members WHERE tenant_id='e0980200-0000-4000-8000-000000000002' AND user_id='e0980100-0000-4000-8000-000000000002';
SELECT ok(pg_temp.owner_context('e0980100-0000-4000-8000-000000000002') IS NULL,'revoked staff membership cannot fall back to its customer business');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.current_user_tenant_id()'::regprocedure),'f16384fd81d48901441185bec66f939f','original staff authority resolver is unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.get_paige_persona_context()'::regprocedure),'39cb7d0fc5b50f669c3cc049e98971f9','exact reviewed owner-context body is installed');
SELECT ok(has_function_privilege('authenticated','public.get_paige_persona_context()','EXECUTE') AND NOT has_function_privilege('anon','public.get_paige_persona_context()','EXECUTE') AND NOT has_function_privilege('service_role','public.get_paige_persona_context()','EXECUTE'),'original effective execution permissions are unchanged');
SELECT ok((SELECT prosecdef AND provolatile='s' AND pg_get_userbyid(proowner)='postgres' AND proconfig=ARRAY['search_path=public']::text[] FROM pg_proc WHERE oid='public.get_paige_persona_context()'::regprocedure),'original owner, stability, definer and search path are unchanged');
SELECT ok(EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique),'original global customer linkage restriction remains installed');
SELECT * FROM finish();
ROLLBACK;
