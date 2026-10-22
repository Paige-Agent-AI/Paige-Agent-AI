-- Original replayed native functions and real roles. Synthetic, rolled back;
-- provider execution disabled, no production identities or effectful acceptance.
BEGIN;
SELECT plan(165);

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
 ('e0970300-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000001','Casey','Morgan','active');

-- Actual production linkage is still global. This future-shape fixture is
-- confined to the rolled-back CI clone, matching original projection proofs.
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'actual global unique linkage exists before the future-shape fixture');
SELECT throws_ok($guard$ INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0970300-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','Jordan','Rivera','active'); $guard$,'23505',NULL,'current native global guard refuses a second business link');
DROP INDEX public.clients_linked_user_id_unique;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique),'future fixture retains original within-business uniqueness');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0970300-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','Jordan','Rivera','active');

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



-- Exact Account/Consent intent: original writers/ledger and real caller roles, same rollback.
DO $fixture$ BEGIN PERFORM public._attach_client_address('e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002','email','scope-client@tests.invalid'); END $fixture$;
SELECT ok(has_function_privilege('authenticated','public.client_portal_update_self_profile_scoped(timestamp with time zone,jsonb,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_update_self_profile_scoped(timestamp with time zone,jsonb,uuid,uuid)','EXECUTE'),'client_portal_update_self_profile_scoped has only the intended customer execution lane');
SELECT ok(has_function_privilege('authenticated','public.client_portal_communication_preferences_scoped(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_communication_preferences_scoped(uuid,uuid)','EXECUTE'),'client_portal_communication_preferences_scoped has only the intended customer execution lane');
SELECT ok(has_function_privilege('authenticated','public.client_portal_set_communication_preference_scoped(text,text,boolean,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_set_communication_preference_scoped(text,text,boolean,uuid,uuid)','EXECUTE'),'client_portal_set_communication_preference_scoped has only the intended customer execution lane');
SELECT ok(has_function_privilege('authenticated','public.client_portal_set_shared_context_consent_scoped(boolean,uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public.client_portal_set_shared_context_consent_scoped(boolean,uuid,uuid)','EXECUTE'),'client_portal_set_shared_context_consent_scoped has only the intended customer execution lane');
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_lock_expected_relationship(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('anon','public._client_portal_lock_expected_relationship(uuid,uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public._client_portal_lock_expected_relationship(uuid,uuid)','EXECUTE'),'internal expected-client clamp has no caller execution grant');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_update_self_profile(timestamp with time zone,jsonb,uuid)'::regprocedure),'9379b1eefb7f8f7e4602dd2efadaf298','original client_portal_update_self_profile implementation is unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_communication_preferences(uuid)'::regprocedure),'38cfa46de9563d425141d7ab39acb84a','original client_portal_communication_preferences implementation is unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_set_communication_preference(text,text,boolean,uuid)'::regprocedure),'5f2808edc0841fa1b34aac96f0e7c82f','original client_portal_set_communication_preference implementation is unchanged');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.client_portal_set_shared_context_consent(boolean,uuid)'::regprocedure),'d036a24e4eb942b314a77dc32ac3c676','original client_portal_set_shared_context_consent implementation is unchanged');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign expected client refuses original Account/Consent adapter 1');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign expected client refuses original Account/Consent adapter 2');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign expected client refuses original Account/Consent adapter 3');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','foreign expected client refuses original Account/Consent adapter 4');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','conflicting selected business refuses original Account/Consent adapter 1');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','conflicting selected business refuses original Account/Consent adapter 2');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','conflicting selected business refuses original Account/Consent adapter 3');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','conflicting selected business refuses original Account/Consent adapter 4');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','foreign actual actor refuses original Account/Consent adapter 1');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','foreign actual actor refuses original Account/Consent adapter 2');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','foreign actual actor refuses original Account/Consent adapter 3');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','foreign actual actor refuses original Account/Consent adapter 4');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001','SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','owner is not a customer refuses original Account/Consent adapter 1');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001','SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','owner is not a customer refuses original Account/Consent adapter 2');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001','SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','owner is not a customer refuses original Account/Consent adapter 3');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001','SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','owner is not a customer refuses original Account/Consent adapter 4');
SELECT is(pg_temp.as_scope_user(NULL,'SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','missing actor refuses original Account/Consent adapter 1');
SELECT is(pg_temp.as_scope_user(NULL,'SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','missing actor refuses original Account/Consent adapter 2');
SELECT is(pg_temp.as_scope_user(NULL,'SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','missing actor refuses original Account/Consent adapter 3');
SELECT is(pg_temp.as_scope_user(NULL,'SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','{"x-client-portal-business":"e0970200-0000-4000-8000-000000000002"}')->>'sqlstate','42501','missing actor refuses original Account/Consent adapter 4');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000002'',NULL)','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing expected client refuses original Account/Consent adapter 1');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',NULL)','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing expected client refuses original Account/Consent adapter 2');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',NULL)','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing expected client refuses original Account/Consent adapter 3');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',NULL)','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing expected client refuses original Account/Consent adapter 4');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',NULL,''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing explicit business refuses original Account/Consent adapter 1');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(NULL,''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing explicit business refuses original Account/Consent adapter 2');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,NULL,''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing explicit business refuses original Account/Consent adapter 3');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,NULL,''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'sqlstate','42501','missing explicit business refuses original Account/Consent adapter 4');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'business_name','Harbor Lane Advisors','exact selected B preference read uses the original business projection');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences(''e0970200-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'business_name','Harbor Lane Advisors','original preference ABI remains compatible');
SELECT is(pg_temp.scope_read(format('SELECT public.client_portal_update_self_profile_scoped(%L::timestamptz,%L::jsonb,%L::uuid,%L::uuid)',(SELECT updated_at FROM public.clients WHERE id='e0970300-0000-4000-8000-000000000002'),'{"city":"Scope fixture B"}','e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002'),'e0970200-0000-4000-8000-000000000002')->>'city','Scope fixture B','exact original profile CAS saves selected B');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_self_profile()','e0970200-0000-4000-8000-000000000002')->>'city','Scope fixture B','original fresh B profile proves the saved value');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_self_profile()','e0970200-0000-4000-8000-000000000001')->>'city',NULL::text,'the same actor''s A profile is unchanged');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'ok','true','exact sharing adapter returns original confirmed receipt');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')->>'ok','true','exact email opt-out calls only the original native writer');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000002'',''e0970300-0000-4000-8000-000000000002'')','e0970200-0000-4000-8000-000000000002')#>>'{email,state}','off','fresh original preference projection confirms the customer opt-out');
SELECT is(pg_temp.scope_read(format('SELECT public.client_portal_update_self_profile_scoped(%L::timestamptz,%L::jsonb,%L::uuid,%L::uuid)',(SELECT updated_at FROM public.clients WHERE id='e0970300-0000-4000-8000-000000000002'),'{"tenant_id":"forbidden"}','e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002'),'e0970200-0000-4000-8000-000000000002')->>'sqlstate','22023','original native profile allowlist still refuses privilege fields');

