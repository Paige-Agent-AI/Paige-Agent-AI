-- Existing isolated database-contract job; real caller roles; synthetic data; rollback.
BEGIN;
SELECT no_plan();

INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES
('e0911000-0000-0000-0000-000000000001','e09-client-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
('e0911000-0000-0000-0000-000000000002','e09-client-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
('e0921000-0000-0000-0000-000000000001','e09-profile-a','E09 Profile A','active','standalone','E09PA',9400911,'{}'),
('e0921000-0000-0000-0000-000000000002','e09-profile-b','E09 Profile B','active','standalone','E09PB',9400912,'{}');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,entity_name,status,onboarding_stage,source,current_notes) VALUES
('e0931000-0000-0000-0000-000000000001','e0921000-0000-0000-0000-000000000001','e0911000-0000-0000-0000-000000000001',
 'e0911000-0000-0000-0000-000000000002','Synthetic','Client A','Company A','active','invited','invitation','PRIVATE CRM NOTE A'),
('e0931000-0000-0000-0000-000000000002','e0921000-0000-0000-0000-000000000002','e0911000-0000-0000-0000-000000000002',
 'e0911000-0000-0000-0000-000000000001','Foreign','Client B','Company B','active','invited','signup','PRIVATE CRM NOTE B'),
('e0931000-0000-0000-0000-000000000003','e0921000-0000-0000-0000-000000000001',NULL,
 'e0911000-0000-0000-0000-000000000002','Synthetic','Survivor','Company A','active','invited','invitation',NULL);
SELECT public._attach_client_address('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','email','e09-primary@tests.invalid');
SELECT public._attach_client_address('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','phone','+12025550109');

CREATE FUNCTION pg_temp.e09_profile(_actor uuid,_tenant uuid DEFAULT NULL,_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role,'email','spoofed-foreign@tests.invalid')::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 SELECT public.client_portal_self_profile(_tenant) INTO _result;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END;
$$;
-- Atomic composition consumes the same native readers and caller role.
CREATE FUNCTION pg_temp.e09_frame(_actor uuid,_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 SELECT public.client_portal_frame() INTO _result;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END;
$$;

-- Same fully replayed contract job; no additional CI database or workflow lane.
CREATE FUNCTION pg_temp.e09_presentation(_actor uuid)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role','authenticated','email','spoofed-foreign@tests.invalid')::text,true);
 SET LOCAL ROLE authenticated;
 SELECT jsonb_build_object('brand',(SELECT to_jsonb(b) FROM public.get_client_portal_brand() b),
                           'config',public.get_client_portal_config()) INTO _result;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END;
$$;
-- Exercise the existing stage writer under the real caller role; no new CI lane.
CREATE FUNCTION pg_temp.e09_stage(_actor uuid,_stage text DEFAULT 'signing_agreement',_payload jsonb DEFAULT '{}',_role text DEFAULT 'authenticated')
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _result jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 SELECT to_jsonb(s) INTO _result FROM public.client_advance_onboarding_stage(_stage,_payload) s;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END;
$$;
CREATE FUNCTION pg_temp.e09_stage_error(_actor uuid,_stage text DEFAULT 'completed',_role text DEFAULT 'authenticated')
RETURNS text LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_temp.e09_stage(_actor,_stage,'{}',_role);
 RETURN 'NO_ERROR';
EXCEPTION WHEN OTHERS THEN RETURN SQLSTATE;
END;
$$;
UPDATE public.tenants SET brand='{"product_name":"Test tenant A","primary_color":"#26483e"}',
 features='{"portal_config":{"welcome":{"headline":"Saved greeting A"},"modules":[{"key":"documents","visible":false}]}}'
 WHERE id='e0921000-0000-0000-0000-000000000001';
UPDATE public.tenants SET brand='{"product_name":"Test tenant B"}',
 features='{"portal_config":{"welcome":{"headline":"Saved greeting B"}}}'
 WHERE id='e0921000-0000-0000-0000-000000000002';

SELECT ok(NOT has_function_privilege('anon','public.client_portal_self_profile(uuid)','EXECUTE'),'anonymous cannot execute profile');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_relationship_id(uuid)','EXECUTE'),'anonymous cannot execute relationship helper');
SELECT ok(has_function_privilege('authenticated','public.client_portal_self_profile(uuid)','EXECUTE'),'authenticated customer can execute checked profile');
SELECT is((SELECT count(*) FROM public.tenant_members WHERE user_id='e0911000-0000-0000-0000-000000000001'),0::bigint,'positive actor has no business staff seat');

-- The projection must work without exposing the underlying raw CRM or address tables.
REVOKE SELECT ON public.clients, public.client_contact_methods FROM authenticated;
SELECT ok(NOT has_function_privilege('anon','public.get_client_portal_brand()','EXECUTE'),'anonymous cannot execute customer brand reader');
SELECT ok(NOT has_function_privilege('anon','public.get_client_portal_config()','EXECUTE'),'anonymous cannot execute customer configuration reader');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'brand'->>'tenant_id','e0921000-0000-0000-0000-000000000001','brand follows actual external relationship without raw CRM SELECT');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'brand'->>'product_name','Test tenant A','existing native brand cascade remains compatible');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'config','{"welcome":{"headline":"Saved greeting A"},"modules":[{"key":"documents","visible":false}]}'::jsonb,'saved presentation overlay remains exact');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000002')->'brand'->>'tenant_id','e0921000-0000-0000-0000-000000000002','a different authenticated subject reads only its own business');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000099'),'{"brand":null,"config":{}}'::jsonb,'unlinked subject receives no customer presentation');
SELECT is(pg_temp.e09_presentation(NULL),'{"brand":null,"config":{}}'::jsonb,'missing subject supplies no presentation authority');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'id','e0931000-0000-0000-0000-000000000001','actual external caller receives only their canonical contact');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'email','e09-primary@tests.invalid','primary address is read through canonical contact methods');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'phone','+12025550109','primary phone is read through canonical contact methods');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')) k),
 ARRAY['city','contact_methods','email','entity_name','first_name','id','is_signup_contact','last_name','linked_user_id','onboarding_stage',
 'paige_shared_context_consent','paige_shared_context_consent_updated_at','phone','state','street_address','tenant_id','updated_at','zip_code']::text[],
 'only explicit customer fields; no internal CRM notes, lifecycle, scores, staff or provider fields');
