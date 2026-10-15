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

UPDATE public.clients SET linked_user_id=NULL WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'revocation is effective on reload');
SELECT is(pg_temp.e09_presentation('e0911000-0000-0000-0000-000000000001'),'{"brand":null,"config":{}}'::jsonb,'presentation revocation is effective on the next server read');
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000001',status='archived' WHERE id='e0931000-0000-0000-0000-000000000001';
SELECT is(pg_temp.e09_profile('e0911000-0000-0000-0000-000000000001'),NULL::jsonb,'archived relationship cannot read profile');
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
RESET ROLE;
SELECT set_config('request.jwt.claims','{}',true);
UPDATE public.clients SET linked_user_id='e0911000-0000-0000-0000-000000000002' WHERE id='e0931000-0000-0000-0000-000000000002';
CREATE UNIQUE INDEX clients_linked_user_id_unique ON public.clients(linked_user_id) WHERE linked_user_id IS NOT NULL;
SELECT ok(EXISTS (SELECT 1 FROM pg_index WHERE indexrelid=to_regclass('public.clients_linked_user_id_unique') AND indisunique AND pg_get_expr(indpred,indrelid)='(linked_user_id IS NOT NULL)'),'future-shape cleanup restores the canonical global guard before outer rollback');
SELECT * FROM finish();
ROLLBACK;