-- Same-business replacement with the SAME profile version must not inherit an earlier intent.
CREATE TEMP TABLE e09_profile_intent_before ON COMMIT DROP AS SELECT updated_at FROM public.clients WHERE id='e0970300-0000-4000-8000-000000000001';
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0970300-0000-4000-8000-000000000001';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,updated_at) SELECT 'e0970300-0000-4000-8000-000000000004','e0970200-0000-4000-8000-000000000001','e0970100-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','Replacement','Customer','active',updated_at FROM e09_profile_intent_before;
SELECT is((SELECT updated_at FROM public.clients WHERE id='e0970300-0000-4000-8000-000000000004'),(SELECT updated_at FROM e09_profile_intent_before),'same version alone cannot bind a customer identity');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_update_self_profile_scoped(NULL,''{"city":"must not be saved"}'',''e0970200-0000-4000-8000-000000000001'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','replaced same-business client refuses old intent adapter 1');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_communication_preferences_scoped(''e0970200-0000-4000-8000-000000000001'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','replaced same-business client refuses old intent adapter 2');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_communication_preference_scoped(''email'',NULL,false,''e0970200-0000-4000-8000-000000000001'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','replaced same-business client refuses old intent adapter 3');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_set_shared_context_consent_scoped(false,''e0970200-0000-4000-8000-000000000001'',''e0970300-0000-4000-8000-000000000001'')','e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','replaced same-business client refuses old intent adapter 4');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_self_profile()','e0970200-0000-4000-8000-000000000001')->>'id','e0970300-0000-4000-8000-000000000004','original resolver identifies the actual replacement independently');
SELECT is((SELECT city FROM public.clients WHERE id='e0970300-0000-4000-8000-000000000004'),NULL::text,'old intent changes no replacement profile');
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0970300-0000-4000-8000-000000000004';
UPDATE public.clients SET linked_user_id='e0970100-0000-4000-8000-000000000002' WHERE id='e0970300-0000-4000-8000-000000000001';
SELECT is(pg_temp.scope_read('SELECT public.client_portal_self_profile()','e0970200-0000-4000-8000-000000000001')->>'id','e0970300-0000-4000-8000-000000000001','original fixture relationship is restored for all incumbent controls');

