-- Full incumbent catalogue and real tenant authority; synthetic identities, rolled back.
BEGIN;
SELECT no_plan();
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('e0923500-0000-4000-8000-000000000001','test-e09-invite-catalogue-a','Test invitation catalogue A','active','standalone','E09Q',9435001,'{}'),
 ('e0923500-0000-4000-8000-000000000002','test-e09-invite-catalogue-b','Test invitation catalogue B','active','standalone','E09R',9435002,'{}');
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0913500-0000-4000-8000-000000000001','authenticated','authenticated','catalogue-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0913500-0000-4000-8000-000000000002','authenticated','authenticated','catalogue-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0923500-0000-4000-8000-000000000001','e0913500-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0923500-0000-4000-8000-000000000002','e0913500-0000-4000-8000-000000000002','owner','active',true,now());
CREATE FUNCTION pg_temp.invite_catalogue(actor uuid,business uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 SET LOCAL ROLE authenticated;
 BEGIN SELECT jsonb_agg(to_jsonb(c) ORDER BY c.tool_key) INTO result FROM public.list_tool_autonomy(business)c;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE); END;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);PERFORM set_config('request.jwt.claim.sub','',true);
 RETURN result;
END $$;
CREATE TEMP TABLE e09_catalogue_rows AS SELECT pg_temp.invite_catalogue('e0913500-0000-4000-8000-000000000001','e0923500-0000-4000-8000-000000000001') rows;
SELECT is((SELECT count(*) FROM e09_catalogue_rows,jsonb_array_elements(rows)c WHERE c->>'tool_key'='client_portal_invitation_send'),1::bigint,'one visible invitation control');
SELECT is((SELECT c->>'mode' FROM e09_catalogue_rows,jsonb_array_elements(rows)c WHERE c->>'tool_key'='client_portal_invitation_send'),'confirm','missing setting defaults to confirmation');
SELECT is((SELECT c->>'category' FROM e09_catalogue_rows,jsonb_array_elements(rows)c WHERE c->>'tool_key'='client_portal_invitation_send'),'Communications','existing catalogue category');
SELECT ok((SELECT count(*)>100 FROM e09_catalogue_rows,jsonb_array_elements(rows)c),'complete incumbent remains visible');
SELECT is((SELECT count(*) FROM e09_catalogue_rows,jsonb_array_elements(rows)c WHERE c->>'tool_key' IN('knowledge_update','knowledge_delete')),2::bigint,'newer Knowledge controls preserved');
SELECT is((SELECT count(*) FROM public.tenant_tool_autonomy WHERE tool_key='client_portal_invitation_send' AND tenant_id IN('e0923500-0000-4000-8000-000000000001','e0923500-0000-4000-8000-000000000002')),0::bigint,'reading never creates settings or activates a lane');
SELECT is(pg_temp.invite_catalogue('e0913500-0000-4000-8000-000000000001','e0923500-0000-4000-8000-000000000002')->>'sqlstate','42501','wrong business refused by incumbent');
SELECT ok(jsonb_array_length(pg_temp.invite_catalogue('e0913500-0000-4000-8000-000000000002','e0923500-0000-4000-8000-000000000002'))>100,'second legitimate business reads the same complete catalogue');
INSERT INTO public.tenant_tool_autonomy(tenant_id,tool_key,mode) VALUES('e0923500-0000-4000-8000-000000000001','client_portal_invitation_send','off');
SELECT is((SELECT c->>'mode' FROM jsonb_array_elements(pg_temp.invite_catalogue('e0913500-0000-4000-8000-000000000001','e0923500-0000-4000-8000-000000000001'))c WHERE c->>'tool_key'='client_portal_invitation_send'),'off','current owner can see existing off setting');
SELECT is((SELECT c->>'mode' FROM jsonb_array_elements(pg_temp.invite_catalogue('e0913500-0000-4000-8000-000000000002','e0923500-0000-4000-8000-000000000002'))c WHERE c->>'tool_key'='client_portal_invitation_send'),'confirm','another business never inherits setting');
SELECT ok(NOT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE'),'anonymous cannot read catalogue');
SELECT ok(has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE'),'ordinary caller retains catalogue entry');
SELECT ok(NOT has_function_privilege('authenticated','public._list_tool_autonomy_before_customer_invitation(uuid)','EXECUTE'),'renamed predecessor cannot bypass wrapper');
SELECT ok(NOT has_function_privilege('service_role','public._list_tool_autonomy_before_customer_invitation(uuid)','EXECUTE'),'predecessor remains internal');
SELECT * FROM finish();
ROLLBACK;
