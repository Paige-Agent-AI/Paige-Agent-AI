-- Real original native resolver/brand and authenticated roles; synthetic fixture,
-- no permanent identities, provider effect or production auth impersonation.
BEGIN;
SELECT plan(61);

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0960100-0000-4000-8000-000000000001','authenticated','authenticated','choices-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0960100-0000-4000-8000-000000000002','authenticated','authenticated','choices-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0960100-0000-4000-8000-000000000003','authenticated','authenticated','choices-other@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0960100-0000-4000-8000-000000000004','authenticated','authenticated','choices-none@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,features) VALUES
 ('e0960200-0000-4000-8000-000000000001','test-tenant-choices-a','Northwind Studio','active','standalone','{}'),
 ('e0960200-0000-4000-8000-000000000002','test-tenant-choices-b','Harbor Lane Advisors','active','standalone','{}'),
 ('e0960200-0000-4000-8000-000000000003','test-tenant-choices-c','Other Business','active','standalone','{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at)
 SELECT id,'e0960100-0000-4000-8000-000000000001','owner','active',true,now()
 FROM public.tenants WHERE slug LIKE 'test-tenant-choices-%';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0960300-0000-4000-8000-000000000001','e0960200-0000-4000-8000-000000000001','e0960100-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0960300-0000-4000-8000-000000000003','e0960200-0000-4000-8000-000000000003','e0960100-0000-4000-8000-000000000003','e0960100-0000-4000-8000-000000000001','Casey','Morgan','active');

-- Current native multi-business shape; prove duplicate contacts within one
-- business still fail, while distinct businesses use the genuine schema.
SELECT ok(to_regclass('public.clients_linked_user_id_unique') IS NULL AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_tenant_linked_user_key ON public.clients USING btree (tenant_id, linked_user_id)') AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_lookup_idx') AND NOT indisunique AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE INDEX clients_linked_user_lookup_idx ON public.clients USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL)'),'Native63 current per-business uniqueness and indexed user lookup phase 1');
SELECT throws_ok($guard$ INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0960300-0000-4000-8000-000000000002','e0960200-0000-4000-8000-000000000001','e0960100-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000001','Jordan','Rivera','active'); $guard$,'23505',NULL,'original per-business constraint refuses a duplicate contact for the same login');
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique),'current schema retains original within-business uniqueness');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0960300-0000-4000-8000-000000000002','e0960200-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000001','Jordan','Rivera','active');

CREATE FUNCTION pg_temp.as_user(actor uuid,statement text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN EXECUTE statement INTO answer;
 EXCEPTION WHEN OTHERS THEN answer:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true); RETURN answer;
END $$;
CREATE FUNCTION pg_temp.choices(statement text DEFAULT 'SELECT public.client_portal_relationship_choices()')
RETURNS jsonb LANGUAGE sql AS $$
 SELECT pg_temp.as_user('e0960100-0000-4000-8000-000000000002',statement) $$;