-- Original Sessions and admission only. No booking writer or provider call.
INSERT INTO public.calendars(id,tenant_id,created_by,slug,title,duration_min,min_notice_min,enabled) VALUES
 ('e0970700-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','e0970100-0000-4000-8000-000000000001','test-tenant-scope-sessions-a','Session A',60,60,true),
 ('e0970700-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','test-tenant-scope-sessions-b','Session B',60,60,true),
 ('e0970700-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000001','test-tenant-scope-sessions-c','Session C',60,60,true);
INSERT INTO public.internal_bookings(id,tenant_id,host_user_id,contact_id,calendar_id,title,notes,start_at,end_at,timezone,status,booking_kind,source) VALUES
 ('e0970800-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000001','e0970700-0000-4000-8000-000000000001','Private title A','Private staff note',now()+interval '3 hours',now()+interval '4 hours','UTC','scheduled','single','internal'),
 ('e0970800-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000002','e0970700-0000-4000-8000-000000000002','Private title B','Private staff note',now()+interval '5 hours',now()+interval '6 hours','UTC','scheduled','single','internal'),
 ('e0970800-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000003','e0970700-0000-4000-8000-000000000003','Private title C','Private staff note',now()+interval '7 hours',now()+interval '8 hours','UTC','scheduled','single','internal');
CREATE FUNCTION pg_temp.scope_session_admit(booking_id uuid,business uuid,header text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $session$
 SELECT pg_temp.scope_read(format('SELECT public.client_portal_session_change_admit(%L::uuid,''cancel'',%L::uuid,NULL,%L::uuid)',booking_id,'e0970900-0000-4000-8000-000000000001',business),header) $session$;
SELECT is(pg_temp.scope_read('SELECT public.client_portal_sessions()','e0970200-0000-4000-8000-000000000001')#>>'{sessions,0,id}',
 'e0970800-0000-4000-8000-000000000001','original selected A sessions contain only A booking');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_sessions()','e0970200-0000-4000-8000-000000000002')#>>'{sessions,0,id}',
 'e0970800-0000-4000-8000-000000000002','original selected B sessions contain only B booking');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_sessions(NULL,''upcoming'',NULL,1)','e0970200-0000-4000-8000-000000000002')->>'tenant_id'='e0970200-0000-4000-8000-000000000002'
 AND pg_temp.scope_read('SELECT public.client_portal_sessions(NULL,''upcoming'',NULL,1)','e0970200-0000-4000-8000-000000000002')::text NOT LIKE '%Private%',
 'Home one-item session read uses same business and excludes original private notes/title');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_sessions()','e0970200-0000-4000-8000-000000000003') IS NULL,'foreign business session read has no fallback');
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_sessions()',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'other actual customer cannot read A sessions');
SELECT ok(pg_temp.scope_read($session$SELECT public.client_portal_sessions('e0970200-0000-4000-8000-000000000002')$session$,
 'e0970200-0000-4000-8000-000000000001') IS NULL,'conflicting native sessions business and header refuse');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_sessions()')->>'sqlstate','42501','unselected multiple session relationships retain native refusal');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002')->>'ok','true',
 'original booking-manage explicit B admission works without a new Edge header');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000001')->>'error','SESSION_NOT_FOUND',
 'selected A body cannot admit B booking even though both relationships belong to this actor');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000001')->>'error','SESSION_NOT_FOUND',
 'conflicting selected header cannot authorize B change');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003')->>'error','SESSION_NOT_FOUND',
 'foreign customer original booking cannot be admitted');
