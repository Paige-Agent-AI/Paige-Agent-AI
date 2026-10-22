-- Original replayed native functions and real roles. Synthetic, rolled back;
-- provider execution disabled, no production identities or effectful acceptance.
BEGIN;
SELECT plan(39);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0970100-0000-4000-8000-000000000001','authenticated','authenticated','scope-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0970100-0000-4000-8000-000000000002','authenticated','authenticated','scope-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0970100-0000-4000-8000-000000000003','authenticated','authenticated','scope-other@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,features) VALUES
 ('e0970200-0000-4000-8000-000000000001','test-tenant-scope-a','Northwind Studio','active','standalone','{"portal_config":{"welcome":"Welcome A"}}'),
 ('e0970200-0000-4000-8000-000000000002','test-tenant-scope-b','Harbor Lane Advisors','active','standalone','{"portal_config":{"welcome":"Welcome B"}}'),
 ('e0970200-0000-4000-8000-000000000003','test-tenant-scope-c','Other Business','active','standalone','{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 SELECT id,'e0970100-0000-4000-8000-000000000001','owner','active',true,now()
 FROM public.tenants WHERE slug LIKE 'test-tenant-scope-%';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0970300-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','e0970100-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0970300-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0970300-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000001','Casey','Morgan','active');

CREATE FUNCTION pg_temp.as_scope_user(actor uuid,statement text,headers text DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 PERFORM set_config('request.headers',headers,true);
 SET LOCAL ROLE authenticated;
 BEGIN EXECUTE statement INTO answer;
 EXCEPTION WHEN OTHERS THEN answer:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 PERFORM set_config('request.headers','{}',true);
 RETURN answer;
END $$;
CREATE FUNCTION pg_temp.scope_read(statement text,business text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000002',statement,
  CASE WHEN business IS NULL THEN '{}' ELSE jsonb_build_object('x-client-portal-business',business)::text END) $$;

SELECT is(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id())')->>'sqlstate','42501','no header retains original ambiguity refusal');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()')->>'state','multiple','no header retains original multiple state');
SELECT is(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id(''e0970200-0000-4000-8000-000000000002''))'),
 to_jsonb('e0970300-0000-4000-8000-000000000002'::text),'legacy explicit argument remains compatible');
SELECT is(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id())','e0970200-0000-4000-8000-000000000001'),
 to_jsonb('e0970300-0000-4000-8000-000000000001'::text),'hint A resolves only actual own A');
SELECT is(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id())','e0970200-0000-4000-8000-000000000002'),
 to_jsonb('e0970300-0000-4000-8000-000000000002'::text),'hint B resolves only actual own B');
SELECT ok(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id())','e0970200-0000-4000-8000-000000000003') IS NULL,'foreign hint grants no relationship');
SELECT ok(pg_temp.scope_read('SELECT to_jsonb(public.client_portal_relationship_id(''e0970200-0000-4000-8000-000000000002''))','e0970200-0000-4000-8000-000000000001') IS NULL,'conflicting argument cannot escape selected scope even when both are own');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001')#>>'{profile,id}',
 'e0970300-0000-4000-8000-000000000001','original composed frame carries A identity');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000002')#>>'{brand,tenant_name}',
 'Harbor Lane Advisors','original frame brand follows selected B');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000002')#>>'{config,welcome}',
 'Welcome B','original config follows same B snapshot');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001')) k),
 ARRAY['actor_id','brand','config','profile'],'original closed frame contract unchanged');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000003') IS NULL,'foreign hint cannot obtain a frame');
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001','SELECT public.client_portal_frame()',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'owner role does not become a customer');
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_frame()',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'changed actor cannot reuse prior selection');
SELECT is(pg_temp.as_scope_user(NULL,'SELECT public.client_portal_frame()',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}')->>'sqlstate','42501','selected hint never replaces authentication');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()','not-a-business')->>'sqlstate','42501','invalid hint refuses instead of falling back');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','')->>'sqlstate','42501','blank hint refuses, not multiple or another business');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000002','SELECT public.client_portal_frame()',
 '{"x-client-portal-business":null}')->>'sqlstate','42501','JSON null hint refuses');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000002','SELECT public.client_portal_frame()',
 '{"x-client-portal-business":42}')->>'sqlstate','42501','non-text hint refuses');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000002','SELECT public.client_portal_frame()',
 '[]')->>'sqlstate','42501','invalid header envelope refuses');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000002','SELECT public.client_portal_frame()',
 'broken-json')->>'sqlstate','42501','malformed request metadata refuses');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')->>'state','open','selected open state is genuine');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000003')->>'state','none','foreign state reveals no notice');

UPDATE public.clients SET status='archived' WHERE id='e0970300-0000-4000-8000-000000000001';
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001') IS NULL,'archived A never falls back to open B');
UPDATE public.clients SET status='active' WHERE id='e0970300-0000-4000-8000-000000000001';
UPDATE public.tenants SET status='suspended' WHERE id='e0970200-0000-4000-8000-000000000001';
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001') IS NULL,'inactive business cannot fall back to another business');
UPDATE public.tenants SET status='active' WHERE id='e0970200-0000-4000-8000-000000000001';
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='paused',portal_access_changed_at=now()-interval '1 hour'
 WHERE id='e0970300-0000-4000-8000-000000000001';
UPDATE public.clients SET portal_access_state='paused',portal_access_changed_at=now()
 WHERE id='e0970300-0000-4000-8000-000000000002';
SELECT set_config('paige.portal_access_write','',true);
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001') IS NULL,'paused selection loses original frame');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')#>>'{business,name}',
 'Northwind Studio','selected older pause never names latest other-business pause');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000002')->>'state','paused','selected B pause is named');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()')#>>'{business,name}',
 'Harbor Lane Advisors','unselected legacy latest notice remains compatible');
SELECT set_config('paige.link_ok','1',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0970300-0000-4000-8000-000000000002';
SELECT set_config('paige.link_ok','',true);
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000002')->>'state','ended','selected former user sees genuine ended notice');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000002') IS NULL,'revoked selection cannot obtain another frame');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000003')->>'state','none','foreign hint cannot reveal even own other-business ended notice');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')->>'state','paused','returning A scope remains its own pause after B ends');
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='open' WHERE id='e0970300-0000-4000-8000-000000000001';
SELECT set_config('paige.portal_access_write','',true);
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000001')#>>'{profile,id}',
 'e0970300-0000-4000-8000-000000000001','restoring A reuses original membership');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_frame()')#>>'{profile,id}',
 'e0970300-0000-4000-8000-000000000001','single remaining open relationship keeps original no-header behavior');
SELECT is(pg_temp.scope_read('SELECT to_jsonb(public._client_portal_request_business())')->>'sqlstate','42501','internal parser has no customer execution grant');
SELECT ok(NOT has_function_privilege('anon','public._client_portal_request_business()','EXECUTE')
 AND NOT has_function_privilege('service_role','public._client_portal_request_business()','EXECUTE'),'internal parser has no anonymous or service grant');
SELECT ok(has_function_privilege('authenticated','public.client_portal_frame()','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_frame()','EXECUTE'),'original frame ACL preserved');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_frame()'::regprocedure),
 'b3826e6b52ba34cd40348112b8145883','original frame source unchanged');

SELECT * FROM finish();
ROLLBACK;
