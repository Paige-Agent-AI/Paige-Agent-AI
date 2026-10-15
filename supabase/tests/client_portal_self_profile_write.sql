-- Existing isolated database-contract job; synthetic data, actual caller roles,
-- full canonical schema/helpers; every fixture/write is rolled back.
BEGIN;
SELECT no_plan();
SELECT ok(NOT has_table_privilege('anon','public.paige_client_intake_submissions','TRUNCATE'),'public role lacks destructive whole-intake authority');
SELECT ok(NOT has_table_privilege('authenticated','public.paige_client_intake_submissions','TRUNCATE'),'customer role lacks destructive whole-intake authority');
SELECT ok(NOT EXISTS(SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a WHERE c.oid='public.paige_client_intake_submissions'::regclass AND a.grantee=0 AND a.privilege_type='TRUNCATE'),'PUBLIC has no destructive intake-table grant');
SELECT ok((SELECT bool_and(has_table_privilege('authenticated','public.paige_client_intake_submissions',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p),'ordinary customer intake privileges preserved under existing RLS');
SELECT ok(has_table_privilege('service_role','public.paige_client_intake_submissions','TRUNCATE'),'trusted backend table privilege preserved');
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
-- Welcome uses the same actual hosted schema, roles, audit/contact triggers and
-- rolled-back fixtures. No separate CI runner or production business operation.
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.clients'::regclass
 AND tgname='update_clients_updated_at' AND NOT tgisinternal),'real clients now() trigger remains installed');
SELECT ok(EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.paige_client_intake_submissions'::regclass
 AND tgname='trg_intake_updated_at' AND NOT tgisinternal),'real intake now() trigger remains installed');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_welcome_state()','EXECUTE'),'anonymous cannot execute Welcome reader');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_save_welcome(text,jsonb,jsonb)','EXECUTE'),'anonymous cannot execute Welcome writer');
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_welcome_fields(jsonb)','EXECUTE'),'schema validator is private');
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_welcome_answers(jsonb,jsonb)','EXECUTE'),'answer validator is private');
UPDATE public.tenants SET features=jsonb_build_object('playbook_config',jsonb_build_object(
 'slug','test-welcome','name','Test Welcome','persona','{}'::jsonb,'journey','[]'::jsonb,
 'portal','{"modules":[]}'::jsonb,'intake','[{"key":"goal","label":"Goal","type":"text","required":true},{"key":"notes","label":"Notes","type":"longtext"},{"key":"email","label":"Contact","type":"text"}]'::jsonb),
 'private_fixture','NOT PUBLIC') WHERE id='e0922000-0000-0000-0000-000000000001';
INSERT INTO public.paige_client_intake_submissions(client_id,section,payload)
 VALUES('e0932000-0000-0000-0000-000000000001','playbook_intake','{"unseen_history":"keep historical","email":"historical@tests.invalid"}');
CREATE FUNCTION pg_temp.e09_welcome(_save boolean,_token text DEFAULT NULL,
 _profile jsonb DEFAULT NULL,_answers jsonb DEFAULT NULL,
 _actor uuid DEFAULT 'e0912000-0000-0000-0000-000000000001',_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 IF _save THEN SELECT public.client_portal_save_welcome(_token,_profile,_answers) INTO _result;
 ELSE SELECT public.client_portal_welcome_state() INTO _result; END IF;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);RETURN _result;
END;$$;
CREATE FUNCTION pg_temp.e09_welcome_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('profile',pg_temp.e09_snapshot(),
 'intake',(SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM public.paige_client_intake_submissions i
  WHERE client_id IN('e0932000-0000-0000-0000-000000000001','e0932000-0000-0000-0000-000000000002')),
 'stage_audit',(SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM public.paige_audit_log a
  WHERE target_id='e0932000-0000-0000-0000-000000000001'))
$$;
CREATE TEMP TABLE e09_welcome_loaded AS SELECT pg_temp.e09_welcome(false) AS state;
SELECT is((SELECT state->>'status' FROM e09_welcome_loaded),'ready','auth actual caller gets authored sponsoring Welcome');
SELECT is((SELECT jsonb_array_length(state->'fields') FROM e09_welcome_loaded),2,'contact question removed from authored fields');
SELECT is((SELECT state->'answers' FROM e09_welcome_loaded),'{}'::jsonb,'unseen historical keys are not projected');
SELECT ok(NOT (SELECT state::text LIKE '%NOT PUBLIC%' FROM e09_welcome_loaded),'tenant features remain private');
CREATE TEMP TABLE e09_welcome_saved AS SELECT pg_temp.e09_welcome(true,
 (SELECT state->>'expected_token' FROM e09_welcome_loaded),
 '{"first_name":"Welcome Native","phone":"+12025550131","city":"Canonical City"}',
 '{"goal":"Hosted synthetic answer","notes":"Optional synthetic note"}') AS state;