UPDATE public.calendars SET min_notice_min=1000 WHERE id='e0970700-0000-4000-8000-000000000001';
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001')->>'error','SESSION_CHANGE_WINDOW_CLOSED',
 'selected business never overrides the original calendar notice window');
UPDATE public.calendars SET min_notice_min=60 WHERE id='e0970700-0000-4000-8000-000000000001';
SELECT ok((SELECT count(*)=3 AND bool_and(status='scheduled') FROM public.internal_bookings WHERE id::text LIKE 'e0970800-%'),
 'admission is read-only and never cancels or reschedules the bookings');

-- Original per-item shared Planning records. Final fixture share state only;
-- no production writer, provider action or additional customer identity.
INSERT INTO public.plan_items(id,tenant_id,item_type,created_by,contact_id,title,summary,status,client_shared_at,client_shared_by) VALUES
 ('e0970500-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','task','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000001','Shared work A','Private operating note A','open',now(),'e0970100-0000-4000-8000-000000000001'),
 ('e0970500-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','task','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000002','Shared work B','Private operating note B','open',now(),'e0970100-0000-4000-8000-000000000001'),
 ('e0970500-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000001','task','e0970100-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000001','Unshared work A','Private unshared record','open',NULL,NULL);
SELECT is(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000001')#>>'{items,0,id}',
 'e0970500-0000-4000-8000-000000000001','selected A progress returns original shared A item');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000002')#>>'{items,0,id}',
 'e0970500-0000-4000-8000-000000000002','selected B progress returns original shared B item');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000001')#>>'{summary,shared}',
 '1','progress summary excludes private work and other business');
SELECT ok(jsonb_array_length(pg_temp.scope_read('SELECT public.client_portal_progress(NULL,1)','e0970200-0000-4000-8000-000000000002')->'items')=1
 AND pg_temp.scope_read('SELECT public.client_portal_progress(NULL,1)','e0970200-0000-4000-8000-000000000002')->>'tenant_id'='e0970200-0000-4000-8000-000000000002'
 AND pg_temp.scope_read('SELECT public.client_portal_progress(NULL,1)','e0970200-0000-4000-8000-000000000002')::text NOT LIKE '%Private operating note%',
 'one-item Home read has same selected business and no private summary');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000003') IS NULL,'foreign progress business has no fallback');
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003','SELECT public.client_portal_progress()',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'other customer cannot read original A shared work');
SELECT ok(pg_temp.scope_read($progress$SELECT public.client_portal_progress('e0970200-0000-4000-8000-000000000002')$progress$,
 'e0970200-0000-4000-8000-000000000001') IS NULL,'conflicting explicit progress business/header has no fallback');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_progress()')->>'sqlstate','42501','unselected multi-business progress retains native ambiguity refusal');


-- Original assigned-work RLS and versioned response writer. Notifications and
-- activity remain original native records inside this rolled-back transaction.
INSERT INTO public.paige_customer_actions(id,tenant_id,contact_id,initiated_by_admin_id,action_type,title,status,expires_at,updated_at) VALUES
 ('e0970600-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000001','e0970100-0000-4000-8000-000000000001','task','Assigned A','proposed','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
 ('e0970600-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002','e0970100-0000-4000-8000-000000000001','task','Assigned B','proposed','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z'),
 ('e0970600-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','e0970300-0000-4000-8000-000000000003','e0970100-0000-4000-8000-000000000001','task','Assigned C','proposed','2099-01-01T00:00:00Z','2026-01-01T00:00:00Z');
CREATE FUNCTION pg_temp.scope_actions(business text,contact uuid) RETURNS jsonb LANGUAGE sql AS $actions$
 SELECT pg_temp.scope_read(format('SELECT coalesce(jsonb_agg(to_jsonb(a)),''[]''::jsonb) FROM (SELECT id,tenant_id,contact_id,status FROM public.paige_customer_actions WHERE tenant_id=%L::uuid AND contact_id=%L::uuid ORDER BY id) a',business,contact),business) $actions$;
CREATE FUNCTION pg_temp.scope_respond(action_id uuid,business text,version timestamptz) RETURNS jsonb LANGUAGE sql AS $actions$
 SELECT pg_temp.scope_read(format('SELECT public.customer_respond_to_action(%L::uuid,''completed'',NULL,%L::timestamptz)',action_id,version),business) $actions$;
SELECT is(pg_temp.scope_actions('e0970200-0000-4000-8000-000000000001','e0970300-0000-4000-8000-000000000001')#>>'{0,id}',
 'e0970600-0000-4000-8000-000000000001','original RLS read returns own selected A action');
SELECT is(pg_temp.scope_actions('e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002')#>>'{0,id}',
 'e0970600-0000-4000-8000-000000000002','original RLS read returns own selected B action');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003',
 $actions$SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM (SELECT id FROM public.paige_customer_actions WHERE id='e0970600-0000-4000-8000-000000000001') a$actions$,
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}'),'[]'::jsonb,'other actual customer cannot read A action');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','2026-01-01T00:00:00Z')->>'ok',
 'true','selected B responds through original exact-version native writer');
