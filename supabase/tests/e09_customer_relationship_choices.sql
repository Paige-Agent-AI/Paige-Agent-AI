-- Real original native resolver/brand and authenticated roles; synthetic fixture,
-- no permanent identities, provider effect or production auth impersonation.
BEGIN;
SELECT plan(28);

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

-- Current production permits one linked client per login globally. Prove that
-- guard before exercising the explicitly future shape, only in this rollback.
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'actual global unique linkage exists before the future-shape fixture');
SELECT throws_ok($guard$ INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0960300-0000-4000-8000-000000000002','e0960200-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000002','e0960100-0000-4000-8000-000000000001','Jordan','Rivera','active'); $guard$,'23505',NULL,'current native global guard refuses a second business link');
DROP INDEX public.clients_linked_user_id_unique;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique),'future fixture retains original within-business uniqueness');
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
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='open' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT set_config('paige.portal_access_write','',true);
UPDATE public.clients SET status='archived' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),1,'archived original relationship never appears');
UPDATE public.clients SET status='active' WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),2,'restored legitimate original relation returns without another identity');
SELECT set_config('paige.link_ok','1',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0960300-0000-4000-8000-000000000002';
SELECT set_config('paige.link_ok','',true);
SELECT is(jsonb_array_length(pg_temp.choices()->'relationships'),1,'ended/unlinked original relationship is absent without changing another business');
SELECT ok(has_function_privilege('authenticated','public.client_portal_relationship_choices(integer,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_relationship_choices(integer,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_relationship_choices(integer,uuid)','EXECUTE'),'authenticated-only execution; no anonymous/service grant');

CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'future fixture restores the original global guard before outer rollback');

SELECT * FROM finish();
ROLLBACK;