-- Original returning-business projection, local synthetic transaction only.
CREATE FUNCTION pg_temp.portal_return(p_slug text,actor uuid DEFAULT 'e0960100-0000-4000-8000-000000000002',headers text DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE answer jsonb;
BEGIN
 PERFORM set_config('request.headers',headers,true);
 answer:=pg_temp.as_user(actor,format('SELECT public.client_portal_entry_for_slug(%L)',p_slug));
 PERFORM set_config('request.headers','{}',true);
 RETURN answer;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.headers','{}',true);
 RAISE;
END $$;
SELECT is((SELECT md5(replace(replace(prosrc,'v_business := p_business;','v_business := public._client_portal_request_business();'),'public.client_portal_relationship_id(v_business);','public.client_portal_relationship_id(NULL);')) FROM pg_proc WHERE oid='public._client_portal_access_projection(uuid)'::regprocedure),'3be0d887895d6ebefa34fbd6b29f431a','private projection inverse reproduces every original S7 source branch');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='s' AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public._client_portal_access_projection(uuid)'::regprocedure) AND NOT has_function_privilege('authenticated','public._client_portal_access_projection(uuid)','EXECUTE') AND NOT has_function_privilege('anon','public._client_portal_access_projection(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public._client_portal_access_projection(uuid)','EXECUTE'),'factored original projection stays private with an empty search path');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='s' AND pronargs=0 AND proconfig=ARRAY['search_path=""'] AND pg_get_function_result(oid)='jsonb' FROM pg_proc WHERE oid='public.client_portal_access_state()'::regprocedure) AND has_function_privilege('authenticated','public.client_portal_access_state()','EXECUTE') AND has_function_privilege('service_role','public.client_portal_access_state()','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_access_state()','EXECUTE'),'original public access-state ABI/security/permissions preserved');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_self_profile(uuid)'::regprocedure),'090fd2f8ef6f29ddf8091be7cbd6db7d','original authoritative profile is unchanged');
SELECT is((SELECT md5(replace(replace(prosrc,'_uid uuid := p_actor_id;','_uid uuid := auth.uid();'),
 '_business := CASE WHEN p_use_request_business THEN public._client_portal_request_business() ELSE NULL::uuid END;',
 '_business := public._client_portal_request_business();')) FROM pg_proc WHERE oid='public._client_portal_relationship_for_actor(uuid,uuid,boolean)'::regprocedure AND (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_relationship_id(uuid)'::regprocedure)='4529aa68b6a624d557a307c7d9098bcb'),'ff84ba24689e5043d7d15ed3d9150268','original relationship authority inverse and exact Auth-bound wrapper are unchanged');
SELECT ok(has_function_privilege('authenticated','public.client_portal_entry_for_slug(text)','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_entry_for_slug(text)','EXECUTE') AND NOT has_function_privilege('service_role','public.client_portal_entry_for_slug(text)','EXECUTE'),'new minimal entry projection is authenticated-only');
SELECT is(pg_temp.portal_return('test-tenant-choices-a')->>'tenant_id','e0960200-0000-4000-8000-000000000001','saved A portal resolves actual own A despite two legitimate relationships');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'tenant_id','e0960200-0000-4000-8000-000000000002','saved B portal resolves actual own B, never LIMIT1 A');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'actor_id','e0960100-0000-4000-8000-000000000002','entry identifies actual Auth subject, not an input actor field');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'state','open','open state comes from original exact-business native profile');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.portal_return('test-tenant-choices-b')) k),ARRAY['actor_id','contract_version','state','tenant_id','tenant_slug'],'closed entry metadata excludes CRM/private AI/Knowledge/financial/contact fields');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'contract_version','1','closed entry version');
SELECT is(pg_temp.portal_return(' TEST-TENANT-CHOICES-B ')->>'tenant_slug','test-tenant-choices-b','normalization matches original public brand lower/trim semantics');
SELECT is(pg_temp.portal_return('test-tenant-choices-b'),pg_temp.portal_return('test-tenant-choices-b'),'ordinary returning read is stable, not a new work or visit receipt');
SELECT ok(pg_temp.portal_return('test-tenant-choices-c') IS NULL,'public foreign business slug supplies no membership or notice');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000003') IS NULL,'another actual customer cannot reuse an entry business');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000001') IS NULL,'business owner role supplies no customer relationship');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000004') IS NULL,'unlinked actual Auth subject cannot enter by slug');
SELECT is(pg_temp.portal_return('test-tenant-choices-b',NULL)->>'sqlstate','42501','no actual subject is refused');
SELECT ok(pg_temp.portal_return('unknown-test-business') IS NULL,'unknown slug returns no business pointer');
SELECT ok(pg_temp.portal_return(NULL) IS NULL AND pg_temp.portal_return('  ') IS NULL,'null or blank slug does not select a business');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000002','{"x-client-portal-business":"e0960200-0000-4000-8000-000000000001"}') IS NULL,'conflicting current business hint never yields another business entry');
SELECT is(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000002','{"x-client-portal-business":"e0960200-0000-4000-8000-000000000002"}')->>'tenant_id','e0960200-0000-4000-8000-000000000002','matching narrow business hint preserves actual B');
SELECT is(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000002','{"x-client-portal-business":"invalid"}')->>'sqlstate','42501','invalid hint cannot fall through to public slug lookup');
SELECT is(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000002','[]')->>'sqlstate','42501','invalid header envelope refuses');
SELECT is(pg_temp.choices('SELECT public._client_portal_access_projection(''e0960200-0000-4000-8000-000000000002'')')->>'sqlstate','42501','customer cannot call the internal projection directly');
UPDATE public.tenants SET status='suspended' WHERE id='e0960200-0000-4000-8000-000000000002';
SELECT ok(pg_temp.portal_return('test-tenant-choices-b') IS NULL,'inactive business supplies no active client entry');
UPDATE public.tenants SET status='active' WHERE id='e0960200-0000-4000-8000-000000000002';

SELECT is(pg_temp.choices()->>'contract_version','1','closed contract version');
SELECT is(pg_temp.choices()->>'actor_id','e0960100-0000-4000-8000-000000000002','actor is actual Auth subject');
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),2,'both own active business relationships resolve');
SELECT is(pg_temp.choices()->'relationships'->0->>'client_id','e0960300-0000-4000-8000-000000000001','stable original relationship identity');
SELECT is(pg_temp.choices()->'relationships'->1->>'business_name','Harbor Lane Advisors','original business brand');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.choices()) k),
 ARRAY['actor_id','contract_version','has_more','next_after','relationships'],'exact top-level allowlist');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.choices()->'relationships'->0) k),
 ARRAY['business_name','client_id','logo_dark_url','logo_url','tenant_id'],'no private CRM, role, financial, Knowledge or conversation fields');