SELECT ok((SELECT count(*)=1 AND bool_and(contact_id='e0970300-0000-4000-8000-000000000002' AND responded_by_user_id='e0970100-0000-4000-8000-000000000002' AND response_type='completed')
 FROM public.paige_customer_responses WHERE action_id='e0970600-0000-4000-8000-000000000002'),'canonical response retains original business relationship and actual actor');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002','2026-01-01T00:00:00Z')->>'error',
 'ACTION_VERSION_CONFLICT','old version cannot duplicate the response');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000001',
 (SELECT updated_at FROM public.paige_customer_actions WHERE id='e0970600-0000-4000-8000-000000000002'))->>'error','FORBIDDEN','conflicting selected business cannot respond to B');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000003','e0970200-0000-4000-8000-000000000003','2026-01-01T00:00:00Z')->>'error',
 'FORBIDDEN','customer cannot respond to another actual customer action');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001',NULL)->>'error',
 'ACTION_VERSION_CONFLICT','missing exact action version is refused');
SELECT is(pg_temp.scope_actions('e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002')#>>'{0,status}',
 'customer_acted','returning read contains original saved B status');

-- Original business-shared Conversations, distinct from the private CURA service below.
-- Native writers only, provider execution disabled, all synthetic rows rolled back.
CREATE FUNCTION pg_temp.scope_send_message(business text,body text,request_id uuid,kind text DEFAULT 'message')
RETURNS jsonb LANGUAGE sql AS $message$
 SELECT pg_temp.scope_read(format('SELECT public.client_portal_send_message(%L,%L::uuid,%L,%L::uuid)',body,request_id,kind,business),business) $message$;
CREATE FUNCTION pg_temp.scope_conversation(business text)
RETURNS jsonb LANGUAGE sql AS $message$
 SELECT pg_temp.scope_read(format('SELECT public.client_portal_conversation(%L::uuid)',business),business) $message$;
CREATE TEMP TABLE scope_messages(business text,result jsonb);
INSERT INTO scope_messages VALUES
 ('e0970200-0000-4000-8000-000000000001',pg_temp.scope_send_message('e0970200-0000-4000-8000-000000000001','Shared A only','e0970400-0000-4000-8000-000000000001','help')),
 ('e0970200-0000-4000-8000-000000000002',pg_temp.scope_send_message('e0970200-0000-4000-8000-000000000002','Shared B only','e0970400-0000-4000-8000-000000000002'));
SELECT is(result->>'ok','true','selected A help writes through original Conversations') FROM scope_messages WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT is(result->>'ok','true','selected B message writes through original Conversations') FROM scope_messages WHERE business='e0970200-0000-4000-8000-000000000002';
SELECT is(pg_temp.scope_conversation('e0970200-0000-4000-8000-000000000001')#>'{messages}',
 jsonb_build_array(jsonb_build_object('id',result->>'message_id','author','customer','kind','help','body','Shared A only','created_at',result->>'created_at','request_id','e0970400-0000-4000-8000-000000000001')),
 'A reads only its own original shared help receipt') FROM scope_messages WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT is(pg_temp.scope_conversation('e0970200-0000-4000-8000-000000000002')#>'{messages}',
 jsonb_build_array(jsonb_build_object('id',result->>'message_id','author','customer','kind','message','body','Shared B only','created_at',result->>'created_at','request_id','e0970400-0000-4000-8000-000000000002')),
 'B reads only its own original shared message receipt') FROM scope_messages WHERE business='e0970200-0000-4000-8000-000000000002';