SELECT ok(NOT (pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')::text LIKE '%PRIVATE CRM%'),'internal notes never enter projection');
SELECT ok((SELECT bool_and((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(m) k)=ARRAY['is_primary','kind','value']::text[])
 FROM jsonb_array_elements(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->'contact_methods') m),'contact methods omit staff labels, match keys and authors');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001','e0921000-0000-0000-0000-000000000002'),NULL::jsonb,'foreign tenant argument does not authorize');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000002','e0921000-0000-0000-0000-000000000001'),NULL::jsonb,'foreign client cannot select this tenant');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000099'),NULL::jsonb,'unlinked subject has no relationship');
SELECT throws_ok($$ SELECT pg_temp.e09_profile(NULL,'e0921000-0000-0000-0000-000000000001','service_role') $$,'42501','customer authentication required','service role without a subject is not a client identity');
SELECT throws_ok($$ SELECT pg_temp.e09_profile(NULL) $$,'42501','customer authentication required','missing auth subject refuses');

SELECT ok(NOT has_function_privilege('anon','public.client_advance_onboarding_stage(text,jsonb)','EXECUTE'),'anonymous cannot execute the stage writer');
SELECT ok(has_function_privilege('authenticated','public.client_advance_onboarding_stage(text,jsonb)','EXECUTE'),'authenticated caller retains the existing checked stage ABI');
SELECT is(pg_temp.e09_stage('e0911000-0000-0000-0000-000000000001')->>'client_id','e0931000-0000-0000-0000-000000000001','stage writer resolves the actual external customer without raw SELECT');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'onboarding_stage','signing_agreement','stage change reloads through the canonical customer projection');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.e09_stage('e0911000-0000-0000-0000-000000000001')) k),ARRAY['client_id','onboarding_stage','updated_at']::text[],'stage return ABI stays exactly three columns');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='onboarding_stage_advanced' AND actor_user_id='e0911000-0000-0000-0000-000000000001' AND target_id='e0931000-0000-0000-0000-000000000001' AND payload->>'to_stage'='signing_agreement'),1::bigint,'exact actor and client receive one existing durable stage audit');
SELECT is(pg_temp.e09_stage('e0911000-0000-0000-0000-000000000001','invited')->>'onboarding_stage','signing_agreement','reverse stage remains a no-op');
SELECT is(pg_temp.e09_stage('e0911000-0000-0000-0000-000000000001','accepting_payment','{"client_id":"e0931000-0000-0000-0000-000000000002","tenant_id":"e0921000-0000-0000-0000-000000000002"}')->>'client_id','e0931000-0000-0000-0000-000000000001','payload supplies no foreign target authority');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000002')->>'onboarding_stage','invited','foreign customer stage is untouched');
UPDATE public.clients SET onboarding_stage='invited' WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_stage_error(NULL),'P0001','missing subject cannot change stage');
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000099'),'P0001','unlinked actor cannot change stage');
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001',NULL),'P0001','null stage is invalid');
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001','not-a-stage'),'P0001','unknown stage is invalid');
SELECT is(pg_temp.e09_stage_error(NULL,'completed','anon'),'42501','anonymous stage request fails at execution permission');
SELECT ok(pg_temp.e09_stage_error(NULL,'completed','service_role')=ANY(ARRAY['42501','P0001']),'service role alone cannot become an external customer');

UPDATE public.clients SET linked_user_id=NULL WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001'),'P0001','revoked link cannot advance stage');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'revocation is effective on reload');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'revoked link has no frame');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001'),'{"brand":null,"config":{}}'::jsonb,'presentation revocation is effective on the next server read');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000001',status='archived' WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001'),'P0001','archived relationship cannot advance stage');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'archived relationship cannot read profile');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'archived relationship has no frame');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001'),'{"brand":null,"config":{}}'::jsonb,'archived relationship cannot resolve customer presentation');
-- Trusted fixture executor uses the existing governed lineage convention; same
-- tenant survivor and paired timestamp. Actual authenticated reads remain below.
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET status='active',merged_into_contact_id='e0931000-0000-0000-0000-000000000003',merged_at=now() WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT set_config('app.crm_merge_lineage_write','off',true);
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'merged relationship cannot read profile');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'merged relationship has no frame');
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001'),'P0001','merged relationship cannot advance stage');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001'),'{"brand":null,"config":{}}'::jsonb,'merged relationship cannot resolve customer presentation');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SET LOCAL ROLE service_role;
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id=NULL,merged_at=NULL,first_name='Updated',paige_shared_context_consent=true WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT set_config('app.crm_merge_lineage_write','off',true);
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'first_name','Updated','reload reads canonical updated name');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'paige_shared_context_consent','true','reload reads actual shared-context consent');
UPDATE public.tenants SET status='suspended' WHERE id='e0921000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001'),'P0001','inactive sponsoring business cannot advance stage');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'inactive business has no frame');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001'),'{"brand":null,"config":{}}'::jsonb,'inactive sponsoring business cannot resolve customer presentation');
UPDATE public.tenants SET status='active' WHERE id='e0921000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'config'->'welcome'->>'headline','Saved greeting A','returning to an active legitimate relationship reloads its saved configuration');

-- Future multi-business shape is synthetic within this rollback only. Production's
-- unique linkage is unchanged; current readers must already refuse ambiguity.
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'fixture starts with the canonical global partial unique link index');
DROP INDEX public.clients_linked_user_id_unique;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_tenant_linked_user_key') AND indisunique),'future cross-business fixture preserves the per-tenant unique link');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000001' WHERE id='e0931000-0000-0000-0000-000000000002';
SELECT set_config('request.jwt.claims','{"sub":"e0911000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT throws_ok($$ SELECT * FROM public.get_client_portal_brand() $$,'42501','select an authorized customer relationship','ambiguous business brand refuses instead of choosing the oldest row');
SELECT throws_ok($$ SELECT public.get_client_portal_config() $$,'42501','select an authorized customer relationship','ambiguous business configuration refuses instead of choosing the oldest row');
SELECT throws_ok($$ SELECT public.client_portal_frame() $$,'42501','select an authorized customer relationship','atomic frame refuses ambiguous future customer relationships');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.e09_stage_error('e0911000-0000-0000-0000-000000000001'),'42501','ambiguous future relationships cannot advance an arbitrary client stage');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000002' WHERE id='e0931000-0000-0000-0000-000000000002';
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'future-shape cleanup restores the canonical global guard before outer rollback');
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001')->>'onboarding_stage','invited','all denied stage attempts preserve the last legitimate saved stage');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='onboarding_stage_advanced' AND target_id='e0931000-0000-0000-0000-000000000001'),2::bigint,'no-op and refused stage requests add no success audit');

