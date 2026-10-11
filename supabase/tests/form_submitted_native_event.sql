-- ISOLATED full production-schema-only clone only; never execute on production.
-- INT-298 / INT-342 MBC slice 4a: form.submitted on the native event bus, through the real trigger.
BEGIN;
SET LOCAL timezone='UTC';
SELECT set_config('request.jwt.claim.sub','',true),set_config('request.jwt.claims','{"role":"service_role"}',true);
CREATE FUNCTION pg_temp.require_true(value boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF; END $$;
CREATE FUNCTION pg_temp.events(sub text) RETURNS bigint LANGUAGE sql AS $$
 SELECT count(*) FROM public.paige_native_events WHERE event_key='form.submitted' AND dedup_key='form.submitted:'||sub $$;

DO $fixture_owner$ DECLARE fixture_owner_id uuid; BEGIN
 IF (SELECT count(*) FROM public.user_roles WHERE role='super_admin')>1 THEN RAISE EXCEPTION 'FIXTURE: canonical owner is ambiguous'; END IF;
 SELECT user_id INTO fixture_owner_id FROM public.user_roles WHERE role='super_admin';
 IF fixture_owner_id IS NULL THEN
   fixture_owner_id := 'a2980400-0000-4000-8000-000000000004';
   INSERT INTO auth.users(id,email) VALUES(fixture_owner_id,'events-fixture-owner@example.invalid');
   INSERT INTO public.user_roles(user_id,role) VALUES(fixture_owner_id,'super_admin');
 END IF;
 PERFORM set_config('request.jwt.claims',jsonb_build_object('role','authenticated','sub',fixture_owner_id)::text,true);
END $fixture_owner$;
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,features) VALUES
 ('a2980400-0000-4000-8000-000000000011','events-proof-a','Events proof A','active','standalone','EPA','{"system_workspace":true}'),
 ('a2980400-0000-4000-8000-000000000012','events-proof-b','Events proof B','active','standalone','EPB','{"system_workspace":true}');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO auth.users(id,email) VALUES ('a2980400-0000-4000-8000-000000000001','events-owner@example.invalid');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number) VALUES
 ('a2980400-0000-4000-8000-0000000000c1','a2980400-0000-4000-8000-000000000011','a2980400-0000-4000-8000-000000000001','Dana','Lead','EPA-1'),
 ('a2980400-0000-4000-8000-0000000000c2','a2980400-0000-4000-8000-000000000012','a2980400-0000-4000-8000-000000000001','Other','Workspace','EPB-1');
INSERT INTO public.growth_forms(id,tenant_id,slug,name,status) VALUES
 ('a2980400-0000-4000-8000-0000000000f1','a2980400-0000-4000-8000-000000000011','events-form','Events form','active');

SELECT pg_temp.require_true((SELECT is_live AND dark_reason IS NULL FROM public.paige_automation_triggers WHERE key='form.submitted'),'form.submitted is a live trigger');

-- 1. A submission that arrives with its contact (external intake) fires once, with ids and tags only.
INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,contact_id,payload_json,utm_json,source) VALUES
 ('a2980400-0000-4000-8000-0000000000e1','a2980400-0000-4000-8000-000000000011','a2980400-0000-4000-8000-0000000000f1','a2980400-0000-4000-8000-0000000000c1',
  '{"email":"dana@example.invalid","message":"private answer"}','{"utm_source":"newsletter","utm_campaign":"CB-SPRING"}','external:test');
SELECT pg_temp.require_true(pg_temp.events('a2980400-0000-4000-8000-0000000000e1')=1,'a submission with a contact fires once');
DO $payload$ DECLARE e public.paige_native_events; BEGIN
 SELECT * INTO e FROM public.paige_native_events WHERE dedup_key='form.submitted:a2980400-0000-4000-8000-0000000000e1';
 IF e.tenant_id IS DISTINCT FROM 'a2980400-0000-4000-8000-000000000011' OR e.subject_table IS DISTINCT FROM 'clients' OR e.subject_id IS DISTINCT FROM 'a2980400-0000-4000-8000-0000000000c1' THEN RAISE EXCEPTION 'FAIL: subject is the contact in its tenant, got %',to_jsonb(e); END IF;
 IF e.payload->>'utm_campaign' IS DISTINCT FROM 'CB-SPRING' OR e.payload->>'utm_source' IS DISTINCT FROM 'newsletter'
    OR e.payload->>'form_id' IS DISTINCT FROM 'a2980400-0000-4000-8000-0000000000f1' OR e.payload->>'submission_id' IS DISTINCT FROM 'a2980400-0000-4000-8000-0000000000e1'
    OR e.payload->>'source' IS DISTINCT FROM 'external:test' THEN RAISE EXCEPTION 'FAIL: ids and tags in the payload, got %',e.payload; END IF;
 IF e.payload::text LIKE '%private answer%' OR e.payload::text LIKE '%dana@example%' THEN RAISE EXCEPTION 'FAIL: answers never enter the payload'; END IF;
END $payload$;

-- 2. A public submission (no contact) fires nothing until the processor pins one; then once, never again.
INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,payload_json) VALUES
 ('a2980400-0000-4000-8000-0000000000e2','a2980400-0000-4000-8000-000000000011','a2980400-0000-4000-8000-0000000000f1','{}');
SELECT pg_temp.require_true(pg_temp.events('a2980400-0000-4000-8000-0000000000e2')=0,'no contact, no event');
UPDATE public.growth_form_submissions SET contact_id='a2980400-0000-4000-8000-0000000000c1' WHERE id='a2980400-0000-4000-8000-0000000000e2';
SELECT pg_temp.require_true(pg_temp.events('a2980400-0000-4000-8000-0000000000e2')=1,'pinning the contact fires it');
UPDATE public.growth_form_submissions SET processing_state='done' WHERE id='a2980400-0000-4000-8000-0000000000e2';
UPDATE public.growth_form_submissions SET contact_id='a2980400-0000-4000-8000-0000000000c1' WHERE id='a2980400-0000-4000-8000-0000000000e2';
SELECT pg_temp.require_true(pg_temp.events('a2980400-0000-4000-8000-0000000000e2')=1,'later updates never fire it again');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,account_number) VALUES
 ('a2980400-0000-4000-8000-0000000000c3','a2980400-0000-4000-8000-000000000011','a2980400-0000-4000-8000-000000000001','Merged','Lead','EPA-2');
UPDATE public.growth_form_submissions SET contact_id='a2980400-0000-4000-8000-0000000000c3' WHERE id='a2980400-0000-4000-8000-0000000000e2';
SELECT pg_temp.require_true((SELECT count(*) FROM public.paige_native_events WHERE event_key='form.submitted' AND dedup_key='form.submitted:a2980400-0000-4000-8000-0000000000e2' AND subject_id='a2980400-0000-4000-8000-0000000000c1')=1
  AND pg_temp.events('a2980400-0000-4000-8000-0000000000e2')=1,'re-pinning to another contact is still the same submission, never a second event');

-- 3. A contact from another workspace is never delivered as this workspace's event.
INSERT INTO public.growth_form_submissions(id,tenant_id,form_id,contact_id,payload_json) VALUES
 ('a2980400-0000-4000-8000-0000000000e3','a2980400-0000-4000-8000-000000000011','a2980400-0000-4000-8000-0000000000f1','a2980400-0000-4000-8000-0000000000c2','{}');
SELECT pg_temp.require_true(pg_temp.events('a2980400-0000-4000-8000-0000000000e3')=0,'a foreign contact fires nothing');
ROLLBACK;