SELECT ok(pg_temp.scope_send_message('e0970200-0000-4000-8000-000000000001','Shared A only','e0970400-0000-4000-8000-000000000001','help')
 @> jsonb_build_object('ok',true,'replayed',true,'message_id',result->>'message_id'),'uncertain A retry reuses original canonical message identity') FROM scope_messages WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT is(pg_temp.scope_read($message$SELECT public.client_portal_send_message('Wrong business','e0970400-0000-4000-8000-000000000004','message','e0970200-0000-4000-8000-000000000002')$message$,
 'e0970200-0000-4000-8000-000000000001')->>'error','NO_RELATIONSHIP','a conflicting business argument cannot escape the captured request');
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003',
 $message$SELECT public.client_portal_conversation('e0970200-0000-4000-8000-000000000001')$message$,
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'another customer cannot read A shared messages');
SELECT is((SELECT jsonb_build_object('tenant',m.tenant_id,'contact',m.contact_id,'channel',m.channel_type,'actor',m.meta#>>'{portal,author_user_id}')
 FROM public.messages m JOIN scope_messages proof ON m.id::text=proof.result->>'message_id' WHERE proof.business='e0970200-0000-4000-8000-000000000001'),
 jsonb_build_object('tenant','e0970200-0000-4000-8000-000000000001','contact','e0970300-0000-4000-8000-000000000001','channel','portal','actor','e0970100-0000-4000-8000-000000000002'),
 'physical business record retains original tenant/client and actual customer attribution');

-- Existing original private conversation service/RLS under the same future-shape
-- CI fixture. No turn/provider execution, extra production identity or new writer.
CREATE FUNCTION pg_temp.open_scoped_chat(business text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $chat$
 SELECT pg_temp.scope_read('SELECT to_jsonb(public.paige_chat_thread_create(NULL,''customer'',''Native scope proof'',''{"audience":"customer_private"}''::jsonb))',business) $chat$;
CREATE TEMP TABLE scope_chats(business text,opened jsonb);
INSERT INTO scope_chats VALUES
 ('e0970200-0000-4000-8000-000000000001',pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000001')),
 ('e0970200-0000-4000-8000-000000000002',pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000002'));
CREATE FUNCTION pg_temp.read_scoped_chat(business text,opened jsonb)
RETURNS jsonb LANGUAGE sql AS $chat$
 SELECT pg_temp.scope_read(format('SELECT jsonb_build_object(''tenant'',tenant_id,''contact'',contact_id,''audience'',audience,''lens'',lens) FROM public.paige_chat_threads WHERE id::text=%L',opened#>>'{}'),business) $chat$;
SELECT is((SELECT jsonb_typeof(opened) FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001'),'string','selected A opens an original private thread');
SELECT is((SELECT jsonb_typeof(opened) FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002'),'string','selected B opens an original private thread');
SELECT ok((SELECT opened FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001') IS DISTINCT FROM
 (SELECT opened FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002'),'original private thread identity differs across businesses');
SELECT is(pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000001'),(SELECT opened FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001'),'returning A reuses its original private thread');
SELECT is(pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000002'),(SELECT opened FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002'),'returning B reuses its original private thread');
SELECT is(pg_temp.read_scoped_chat(business,opened)->>'contact','e0970300-0000-4000-8000-000000000001','native A history reader binds its original client') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT is(pg_temp.read_scoped_chat(business,opened)->>'contact','e0970300-0000-4000-8000-000000000002','native B history reader binds its original client') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002';
SELECT is(pg_temp.read_scoped_chat(business,opened),jsonb_build_object('tenant',business,'contact','e0970300-0000-4000-8000-000000000001','audience','customer_private','lens','client'),'original closed A thread facts retain private audience/lens') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT ok(pg_temp.read_scoped_chat('e0970200-0000-4000-8000-000000000002',opened) IS NULL,'B request cannot read A private thread') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT ok(pg_temp.read_scoped_chat('e0970200-0000-4000-8000-000000000001',opened) IS NULL,'A request cannot read B private thread') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002';
SELECT ok(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000001',
 format('SELECT to_jsonb(id) FROM public.paige_chat_threads WHERE id::text=%L',opened#>>'{}'),
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}') IS NULL,'business staff standing does not expose a customer private conversation') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000001';
SELECT is(pg_temp.open_scoped_chat()->>'sqlstate','42501','unselected ambiguity creates no guessed private conversation');
SELECT is(pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000003')->>'sqlstate','42501','foreign business creates no private conversation');
SELECT is(pg_temp.as_scope_user('e0970100-0000-4000-8000-000000000003',
 'SELECT to_jsonb(public.paige_chat_thread_create(NULL,''customer'',''Refused scope'',''{}''::jsonb))',
 '{"x-client-portal-business":"e0970200-0000-4000-8000-000000000001"}')->>'sqlstate','42501','another actor cannot reuse prior private conversation scope');

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
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_sessions()','e0970200-0000-4000-8000-000000000001') IS NULL,'paused A cannot read original sessions');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001')->>'error','SESSION_NOT_FOUND','paused A cannot admit a booking change');

SELECT ok(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000001') IS NULL,'paused A cannot read original shared progress');
SELECT is(pg_temp.scope_respond('e0970600-0000-4000-8000-000000000001','e0970200-0000-4000-8000-000000000001','2026-01-01T00:00:00Z')->>'error','FORBIDDEN','paused A cannot write a customer action response');
SELECT is(pg_temp.scope_send_message('e0970200-0000-4000-8000-000000000001','Paused refusal','e0970400-0000-4000-8000-000000000003')->>'error','NO_RELATIONSHIP','paused A cannot send a shared message');
SELECT is(pg_temp.open_scoped_chat('e0970200-0000-4000-8000-000000000001')->>'sqlstate','42501','paused A cannot reopen a private conversation');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')#>>'{business,name}',
 'Northwind Studio','selected older pause never names latest other-business pause');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')->>'request_business_id',
 'e0970200-0000-4000-8000-000000000001','scoped notice proves the native request hint was consumed');
SELECT ok(NOT pg_temp.scope_read('SELECT public.client_portal_access_state()') ? 'request_business_id','legacy unscoped notice shape remains compatible');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000001')) k),
 ARRAY['business','request_business_id','since','state'],'scoped notice has no internal reason, note or other business');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000002')->>'state','paused','selected B pause is named');
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()')#>>'{business,name}',
 'Harbor Lane Advisors','unselected legacy latest notice remains compatible');
SELECT set_config('paige.link_ok','1',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0970300-0000-4000-8000-000000000002';
SELECT set_config('paige.link_ok','',true);
SELECT is(pg_temp.scope_read('SELECT public.client_portal_access_state()','e0970200-0000-4000-8000-000000000002')->>'state','ended','selected former user sees genuine ended notice');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_frame()','e0970200-0000-4000-8000-000000000002') IS NULL,'revoked selection cannot obtain another frame');
SELECT ok(pg_temp.scope_read('SELECT public.client_portal_sessions()','e0970200-0000-4000-8000-000000000002') IS NULL,'revoked B cannot read retained original sessions');
SELECT is(pg_temp.scope_session_admit('e0970800-0000-4000-8000-000000000002','e0970200-0000-4000-8000-000000000002')->>'error','SESSION_NOT_FOUND','revoked B cannot admit a retained booking');

SELECT ok(pg_temp.scope_read('SELECT public.client_portal_progress()','e0970200-0000-4000-8000-000000000002') IS NULL,'revoked B cannot read retained original progress');
SELECT is(pg_temp.scope_actions('e0970200-0000-4000-8000-000000000002','e0970300-0000-4000-8000-000000000002'),'[]'::jsonb,'revoked B cannot read retained original actions');
SELECT ok(pg_temp.scope_conversation('e0970200-0000-4000-8000-000000000002') IS NULL,'revoked B cannot read retained shared conversation history');
SELECT ok(pg_temp.read_scoped_chat('e0970200-0000-4000-8000-000000000002',opened) IS NULL,'revoked B cannot read its retained original private thread') FROM scope_chats WHERE business='e0970200-0000-4000-8000-000000000002';
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

CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'future fixture restores the original global guard before outer rollback');

SELECT * FROM finish();
ROLLBACK;