SELECT is(pg_temp.as_user('e0960100-0000-4000-8000-000000000003','SELECT public.client_portal_relationship_choices()')->'relationships'->0->>'client_id',
 'e0960300-0000-4000-8000-000000000003','other customer reads only own relationship');
SELECT is(jsonb_array_length(pg_temp.as_user('e0960100-0000-4000-8000-000000000004','SELECT public.client_portal_relationship_choices()')->'relationships'),0,'no email or role fallback for unlinked caller');
SELECT is(jsonb_array_length(pg_temp.as_user('e0960100-0000-4000-8000-000000000001','SELECT public.client_portal_relationship_choices()')->'relationships'),0,'business owner membership supplies no customer identity');
SELECT is(pg_temp.as_user(NULL,'SELECT public.client_portal_relationship_choices()')->>'sqlstate','42501','no subject refused');
SELECT is(pg_temp.choices('SELECT public.client_portal_relationship_choices(0)')->>'sqlstate','22023','invalid lower page bound refused');
SELECT is(pg_temp.choices('SELECT public.client_portal_relationship_choices(51)')->>'sqlstate','22023','invalid upper page bound refused');
SELECT is(pg_temp.choices('SELECT public.client_portal_relationship_choices(NULL)')->>'sqlstate','22023','null bound is not unbounded');
SELECT ok((pg_temp.choices('SELECT public.client_portal_relationship_choices(1)')->>'has_more')::boolean
 AND pg_temp.choices('SELECT public.client_portal_relationship_choices(1)')->>'next_after'='e0960300-0000-4000-8000-000000000001','bounded first page keeps exact original cursor');
SELECT is(pg_temp.choices('SELECT public.client_portal_relationship_choices(1,''e0960300-0000-4000-8000-000000000001'')')->'relationships'->0->>'client_id',
 'e0960300-0000-4000-8000-000000000002','next page neither repeats nor skips own relationship');
SELECT is(pg_temp.choices('SELECT to_jsonb(public.client_portal_relationship_id())')->>'sqlstate','42501','listing choices does not silently select or relax original ambiguity refusal');
SELECT is(pg_temp.choices('SELECT to_jsonb(public.client_portal_relationship_id(''e0960200-0000-4000-8000-000000000002''))'),
 to_jsonb('e0960300-0000-4000-8000-000000000002'::text),'original explicit-business resolver is unchanged');
SELECT is(jsonb_array_length(pg_temp.choices('SELECT public.client_portal_relationship_choices(20,''e0960300-0000-4000-8000-000000000003'')')->'relationships'),0,'foreign cursor cannot expose another customer');

SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='paused' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT set_config('paige.portal_access_write','',true);
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),1,'paused relationship disappears on a fresh native read');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'state','paused','saved B link preserves original own paused notice while A remains active');
SELECT is(pg_temp.portal_return('test-tenant-choices-a')->>'state','open','paused B never overrides legitimate A portal');

SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='open' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT set_config('paige.portal_access_write','',true);
UPDATE public.clients SET status='archived' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),1,'archived original relationship never appears');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b') IS NULL,'archived contact cannot enter by a public business link');

UPDATE public.clients SET status='active' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),2,'restored legitimate original relation returns without another identity');
SELECT set_config('paige.link_ok','1',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT set_config('paige.link_ok','',true);
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),1,'ended/unlinked original relationship is absent without changing another business');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'state','ended','saved B link preserves original own ended notice while A remains active');
SELECT is(pg_temp.portal_return('test-tenant-choices-b')->>'tenant_id','e0960200-0000-4000-8000-000000000002','ended notice remains explicitly bound to requested B');
SELECT ok(pg_temp.portal_return('test-tenant-choices-b','e0960100-0000-4000-8000-000000000003') IS NULL,'ended notice never belongs to another current subject');

SELECT ok(has_function_privilege('authenticated','public.client_portal_relationship_choices(integer,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_relationship_choices(integer,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_relationship_choices(integer,uuid)','EXECUTE'),'authenticated-only execution; no anonymous/service grant');

SELECT ok(to_regclass('public.clients_linked_user_id_unique') IS NULL AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE UNIQUE INDEX clients_tenant_linked_user_key ON public.clients USING btree (tenant_id, linked_user_id)') AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_lookup_idx') AND NOT indisunique AND indisvalid AND indisready AND pg_get_indexdef(indexrelid)='CREATE INDEX clients_linked_user_lookup_idx ON public.clients USING btree (linked_user_id) WHERE (linked_user_id IS NOT NULL)'),'Native63 current per-business uniqueness and indexed user lookup phase 2');

SELECT * FROM finish();
ROLLBACK;
