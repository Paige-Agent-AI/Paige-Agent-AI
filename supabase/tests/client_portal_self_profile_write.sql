-- Existing isolated database-contract job; synthetic data, actual caller roles,
-- full canonical schema/helpers; every fixture/write is rolled back.
BEGIN;
SELECT no_plan();
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES
('e0912000-0000-0000-0000-000000000001','e09-write-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
('e0912000-0000-0000-0000-000000000002','e09-write-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
('e0922000-0000-0000-0000-000000000001','test-tenant-e09-write-a','Test tenant write A','active','standalone','E09WA',9400921,'{}'),
('e0922000-0000-0000-0000-000000000002','test-tenant-e09-write-b','Test tenant write B','active','standalone','E09WB',9400922,'{}');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,onboarding_stage,source,current_notes) VALUES
('e0932000-0000-0000-0000-000000000001','e0922000-0000-0000-0000-000000000001','e0912000-0000-0000-0000-000000000001','e0912000-0000-0000-0000-000000000002','Original','Customer','active','invited','invitation','PRIVATE NOTE A'),
('e0932000-0000-0000-0000-000000000002','e0922000-0000-0000-0000-000000000002','e0912000-0000-0000-0000-000000000002','e0912000-0000-0000-0000-000000000001','Foreign','Customer','active','invited','invitation','PRIVATE NOTE B');
SELECT public._attach_client_address('e0922000-0000-0000-0000-000000000001','e0932000-0000-0000-0000-000000000001','email','e09-write-a@tests.invalid');
SELECT public._attach_client_address('e0922000-0000-0000-0000-000000000001','e0932000-0000-0000-0000-000000000001','phone','+12025550109');
SELECT public._attach_client_address('e0922000-0000-0000-0000-000000000001','e0932000-0000-0000-0000-000000000001','phone','+12025550110');

CREATE FUNCTION pg_temp.e09_write(_patch jsonb,_version timestamptz,
 _actor uuid DEFAULT 'e0912000-0000-0000-0000-000000000001',
 _tenant uuid DEFAULT 'e0922000-0000-0000-0000-000000000001',_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 SELECT public.client_portal_update_self_profile(_version,_patch,_tenant) INTO _result;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);RETURN _result;
END;$$;
CREATE FUNCTION pg_temp.e09_version() RETURNS timestamptz LANGUAGE sql AS $$
 SELECT updated_at FROM public.clients WHERE id='e0932000-0000-0000-0000-000000000001'
$$;
CREATE FUNCTION pg_temp.e09_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('clients',(SELECT jsonb_agg(to_jsonb(c) ORDER BY id) FROM public.clients c WHERE id IN('e0932000-0000-0000-0000-000000000001','e0932000-0000-0000-0000-000000000002')),
 'methods',(SELECT jsonb_agg(to_jsonb(m) ORDER BY id) FROM public.client_contact_methods m WHERE client_id='e0932000-0000-0000-0000-000000000001'),
 'audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.audit_logs a WHERE entity_id='e0932000-0000-0000-0000-000000000001'))
$$;
SELECT ok(NOT has_function_privilege('anon','public.client_portal_update_self_profile(timestamptz,jsonb,uuid)','EXECUTE'),'anonymous cannot execute writer');
SELECT ok(has_function_privilege('authenticated','public.client_portal_update_self_profile(timestamptz,jsonb,uuid)','EXECUTE'),'authenticated caller reaches checked writer');
SELECT is((SELECT count(*) FROM public.tenant_members WHERE user_id='e0912000-0000-0000-0000-000000000001'),0::bigint,'positive actor has no staff seat');
REVOKE SELECT,UPDATE ON public.clients,public.client_contact_methods FROM authenticated;
CREATE TEMP TABLE e09_result AS SELECT pg_temp.e09_write('{"first_name":"Updated","phone":"+12025550111","city":"Test City"}',pg_temp.e09_version()) AS profile;
SELECT is((SELECT profile->>'first_name' FROM e09_result),'Updated','actual caller receives saved name');
SELECT is((SELECT profile->>'phone' FROM e09_result),'+12025550111','primary phone saved through canonical methods');
SELECT is((SELECT profile->>'email' FROM e09_result),'e09-write-a@tests.invalid','email unchanged');
SELECT ok((SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(profile->'contact_methods') m WHERE m->>'value'='+12025550110') FROM e09_result),'secondary phone preserved');
SELECT ok(NOT(SELECT profile::text LIKE '%PRIVATE%' FROM e09_result),'private fields absent from returned projection');
SELECT is((SELECT current_notes FROM public.clients WHERE id='e0932000-0000-0000-0000-000000000001'),'PRIVATE NOTE A','internal CRM preserved');
SELECT is((SELECT first_name FROM public.clients WHERE id='e0932000-0000-0000-0000-000000000002'),'Foreign','foreign CRM unchanged');
SELECT is((SELECT onboarding_stage FROM public.clients WHERE id='e0932000-0000-0000-0000-000000000001'),'invited','profile write grants no onboarding transition');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity_id='e0932000-0000-0000-0000-000000000001' AND action='self_profile_updated' AND user_id='e0912000-0000-0000-0000-000000000001'),1::bigint,'exact authenticated actor attributed');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id='e0932000-0000-0000-0000-000000000001' AND (data::text LIKE '%+1202555%' OR data::text LIKE '%Updated%')),'audit omits submitted personal values');
CREATE TEMP TABLE e09_before AS SELECT pg_temp.e09_snapshot() AS snapshot;
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"No"}',pg_temp.e09_version(),NULL)$$,'42501','customer authentication required','missing subject refuses');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"No"}',pg_temp.e09_version(),NULL,'e0922000-0000-0000-0000-000000000001','service_role')$$,'42501','customer authentication required','service alone is not identity');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"No"}',pg_temp.e09_version(),'e0912000-0000-0000-0000-000000000001','e0922000-0000-0000-0000-000000000002')$$,'42501','customer relationship unavailable','foreign tenant narrows to no authority');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"No"}',pg_temp.e09_version(),'e0912000-0000-0000-0000-000000000002')$$,'42501','customer relationship unavailable','foreign client cannot select this relationship');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"current_notes":"No"}',pg_temp.e09_version())$$,'22023','profile field is not permitted','private fields cannot be mutated');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"email":"new@tests.invalid"}',pg_temp.e09_version())$$,'22023','profile field is not permitted','email cannot be mutated');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"No","phone":"+12025550112"}','2000-01-01')$$,'40001','customer profile changed; reload before saving','stale version refuses atomically');
SELECT throws_ok($$SELECT pg_temp.e09_write('{"phone":null}',pg_temp.e09_version())$$,'22023','provided name or phone must not be blank','null phone refuses instead of pretending to clear');
SELECT is(pg_temp.e09_snapshot(),(SELECT snapshot FROM e09_before),'all denied attempts preserve profile, methods and audit');
CREATE FUNCTION pg_temp.e09_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'TEST_AUDIT_FAILURE';END;$$;
CREATE TRIGGER e09_fail_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.e09_fail_audit();
SELECT throws_ok($$SELECT pg_temp.e09_write('{"first_name":"Rollback","phone":"+12025550112"}',pg_temp.e09_version())$$,'P0001','TEST_AUDIT_FAILURE','late audit failure refuses success');
SELECT is(pg_temp.e09_snapshot(),(SELECT snapshot FROM e09_before),'late failure rolls back profile and canonical phone');
DROP TRIGGER e09_fail_audit ON public.audit_logs;
SELECT is(pg_temp.e09_write('{"phone":"+12025550110","street_address":null}',pg_temp.e09_version())->>'phone','+12025550110','existing secondary can become primary');
SELECT is(pg_temp.e09_write('{"street_address":"1 Test Road"}',pg_temp.e09_version())->>'city','Test City','omitted fields stay unchanged');
SELECT ok(NOT has_function_privilege('authenticated','public._replace_client_contact_methods_checked(uuid,uuid,jsonb,jsonb)','EXECUTE'),'internal helper never granted to customer');
SELECT * FROM finish();
ROLLBACK;