-- Same fully replayed database-contract job. No new workflow or identity store.
SELECT ok((SELECT provolatile='s' AND prosecdef AND pronargs=0
 AND proconfig=ARRAY['search_path=public, pg_temp']::text[]
 FROM pg_proc WHERE oid='public.client_portal_frame()'::regprocedure),
 'atomic frame is a zero-argument STABLE definer with fixed search path');
SELECT ok(has_function_privilege('authenticated','public.client_portal_frame()','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_frame()','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_frame()','EXECUTE'),
 'only the ordinary authenticated role receives frame execution');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->>'actor_id',
 'e0911000-0000-0000-0000-000000000001','frame actor comes from the actual caller claims');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->'profile'->>'id',
 'e0931000-0000-0000-0000-000000000001','frame uses the caller canonical client record');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->'brand'->>'tenant_id',
 'e0921000-0000-0000-0000-000000000001','frame brand belongs to that client business');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->'config'->'welcome'->>'headline',
 'Saved greeting A','frame reload reads the saved canonical portal configuration');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000002')->'brand'->>'tenant_id',
 'e0921000-0000-0000-0000-000000000002','another subject receives its own business frame');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000002')->'config'->'welcome'->>'headline',
 'Saved greeting B','another subject receives its own saved business configuration');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(
 pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')) k),
 ARRAY['actor_id','brand','config','profile']::text[],'frame has the closed top-level contract');
SELECT ok(position('PRIVATE CRM NOTE' in pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')::text)=0
 AND position('Saved greeting B' in pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')::text)=0,
 'frame excludes private CRM notes and the other business configuration');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000099'),NULL::jsonb,
 'unlinked authenticated subject receives no customer frame');
SELECT throws_ok($$ SELECT pg_temp.e09_frame(NULL) $$,'42501','customer authentication required',
 'an absent subject cannot borrow a customer frame');
SELECT throws_ok($$ SELECT pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001','anon') $$,
 '42501','permission denied for function client_portal_frame','anonymous caller cannot execute the frame');
SELECT throws_ok($$ SELECT pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001','service_role') $$,
 '42501','permission denied for function client_portal_frame','service credential is not customer identity');
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->'profile'->>'first_name','Updated',
 'returning frame reloads the saved profile after legitimate access is restored');
SELECT is((SELECT count(*) FROM public.paige_audit_log WHERE action='onboarding_stage_advanced' AND target_id='e0931000-0000-0000-0000-000000000001'),2::bigint,
 'frame reads produce no new action-success audit');

-- Mutation control in this disposable, rolled-back test transaction only:
-- corrupt the native brand projection, then remove ONLY the frame's matching
-- business predicate. The first case must refuse; the deliberately unsafe
-- variant must compose the mismatch, proving that the assertion is meaningful.
CREATE FUNCTION pg_temp.e09_frame_brand_control(_remove_guard boolean)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
 _brand text := pg_get_functiondef('public.get_client_portal_brand()'::regprocedure);
 _frame text := pg_get_functiondef('public.client_portal_frame()'::regprocedure);
 _result jsonb;
 _state text;
 _guard text := 'WHERE b.tenant_id = (_profile->>''tenant_id'')::uuid';