SELECT is((SELECT state FROM e09_welcome_saved),pg_temp.e09_welcome(false),'save response equals final canonical reload after all triggers');
SELECT is((SELECT state#>>'{profile,phone}' FROM e09_welcome_saved),'+12025550131','Welcome phone actually persists');
SELECT is((SELECT state#>>'{profile,onboarding_stage}' FROM e09_welcome_saved),'signing_agreement','native forward stage persists');
SELECT is((SELECT state->>'intake_updated_at' FROM e09_welcome_saved),
 (SELECT to_jsonb(i)->>'updated_at' FROM public.paige_client_intake_submissions i
 WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake'),'actual now() intake version is returned');
SELECT is((SELECT payload->>'unseen_history' FROM public.paige_client_intake_submissions
 WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake'),'keep historical','unseen history retained server-side');
SELECT ok(EXISTS(SELECT 1 FROM public.audit_logs WHERE action='welcome_saved'
 AND entity_id='e0932000-0000-0000-0000-000000000001' AND user_id='e0912000-0000-0000-0000-000000000001'
 AND data->>'tenant_id'='e0922000-0000-0000-0000-000000000001'),'existing audit attributes actual customer Welcome action');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.audit_logs WHERE entity_id='e0932000-0000-0000-0000-000000000001'
 AND (data::text LIKE '%Hosted synthetic answer%' OR data::text LIKE '%Welcome Native%')),'Welcome audit omits personal answers');
CREATE FUNCTION pg_temp.e09_legacy_welcome_number(_legacy text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _state jsonb;
BEGIN
 BEGIN
  UPDATE public.tenants SET features=jsonb_set(features,'{playbook_config,intake}',
   (features#>'{playbook_config,intake}')||'[{"key":"count","label":"Count","type":"number"}]'::jsonb)
   WHERE id='e0922000-0000-0000-0000-000000000001';
  UPDATE public.paige_client_intake_submissions SET payload=payload||jsonb_build_object('count',_legacy)
   WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake';
  _state := pg_temp.e09_welcome(false);
  _state := pg_temp.e09_welcome(true,_state->>'expected_token','{"phone":"+12025550131"}',_state->'answers');
  IF _state IS DISTINCT FROM pg_temp.e09_welcome(false) THEN RAISE EXCEPTION 'legacy save reload mismatch'; END IF;
  RAISE SQLSTATE 'ZX009' USING MESSAGE='TEST_FIXTURE_ROLLBACK';
 EXCEPTION WHEN SQLSTATE 'ZX009' THEN NULL;
 END;
 RETURN _state;
END;$$;
CREATE TEMP TABLE e09_legacy_welcome_before AS SELECT pg_temp.e09_welcome_snapshot() AS state;
SELECT is(pg_temp.e09_legacy_welcome_number('3')#>'{answers,count}','3'::jsonb,'untouched legacy numeric string saves as canonical number');
SELECT is(pg_temp.e09_legacy_welcome_number('0')#>'{answers,count}','0'::jsonb,'legacy zero remains a real numeric answer');
SELECT is(pg_temp.e09_legacy_welcome_number('3.5')#>'{answers,count}','3.5'::jsonb,'legacy decimal resumes without re-entry');
SELECT is(pg_temp.e09_legacy_welcome_number('3e1')#>'{answers,count}','30'::jsonb,'legacy finite exponent resumes as canonical number');
SELECT is(pg_temp.e09_legacy_welcome_number('')#>'{answers,count}','null'::jsonb,'optional legacy blank has explicit null representation');
SELECT throws_ok($$SELECT pg_temp.e09_legacy_welcome_number('NaN')$$,'22023',NULL,'invalid legacy numeric text remains refused');
SELECT throws_ok($$SELECT pg_temp.e09_legacy_welcome_number('0x10')$$,'22023',NULL,'hex text receives no permissive numeric coercion');
SELECT throws_ok($$SELECT pg_temp.e09_legacy_welcome_number('1e999')$$,'22023',NULL,'out-of-range legacy exponent remains refused');
SELECT is(pg_temp.e09_welcome_snapshot(),(SELECT state FROM e09_legacy_welcome_before),'legacy compatibility fixtures roll back every canonical row and audit');
CREATE TEMP TABLE e09_welcome_before AS SELECT pg_temp.e09_welcome_snapshot() AS state;
SELECT throws_ok($$SELECT pg_temp.e09_welcome(true,(SELECT state->>'expected_token' FROM e09_welcome_loaded),'{"first_name":"No"}','{"goal":"No"}')$$,
 '40001','Welcome information changed; reload before saving','prior token conflicts even within same now() transaction');
SELECT throws_ok($$SELECT pg_temp.e09_welcome(false,NULL,NULL,NULL,NULL)$$,'42501','customer authentication required','subjectless actual role refuses Welcome');
SELECT throws_ok($$SELECT pg_temp.e09_welcome(true,(SELECT state->>'expected_token' FROM e09_welcome_saved),'{"first_name":"No"}','{"goal":"No"}','e0912000-0000-0000-0000-000000000002')$$,
 '55000','published intake configuration required','foreign caller never borrows first customer schema or token');
SELECT throws_ok($$SELECT pg_temp.e09_welcome(true,(pg_temp.e09_welcome(false)->>'expected_token'),'{"first_name":"No"}','{"goal":"No","email":"override@tests.invalid"}')$$,
 '22023','intake answer is not permitted','answer cannot override canonical contact');
SELECT throws_ok($$SELECT pg_temp.e09_welcome(true,(pg_temp.e09_welcome(false)->>'expected_token'),'{"first_name":"No"}','{}')$$,
 '22023','required intake answer is missing','published required answer enforced');
SELECT is(pg_temp.e09_welcome_snapshot(),(SELECT state FROM e09_welcome_before),'denials preserve all canonical rows and audits');
-- Raw API controls use actual caller roles. Capture row counts before rollback;
-- no relaxed policy, hand-built authorization or alternate writer is used.
CREATE FUNCTION pg_temp.e09_raw_intake(_operation text) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _count bigint;
BEGIN
 PERFORM set_config('request.jwt.claims','{"sub":"e0912000-0000-0000-0000-000000000001","role":"authenticated"}',true);
 SET LOCAL ROLE authenticated;
 IF _operation='update' THEN
  UPDATE public.paige_client_intake_submissions SET payload='{"goal":"raw"}'
   WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake';
 ELSIF _operation='out' THEN
  UPDATE public.paige_client_intake_submissions SET section='business'
   WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake';
 ELSIF _operation='insert' THEN
  INSERT INTO public.paige_client_intake_submissions(client_id,section,payload)
   VALUES('e0932000-0000-0000-0000-000000000001','playbook_intake','{}');
 ELSIF _operation='into' THEN
  UPDATE public.paige_client_intake_submissions SET section='playbook_intake'
   WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='about_you';
 END IF;
 GET DIAGNOSTICS _count=ROW_COUNT;
 RESET ROLE;PERFORM set_config('request.jwt.claims','{}',true);RETURN _count;
END;$$;
SELECT is(pg_temp.e09_raw_intake('update'),0::bigint,'raw protected update affects no rows');
SELECT is(pg_temp.e09_raw_intake('out'),0::bigint,'raw section reassignment out affects no rows');
CREATE TEMP TABLE e09_held_intake AS SELECT * FROM public.paige_client_intake_submissions
 WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake';
DELETE FROM public.paige_client_intake_submissions WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake';
INSERT INTO public.paige_client_intake_submissions(client_id,section,payload)
 VALUES('e0932000-0000-0000-0000-000000000001','about_you','{}');
SELECT throws_ok($$SELECT pg_temp.e09_raw_intake('insert')$$,'42501',NULL,'raw protected insert refused before uniqueness can mask policy');
SELECT throws_ok($$SELECT pg_temp.e09_raw_intake('into')$$,'42501',NULL,'raw reassignment into protected section refused');
DELETE FROM public.paige_client_intake_submissions
 WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='about_you';
INSERT INTO public.paige_client_intake_submissions SELECT * FROM e09_held_intake;
-- Real native late-stage audit failure must roll back the earlier CRM/phone/intake.
UPDATE public.clients SET onboarding_stage='invited' WHERE id='e0932000-0000-0000-0000-000000000001';
CREATE TEMP TABLE e09_welcome_rollback AS SELECT pg_temp.e09_welcome_snapshot() AS state;
CREATE FUNCTION pg_temp.e09_fail_welcome_stage() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'E09_TEST_STAGE_FAILURE';END;$$;
CREATE TRIGGER e09_fail_welcome_stage BEFORE INSERT ON public.paige_audit_log
 FOR EACH ROW EXECUTE FUNCTION pg_temp.e09_fail_welcome_stage();
SELECT throws_ok($$SELECT pg_temp.e09_welcome(true,(pg_temp.e09_welcome(false)->>'expected_token'),'{"first_name":"Must Roll Back","phone":"+12025550132"}','{"goal":"Must roll back"}')$$,
 'P0001','E09_TEST_STAGE_FAILURE','late native stage audit failure refuses whole Welcome save');
SELECT is(pg_temp.e09_welcome_snapshot(),(SELECT state FROM e09_welcome_rollback),'late failure rolls back contact/intake/stage and existing audit streams');
DROP TRIGGER e09_fail_welcome_stage ON public.paige_audit_log;
-- Optional visible omission removes that answer while preserving unseen history.
SELECT is(pg_temp.e09_welcome(true,(pg_temp.e09_welcome(false)->>'expected_token'),'{"first_name":"Welcome Native"}',
 '{"goal":"Next canonical answer"}')->'answers','{"goal":"Next canonical answer"}'::jsonb,'optional omitted answer is cleared');
SELECT ok(NOT EXISTS(SELECT 1 FROM public.paige_client_intake_submissions
 WHERE client_id='e0932000-0000-0000-0000-000000000001' AND section='playbook_intake' AND payload ? 'notes'),'optional clear persisted in same canonical row');
SELECT * FROM finish();
ROLLBACK;