BEGIN
 IF position('rb.tenant_id, rb.tenant_name, rb.tenant_slug' in _brand)=0
    OR position(_guard in _frame)=0 THEN
  RAISE EXCEPTION 'frame control source anchor missing';
 END IF;
 EXECUTE replace(_brand,'rb.tenant_id, rb.tenant_name, rb.tenant_slug',
  '''e0921000-0000-0000-0000-000000000002''::uuid, rb.tenant_name, rb.tenant_slug');
 IF _remove_guard THEN EXECUTE replace(_frame,_guard,''); END IF;
 BEGIN
  _result := pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001');
  _state := CASE WHEN _result->'brand'->>'tenant_id' <> _result->'profile'->>'tenant_id'
   THEN 'unsafe_mismatch_observed' ELSE 'unexpected_success' END;
 EXCEPTION WHEN insufficient_privilege THEN _state := SQLSTATE;
 END;
 EXECUTE _brand;
 EXECUTE _frame;
 RETURN _state;
EXCEPTION WHEN OTHERS THEN
 EXECUTE _brand;
 EXECUTE _frame;
 RAISE;
END;
$$;
SELECT is(pg_temp.e09_frame_brand_control(false),'42501',
 'native frame refuses a deliberately mismatched native brand');
SELECT is(pg_temp.e09_frame_brand_control(true),'unsafe_mismatch_observed',
 'removing only the business predicate makes the deliberate mismatch observable');
SELECT is(pg_temp.e09_frame('e0911000-0000-0000-0000-000000000001')->'brand'->>'tenant_id',
 'e0921000-0000-0000-0000-000000000001','mutation control restores both actual native function definitions');
-- Private AI conversation extends the same native tables/issued v2 receipts.
-- Synthetic caller claims in this rollback-only, fully replayed database job.
CREATE FUNCTION pg_temp.e09_chat(_actor uuid,_sql text,_role text DEFAULT 'authenticated')
RETURNS text LANGUAGE plpgsql AS $$
DECLARE _result text;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 EXECUTE _sql INTO _result;
 RESET ROLE;
 PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _result;
END $$;
CREATE TEMP TABLE e09_customer_chat(thread_id uuid);
-- Retained workspace history for the same actor/contact must not collide with
-- or become readable as the newly created private customer audience.
INSERT INTO public.paige_chat_threads(caller_user_id,contact_id,tenant_id,lens,title,consent_snapshot)
 VALUES('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001',
 'e0921000-0000-0000-0000-000000000001','client','Synthetic staff-focused history','{}');
INSERT INTO e09_customer_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create(NULL,'customer','Private customer conversation','{}')$$)::uuid;
SELECT is((SELECT audience FROM public.paige_chat_threads WHERE id=(SELECT thread_id FROM e09_customer_chat)),
 'customer_private','ordinary customer receives the canonical private audience');
SELECT is((SELECT contact_id::text FROM public.paige_chat_threads WHERE id=(SELECT thread_id FROM e09_customer_chat)),
 'e0931000-0000-0000-0000-000000000001','thread subject is the native relationship');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create(NULL,'customer','Return','{}')$$),
 (SELECT thread_id::text FROM e09_customer_chat),'returning customer resumes the same thread');
-- Global staff classification in another business must not turn a linked
-- customer relationship or its private thread into business-write authority.
INSERT INTO public.user_roles(user_id,role) VALUES('e0911000-0000-0000-0000-000000000001','sales_rep');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 ('e0921000-0000-0000-0000-000000000002','e0911000-0000-0000-0000-000000000001','owner','active');
SELECT ok(public.is_staff('e0911000-0000-0000-0000-000000000001'),
 'mixed-role negative control really passes the incumbent global staff gate');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.client_portal_relationship_id()$$),'e0931000-0000-0000-0000-000000000001',
 'a staff workspace elsewhere does not change the native customer relationship');
SELECT ok(public.can_access_contact('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001'),
 'incumbent two-argument contact read preserves linked-customer access');
SELECT ok(NOT public.can_access_contact('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001',false),
 'internal staff narrowing excludes the linked-customer-only permission');
SELECT ok(NOT has_function_privilege('anon','public.can_access_contact(uuid,uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.can_access_contact(uuid,uuid,boolean)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.can_access_contact(uuid,uuid,boolean)','EXECUTE'),
 'internal actor-explicit narrowing is not a caller-accessible RPC');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $s$SELECT public.can_access_contact('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001',false)$s$)$q$,
 '42501','permission denied for function can_access_contact','authenticated callers cannot select the internal permission mode');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $s$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000001','client','Denied customer read escalation','{}')$s$)$q$,
 '42501','workspace contact unavailable','customer read permission cannot authorize workspace thread creation');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $s$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000002','platform','Denied lens escalation','{}')$s$)$q$,
 '42501','platform lens requires authorized self scope','a contact argument cannot bypass native platform authority');
CREATE TEMP TABLE e09_private_effect_baseline AS SELECT
 (SELECT count(*) FROM public.tasks) AS tasks,
 (SELECT count(*) FROM public.client_notes) AS notes,
 (SELECT count(*) FROM public.paige_audit_log) AS audit;
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L)$q$,
 format($s$SELECT public.paige_tool_create_task(%L,'e0931000-0000-0000-0000-000000000001','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL,NULL,NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 'P0001','thread not found','mixed-role customer cannot use private Chat as staff task authority');
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L)$q$,
 format($s$SELECT public.paige_tool_add_client_note(%L,'e0931000-0000-0000-0000-000000000001','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 'P0001','thread not found','mixed-role customer cannot use private Chat as staff note authority');
UPDATE public.clients SET cs_primary_user_id='e0911000-0000-0000-0000-000000000001'
 WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT ok(public.can_access_contact('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001',false),
 'explicit staff assignment remains canonical staff-contact authority');
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L)$q$,
 format($s$SELECT public.paige_tool_create_task(%L,'e0931000-0000-0000-0000-000000000001','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL,NULL,NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 'P0001','thread not found','even assigned staff cannot authorize a task with customer-private Chat');
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L)$q$,
 format($s$SELECT public.paige_tool_add_client_note(%L,'e0931000-0000-0000-0000-000000000001','PRIVATE_AUDIENCE_MUST_NOT_WRITE',NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 'P0001','thread not found','even assigned staff cannot authorize a note with customer-private Chat');
SELECT ok((SELECT tasks=(SELECT count(*) FROM public.tasks)
 AND notes=(SELECT count(*) FROM public.client_notes)
 AND audit=(SELECT count(*) FROM public.paige_audit_log) FROM e09_private_effect_baseline),
 'all refused private-context staff calls leave no task, note or audit effect');
-- Check the canonical owner-work root without invoking a worker or provider.
-- The actor is genuinely a member of this business, so audience is the refusal.
INSERT INTO public.tenant_members(tenant_id,user_id,role,status) VALUES
 ('e0921000-0000-0000-0000-000000000001','e0911000-0000-0000-0000-000000000001','owner','active');
CREATE TEMP TABLE e09_private_work_baseline AS SELECT count(*) AS work FROM public.paige_durable_work;
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L,'service_role')$q$,
 format($s$SELECT work_id FROM public.create_paige_durable_work('e0921000-0000-0000-0000-000000000001',
 'e0911000-0000-0000-0000-000000000001',gen_random_uuid(),%L,'document_generate','document_authoring',
 '{"tenant_id":"e0921000-0000-0000-0000-000000000001","actor_user_id":"e0911000-0000-0000-0000-000000000001"}',
 'e09-private-native-check',60,5)$s$,(SELECT thread_id FROM e09_customer_chat))),
 '42501','DURABLE_WORK_THREAD_FORBIDDEN','private Chat cannot authorize owner work even for a current member of its business');
SELECT ok((SELECT work=(SELECT count(*) FROM public.paige_durable_work) FROM e09_private_work_baseline),
 'private-context owner-work refusal leaves no durable envelope or worker wake-up');
DELETE FROM public.tenant_members WHERE user_id='e0911000-0000-0000-0000-000000000001'
 AND tenant_id='e0921000-0000-0000-0000-000000000001';
-- The same canonical staff tools still work from genuinely authorized workspace
-- conversations. These are rollback-only native writes, not provider actions.
CREATE TEMP TABLE e09_staff_chat(thread_id uuid,purpose text);
INSERT INTO e09_staff_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000001','coach','Assigned staff conversation','{}')$$)::uuid,'assigned';
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_tool_add_client_note(%L,'e0931000-0000-0000-0000-000000000001','Authorized assigned staff note',NULL)$s$,
 (SELECT thread_id FROM e09_staff_chat WHERE purpose='assigned')))::jsonb)->>'ok','true',
 'explicit assigned staff retain their canonical workspace note writer');
UPDATE public.clients SET cs_primary_user_id=NULL WHERE id='e0931000-0000-0000-0000-000000000001';
UPDATE public.paige_chat_threads SET is_archived=true WHERE id=(SELECT thread_id FROM e09_staff_chat WHERE purpose='assigned');
-- Native agency ownership must also survive the shared predicate refactor.
UPDATE public.tenants SET account_type='agency' WHERE id='e0921000-0000-0000-0000-000000000002';
UPDATE public.tenants SET parent_tenant_id='e0921000-0000-0000-0000-000000000002' WHERE id='e0921000-0000-0000-0000-000000000001';
SELECT ok(public.agency_can_manage_child('e0921000-0000-0000-0000-000000000001','e0911000-0000-0000-0000-000000000001')
 AND public.can_access_contact('e0911000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001',false),
 'native parent-agency authority survives the shared contact narrowing');
INSERT INTO e09_staff_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000001','coach','Agency staff conversation','{}')$$)::uuid,'agency';
SELECT ok((SELECT audience='workspace' FROM public.paige_chat_threads WHERE id=(SELECT thread_id FROM e09_staff_chat WHERE purpose='agency')),
 'native parent-agency staff retain workspace conversation creation');
UPDATE public.tenants SET parent_tenant_id=NULL WHERE id='e0921000-0000-0000-0000-000000000001';
UPDATE public.tenants SET account_type='standalone' WHERE id='e0921000-0000-0000-0000-000000000002';
INSERT INTO e09_staff_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000002','client','Authorized owner conversation','{}')$$)::uuid,'owner';
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_tool_create_task(%L,'e0931000-0000-0000-0000-000000000002','Authorized workspace staff task',NULL,NULL,NULL)$s$,
 (SELECT thread_id FROM e09_staff_chat WHERE purpose='owner')))::jsonb)->>'ok','true',
 'native business owner retains the canonical workspace task writer');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_tool_add_client_note(%L,'e0931000-0000-0000-0000-000000000002','Authorized workspace staff note',NULL)$s$,
 (SELECT thread_id FROM e09_staff_chat WHERE purpose='owner')))::jsonb)->>'ok','true',
 'native business owner retains the canonical workspace note writer');
SELECT ok(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT work_id FROM public.create_paige_durable_work('e0921000-0000-0000-0000-000000000002',
 'e0911000-0000-0000-0000-000000000001',gen_random_uuid(),%L,'document_generate','document_authoring',
 '{"tenant_id":"e0921000-0000-0000-0000-000000000002","actor_user_id":"e0911000-0000-0000-0000-000000000001"}',
 'e09-workspace-native-check',60,5)$s$,(SELECT thread_id FROM e09_staff_chat WHERE purpose='owner')),'service_role') IS NOT NULL,
 'canonical durable-work root preserves genuine member workspace envelopes without running a provider');
INSERT INTO e09_staff_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.paige_chat_thread_create(NULL,'coach','Authorized personal workspace','{}')$$)::uuid,'self';
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_tool_create_task(%L,NULL,'Authorized personal task',NULL,NULL,NULL)$s$,
 (SELECT thread_id FROM e09_staff_chat WHERE purpose='self')))::jsonb)->>'ok','true',
 'native member retains own-workspace Chat and personal task semantics');
DELETE FROM public.tenant_members WHERE user_id='e0911000-0000-0000-0000-000000000001';
DELETE FROM public.user_roles WHERE user_id='e0911000-0000-0000-0000-000000000001' AND role='sales_rep';
SELECT throws_like($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $s$SELECT public.paige_chat_thread_create(NULL,'coach','Denied absent workspace','{}')$s$)$q$,
 '%self-mode requires caller tenant%','absent native membership cannot borrow a self workspace');
SELECT throws_like($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $s$SELECT public.paige_chat_thread_create('e0931000-0000-0000-0000-000000000002','customer','Forged','{}')$s$)$q$,
 '%customer subject is server resolved%','request cannot choose another customer');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_chat_interactive_begin_v2(%L,'e0941000-0000-4000-8000-000000000001',
 NULL,'Private customer question',false,false,false)$s$,(SELECT thread_id FROM e09_customer_chat)))::jsonb)->>'status',
 'accepted','existing staged v2 admits a non-effectful customer conversation');
SELECT throws_like(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 %L)$q$,format($s$SELECT public.paige_chat_turn_append(%L,'assistant','Forged',NULL,NULL,NULL,NULL,NULL,NULL,NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 '%customer answers require a server-issued receipt%','customer cannot forge durable AI text');
SELECT throws_like(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 %L)$q$,format($s$UPDATE public.paige_chat_threads SET audience='workspace' WHERE id=%L RETURNING id$s$,
 (SELECT thread_id FROM e09_customer_chat))),
 '%customer thread audience is immutable%','private history cannot be relabeled as business history');
SELECT ok(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_chat_interactive_settle(%L,'e0911000-0000-0000-0000-000000000001',
 'e0921000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000001',
 'A private customer answer',NULL,NULL,'{"interactive":{"request_intent_id":"e0941000-0000-4000-8000-000000000001"},"turn_state":{"v":1,"state":"FINAL"}}',NULL)$s$,
 (SELECT thread_id FROM e09_customer_chat)),'service_role') IS NOT NULL,
 'existing service-only settlement saves an issued customer answer');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT count(*) FROM public.paige_chat_turns WHERE thread_id=%L$s$,(SELECT thread_id FROM e09_customer_chat))),
 '2','returning customer can read the two issued canonical turns');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT count(*) FROM public.paige_chat_turns WHERE thread_id=%L$s$,(SELECT thread_id FROM e09_customer_chat))),
 '0','another legitimate customer cannot read private history');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT public.paige_chat_interactive_publication_context_v2(%L,'e0941000-0000-4000-8000-000000000001')$s$,
 (SELECT thread_id FROM e09_customer_chat))),'true','native publication checks the customer relationship without a staff workspace');
-- Exercise the current active-v2 protocol as well as staged conversation. This
-- protocol flag is changed only in this disposable rollback transaction.
CREATE TEMP TABLE e09_active_chat(thread_id uuid);
CREATE TEMP TABLE e09_rollout_baseline AS SELECT active FROM public.paige_chat_interactive_rollout WHERE singleton;
INSERT INTO e09_active_chat SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 $$SELECT public.paige_chat_thread_create(NULL,'customer','Active protocol customer','{}')$$)::uuid;
UPDATE public.paige_chat_interactive_rollout SET active=true WHERE singleton;
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT public.paige_chat_interactive_begin_v2(%L,'e0941000-0000-4000-8000-000000000002',
 NULL,'Active protocol question',false,false,true)$s$,(SELECT thread_id FROM e09_active_chat)))::jsonb)->>'status',
 'accepted','active v2 admits an ordinary customer without staff membership');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT public.paige_chat_interactive_executor_v2(%L,'e0911000-0000-0000-0000-000000000002',
 'e0921000-0000-0000-0000-000000000002','e0941000-0000-4000-8000-000000000002','acquire')$s$,
 (SELECT thread_id FROM e09_active_chat)),'service_role')::jsonb)->>'acquired','true',
 'active customer turn acquires the canonical service-only executor');
SELECT ok(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT public.paige_chat_interactive_settle(%L,'e0911000-0000-0000-0000-000000000002',
 'e0921000-0000-0000-0000-000000000002','e0941000-0000-4000-8000-000000000002','Active customer answer',NULL,NULL,
 '{"interactive":{"request_intent_id":"e0941000-0000-4000-8000-000000000002"},"turn_state":{"v":1,"state":"FINAL"}}',NULL)$s$,
 (SELECT thread_id FROM e09_active_chat)),'service_role') IS NOT NULL,
 'active customer answer uses the existing service-only terminal writer');
SELECT ok(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT public.paige_chat_interactive_executor_v2(%L,'e0911000-0000-0000-0000-000000000002',
 'e0921000-0000-0000-0000-000000000002','e0941000-0000-4000-8000-000000000002','release')$s$,
 (SELECT thread_id FROM e09_active_chat)),'service_role') IS NOT NULL,'active customer executor releases after terminal settlement');
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 format($s$SELECT public.paige_chat_interactive_publication_context_v2(%L,'e0941000-0000-4000-8000-000000000002')$s$,
 (SELECT thread_id FROM e09_active_chat))),'true','active customer publishes under native relationship authority');
UPDATE public.paige_chat_interactive_rollout SET active=(SELECT active FROM e09_rollout_baseline) WHERE singleton;
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 format($s$SELECT count(*) FROM public.paige_chat_turns WHERE thread_id=%L$s$,(SELECT thread_id FROM e09_customer_chat))),
 '0','revoked relationship loses private-history access');
SELECT is((SELECT count(*)::int FROM public.paige_chat_turns WHERE thread_id=(SELECT thread_id FROM e09_customer_chat)),
 2,'revocation retains canonical receipts without granting access');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000001'
 WHERE id='e0931000-0000-0000-0000-000000000001';

-- Native referential cleanup must preserve the incumbent ON DELETE SET NULL
-- disposition, archive detached private text and continue refusing identity edits.
-- Assistant settings use the existing writer and native tenant authority.
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0911000-0000-0000-0000-000000000003','e09-config-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0911000-0000-0000-0000-000000000004','e09-config-foreign@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner) VALUES
 ('e0921000-0000-0000-0000-000000000001','e0911000-0000-0000-0000-000000000003','owner','active',true),
 ('e0921000-0000-0000-0000-000000000002','e0911000-0000-0000-0000-000000000004','admin','active',false);
UPDATE public.tenants SET features=features || '{"unrelated_feature":{"keep":true}}'::jsonb
 WHERE id='e0921000-0000-0000-0000-000000000001';
SELECT lives_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000001',
 '{"assistant":{"enabled":false,"display_name":"Saved client guide","tone":"Clear","future_setting":"keep"}}')$$)$q$,
 'native owner configures its customer assistant through the existing writer');
SELECT lives_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000001','{"assistant":{"tone":"Warm"}}')$$)$q$,
 'a later partial assistant edit preserves saved policy');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'config'->'assistant',
 '{"enabled":false,"display_name":"Saved client guide","tone":"Warm","future_setting":"keep"}'::jsonb,
 'ordinary customer reloads the same bounded saved assistant configuration');
SELECT is((SELECT features->'unrelated_feature' FROM public.tenants WHERE id='e0921000-0000-0000-0000-000000000001'),
 '{"keep":true}'::jsonb,'configuration leaves unrelated canonical features intact');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000001','{"assistant":{"enabled":true}}')$$)$q$,
 '42501','portal_config_forbidden','customer relationship cannot configure its business assistant');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000004',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000001','{"assistant":{"enabled":true}}')$$)$q$,
 '42501','portal_config_forbidden','admin from another business cannot change customer assistant policy');
SELECT lives_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000004',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000002','{"assistant":{"display_name":"Business B guide"}}')$$)$q$,
 'another legitimate business configures its own assistant through the same writer');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001')->'config'->'assistant'->>'display_name',
 'Saved client guide','another business save cannot change this customer assistant');
UPDATE public.tenant_members SET status='inactive' WHERE user_id='e0911000-0000-0000-0000-000000000003';
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.set_tenant_portal_config('e0921000-0000-0000-0000-000000000001','{"assistant":{"enabled":true}}')$$)$q$,
 '42501','portal_config_forbidden','revoked owner cannot save customer assistant settings');
SELECT ok(NOT has_function_privilege('anon','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE')
 AND has_function_privilege('authenticated','public.set_tenant_portal_config(uuid,jsonb)','EXECUTE'),
 'existing authenticated-only writer ACL remains exact');

-- Explicit customer Knowledge shares use the fully replayed native authority,
-- canonical Knowledge documents and the same customer relationship resolver.
UPDATE public.tenant_members SET status='active' WHERE user_id='e0911000-0000-0000-0000-000000000003';
INSERT INTO public.profiles(user_id,active_tenant_id) VALUES
 ('e0911000-0000-0000-0000-000000000003','e0921000-0000-0000-0000-000000000001'),
 ('e0911000-0000-0000-0000-000000000004','e0921000-0000-0000-0000-000000000002')
 ON CONFLICT(user_id) DO UPDATE SET active_tenant_id=EXCLUDED.active_tenant_id;
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by) VALUES
 ('e0941000-0000-4000-8000-000000000001','e0921000-0000-0000-0000-000000000001','Customer program','Approved program guidance','e0911000-0000-0000-0000-000000000003'),
 ('e0941000-0000-4000-8000-000000000002','e0921000-0000-0000-0000-000000000002','Foreign program','FOREIGN GUIDANCE','e0911000-0000-0000-0000-000000000004');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.client_portal_knowledge_context('e0921000-0000-0000-0000-000000000001')$$)::jsonb)->'sources',
 '[]'::jsonb,'internal Knowledge remains excluded before an explicit owner grant');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000001')$$)$q$,
 '42501','CUSTOMER_KNOWLEDGE_FORBIDDEN','customer cannot publish business Knowledge');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000004',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000001')$$)$q$,
 '42501','CUSTOMER_KNOWLEDGE_FORBIDDEN','another business administrator cannot prepare this publication');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000002')$$)$q$,
 '42501','CUSTOMER_KNOWLEDGE_SOURCE_UNAVAILABLE','owner cannot substitute a foreign source');
CREATE TEMP TABLE e09_knowledge_proposal AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000001')$$)::jsonb proposal;
CREATE TEMP TABLE e09_knowledge_result AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',format(
 'SELECT public.set_client_portal_knowledge_share(%L,%L,%L,true,%s,%L,%L)',
 proposal->>'tenant_id',proposal->>'contact_id',proposal->>'document_id',proposal->>'expected_share_revision',proposal->>'proposal_hash','e0951000-0000-4000-8000-000000000001'))::jsonb result FROM e09_knowledge_proposal;
SELECT is((SELECT result->>'currently_available' FROM e09_knowledge_result),'true','native reviewed grant is available after commit within the transaction');
SELECT is((SELECT user_id::text FROM public.audit_logs WHERE id='e0951000-0000-4000-8000-000000000001'),
 'e0911000-0000-0000-0000-000000000003','publication receipt attributes the actual owner');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.client_portal_knowledge_context('e0921000-0000-0000-0000-000000000001')$$)::jsonb)#>>'{sources,0,content}',
 'Approved program guidance','customer reloads only explicitly shared canonical content');
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,'e0941000-0000-4000-8000-000000000001'))::jsonb)->'sources',
 '[]'::jsonb,'compatible direct admission cannot acquire later published program sources') FROM e09_customer_chat;
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,'e0941000-0000-4000-8000-000000000001'))::jsonb)->'snapshot',
 'null'::jsonb,'compatible native acceptance cannot be retrofitted with source attestation') FROM e09_customer_chat;
CREATE TEMP TABLE e09_knowledge_refs AS SELECT jsonb_build_object('share_id',upper(s.id::text),
 'share_revision',s.revision,'source_fingerprint',s.source_fingerprint) ref
 FROM public.tenant_knowledge_client_shares s JOIN e09_knowledge_result r ON s.id=(r.result->>'share_id')::uuid;
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',format(
 'SELECT public.client_portal_knowledge_context(%L,%L::jsonb)','e0921000-0000-0000-0000-000000000001',jsonb_build_array(ref)::text))::jsonb)#>>'{sources,0,share_id}',
 (SELECT result->>'share_id' FROM e09_knowledge_result),'an authorized UUID case alias resolves the canonical source') FROM e09_knowledge_refs;
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',format(
 'SELECT public.client_portal_knowledge_context(%L,%L::jsonb)','e0921000-0000-0000-0000-000000000001',
 jsonb_build_array(ref,ref||jsonb_build_object('share_id',lower(ref->>'share_id')))::text)) FROM e09_knowledge_refs$q$,
 '22023','CUSTOMER_KNOWLEDGE_ARGUMENTS_INVALID','UUID case aliases cannot duplicate one source identity');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000002',
 $$SELECT public.client_portal_knowledge_context('e0921000-0000-0000-0000-000000000001')$$)$q$,
 '42501','CUSTOMER_KNOWLEDGE_FORBIDDEN','wrong customer cannot read the shared business content');
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.list_client_portal_knowledge_shares('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001')$$)$q$,
 '42501','CUSTOMER_KNOWLEDGE_FORBIDDEN','customer cannot read owner sharing administration');
INSERT INTO auth.users(id,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0911000-0000-0000-0000-000000000005','e09-peer-client@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000005'
 WHERE id='e0931000-0000-0000-0000-000000000003';
INSERT INTO public.tenant_knowledge_docs(id,tenant_id,title,content,created_by) VALUES
 ('e0941000-0000-4000-8000-000000000003','e0921000-0000-0000-0000-000000000001','Peer program','OTHER CUSTOMER GUIDANCE','e0911000-0000-0000-0000-000000000003');
CREATE TEMP TABLE e09_peer_proposal AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000003','e0941000-0000-4000-8000-000000000003')$$)::jsonb proposal;
CREATE TEMP TABLE e09_peer_result AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',format(
 'SELECT public.set_client_portal_knowledge_share(%L,%L,%L,true,%s,%L,%L)',
 proposal->>'tenant_id',proposal->>'contact_id',proposal->>'document_id',proposal->>'expected_share_revision',proposal->>'proposal_hash','e0951000-0000-4000-8000-000000000003'))::jsonb result FROM e09_peer_proposal;
SELECT is(jsonb_path_query_array(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',
 $$SELECT public.client_portal_knowledge_context('e0921000-0000-0000-0000-000000000001')$$)::jsonb,'$.sources[*].document_id'),
 '["e0941000-0000-4000-8000-000000000003"]'::jsonb,'another customer in the same business sees only its own program');
CREATE TEMP TABLE e09_peer_refs AS SELECT jsonb_build_array(jsonb_build_object('share_id',s.id,
 'share_revision',s.revision,'source_fingerprint',s.source_fingerprint)) refs
 FROM public.tenant_knowledge_client_shares s JOIN e09_peer_result p ON s.id=(p.result->>'share_id')::uuid;
SELECT throws_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',format(
 'SELECT public.client_portal_knowledge_context(%L,%L::jsonb)','e0921000-0000-0000-0000-000000000001',refs::text)) FROM e09_peer_refs$q$,
 '42501','CUSTOMER_KNOWLEDGE_SOURCE_WITHDRAWN','same-business membership cannot authorize another customer source reference');
SELECT ok((SELECT NOT polpermissive FROM pg_policy WHERE polrelid='public.tenant_knowledge_client_shares'::regclass
 AND polname='customer_knowledge_shares_no_direct_access'),'raw sharing metadata deny policy is restrictive');
SELECT ok(NOT has_table_privilege('authenticated','public.tenant_knowledge_client_shares','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('anon','public.tenant_knowledge_client_shares','SELECT,INSERT,UPDATE,DELETE')
 AND NOT has_table_privilege('service_role','public.tenant_knowledge_client_shares','SELECT,INSERT,UPDATE,DELETE'),
 'sharing metadata is RPC-only for every external API role');
SELECT ok(has_function_privilege('authenticated','public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_knowledge_context(uuid,jsonb,integer,integer,boolean)','EXECUTE'),
 'customer reader cannot be invoked through anonymous or service credentials');
UPDATE public.tenant_knowledge_docs SET content='A later unreviewed revision' WHERE id='e0941000-0000-4000-8000-000000000001';
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',
 $$SELECT public.client_portal_knowledge_context('e0921000-0000-0000-0000-000000000001')$$)::jsonb)->'sources',
 '[]'::jsonb,'the real Knowledge revision trigger retires a grant when its exact source changes');
CREATE TEMP TABLE e09_knowledge_withdraw AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',
 $$SELECT public.prepare_client_portal_knowledge_share('e0921000-0000-0000-0000-000000000001','e0931000-0000-0000-0000-000000000001','e0941000-0000-4000-8000-000000000001',false)$$)::jsonb proposal;
SELECT lives_ok($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000003',format(
 'SELECT public.set_client_portal_knowledge_share(%L,%L,%L,false,%s,%L,%L)',
 proposal->>'tenant_id',proposal->>'contact_id',proposal->>'document_id',proposal->>'expected_share_revision',proposal->>'proposal_hash','e0951000-0000-4000-8000-000000000002')) FROM e09_knowledge_withdraw$q$,
 'owner can withdraw even after the source has changed');
SELECT is((SELECT count(*)::int FROM public.audit_logs WHERE id IN('e0951000-0000-4000-8000-000000000001','e0951000-0000-4000-8000-000000000002')),
 2,'publication and withdrawal retain their distinct durable native receipts');

-- Additive customer source/history admission; native protocol and provider
-- admission stay unchanged. These synthetic rows roll back with the suite.
CREATE TEMP TABLE e09_context_protocol AS SELECT active FROM public.paige_chat_interactive_rollout WHERE singleton;
UPDATE public.paige_chat_interactive_rollout SET active=false WHERE singleton;
CREATE TEMP TABLE e09_context_thread AS SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',
 $$SELECT public.paige_chat_thread_create(NULL,'customer','Customer source context','{}')$$)::uuid thread_id;
CREATE TEMP TABLE e09_context_input AS SELECT thread_id,'e0961000-0000-4000-8000-000000000001'::uuid intent_id,
 pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,'e0961000-0000-4000-8000-000000000001'))::jsonb projection FROM e09_context_thread;
SELECT is(jsonb_path_query_array(projection,'$.sources[*].document_id'),
 '["e0941000-0000-4000-8000-000000000003"]'::jsonb,'native AI context contains only this actual customer program') FROM e09_context_input;
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000001',%L)$q$,
 format('SELECT public.client_portal_assistant_context(%L,%L)',thread_id,intent_id)),
 '42501','CUSTOMER_CONTEXT_FORBIDDEN','another customer cannot select a private model context') FROM e09_context_input;
SELECT is((pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.client_portal_assistant_begin(%L,%L,NULL,%L,false,false,false)',thread_id,intent_id,'My customer question'))::jsonb)->>'status',
 'accepted','customer adapter delegates native admission exactly once') FROM e09_context_input;
SELECT is((SELECT bundle_ref->'customer_knowledge' FROM public.paige_chat_turns WHERE thread_id=c.thread_id
 AND interactive_intent_id=c.intent_id AND role='user'),projection->'snapshot',
 'accepted user receipt captures the exact native source snapshot') FROM e09_context_input c;
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,intent_id))::jsonb,projection,
 'native context remains stable across its own ordinary admission') FROM e09_context_input;
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',%L,'service_role')$q$,
 format('SELECT public.paige_chat_interactive_settle(%L,%L,%L,%L,%L,NULL,NULL,%L::jsonb,NULL)',thread_id,
 'e0911000-0000-0000-0000-000000000005','e0921000-0000-0000-0000-000000000001',intent_id,'Forged answer',
 jsonb_build_object('interactive',jsonb_build_object('request_intent_id',intent_id),'turn_state',jsonb_build_object('v',1,'state','FINAL'),
 'customer_knowledge',jsonb_build_object('version',1,'retrieval_refs','[]'::jsonb,'source_refs','[]'::jsonb))::text)),
 '42501','CUSTOMER_CONTEXT_BINDING_INVALID','terminal cannot forge the native accepted source set') FROM e09_context_input;
CREATE TEMP TABLE e09_context_terminal AS SELECT c.*,jsonb_build_object('interactive',jsonb_build_object('request_intent_id',intent_id),
 'turn_state',jsonb_build_object('v',1,'state','FINAL'),'customer_knowledge',projection->'snapshot') bundle FROM e09_context_input c;
SELECT lives_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',%L,'service_role')$q$,
 format('SELECT public.paige_chat_interactive_settle(%L,%L,%L,%L,%L,NULL,NULL,%L::jsonb,NULL)',thread_id,
 'e0911000-0000-0000-0000-000000000005','e0921000-0000-0000-0000-000000000001',intent_id,'Approved customer program answer',bundle::text)),
 'canonical settlement accepts exact source-attested terminal metadata') FROM e09_context_terminal;
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.paige_chat_interactive_publication_context_v2(%L,%L)',thread_id,intent_id)),
 'true','current native source-attested terminal may publish') FROM e09_context_terminal;
SELECT ok(jsonb_path_exists(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,'e0961000-0000-4000-8000-000000000002'))::jsonb,
 '$.history[*] ? (@.content == "Approved customer program answer")'),
 'returning model context uses the actual source-attested private answer') FROM e09_context_terminal;
UPDATE public.tenant_knowledge_docs SET content='Changed unreviewed customer program'
 WHERE id='e0941000-0000-4000-8000-000000000003';
SELECT is(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.paige_chat_interactive_publication_context_v2(%L,%L)',thread_id,intent_id)),
 'false','post-settlement source change retires current publication permission') FROM e09_context_terminal;
SELECT throws_ok(format($q$SELECT pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',%L)$q$,
 format('SELECT public.client_portal_assistant_context(%L,%L)',thread_id,intent_id)),
 '42501','CUSTOMER_CONTEXT_SOURCE_WITHDRAWN','accepted stale source cannot be reacquired for a model retry') FROM e09_context_terminal;
SELECT ok(NOT jsonb_path_exists(pg_temp.e09_chat('e0911000-0000-0000-0000-000000000005',format(
 'SELECT public.client_portal_assistant_context(%L,%L)',thread_id,'e0961000-0000-4000-8000-000000000002'))::jsonb,
 '$.history[*] ? (@.content == "Approved customer program answer")'),
 'withdrawn generated prose is excluded from new model history') FROM e09_context_terminal;
SELECT is((SELECT count(*)::int FROM public.paige_chat_turns WHERE thread_id=c.thread_id AND content='Approved customer program answer'),
 1,'customer-owned canonical UI history persists after model-context withdrawal') FROM e09_context_terminal c;
SELECT ok(has_function_privilege('authenticated','public.client_portal_assistant_context(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_assistant_context(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_assistant_context(uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_assistant_begin(uuid,uuid,uuid,text,boolean,boolean,boolean)','EXECUTE'),
 'customer context and admission require actual caller JWT authority');
UPDATE public.paige_chat_interactive_rollout SET active=(SELECT active FROM e09_context_protocol) WHERE singleton;

DELETE FROM public.clients WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT ok((SELECT contact_id IS NULL AND is_archived FROM public.paige_chat_threads
 WHERE id=(SELECT thread_id FROM e09_customer_chat)),
 'canonical contact removal detaches and archives the private thread');
SELECT is((SELECT count(*)::int FROM public.paige_chat_turns WHERE thread_id=(SELECT thread_id FROM e09_customer_chat)),
 2,'contact removal retains private issued receipts without exposing them');
SELECT * FROM finish();
ROLLBACK;
