-- E09 Sessions: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: a customer reads only their own bookings with their own business, through an explicit
-- allowlist (no host identity, guest PII, intake answers, notes or provider ids); the notice window
-- (calendars.min_notice_min before the CURRENT start) is computed on read and enforced on admission;
-- admission refuses everything that is not the caller's own changeable booking with one "not found";
-- request-id and state replay; and admission never writes public.internal_bookings.
BEGIN;
SELECT plan(175);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0961000-0000-4000-8000-000000000001','authenticated','authenticated','sessions-host-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000002','authenticated','authenticated','sessions-host-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000003','authenticated','authenticated','jordan.rivera@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000004','authenticated','authenticated','sessions-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000005','authenticated','authenticated','sessions-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000006','authenticated','authenticated','sessions-two-businesses@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000007','authenticated','authenticated','sessions-merged@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('e0962000-0000-4000-8000-000000000001','test-tenant-e09-sessions-a','Northwind Studio','active','standalone','E09SA',9461001,'{}'),
 ('e0962000-0000-4000-8000-000000000002','test-tenant-e09-sessions-b','Test tenant sessions B','active','standalone','E09SB',9461002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005','member','active',false,now());
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0963000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000003','e0961000-0000-4000-8000-000000000001','Jordan','Rivera','active'),
 ('e0963000-0000-4000-8000-000000000002','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000004','e0961000-0000-4000-8000-000000000001','Other','Customer','active'),
 ('e0963000-0000-4000-8000-000000000003','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Unconnected','Contact','active'),
 ('e0963000-0000-4000-8000-000000000004','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000006','e0961000-0000-4000-8000-000000000001','Two','Businesses','active'),
 ('e0963000-0000-4000-8000-000000000006','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000007','e0961000-0000-4000-8000-000000000001','Merged','Away','active');
-- The merged contact's survivor is the unconnected contact (same tenant, per the lineage FK).
-- The lineage guard admits only the governed service context (service-role claims, no subject).
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='e0963000-0000-4000-8000-000000000003',merged_at=now() WHERE id='e0963000-0000-4000-8000-000000000006';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);

INSERT INTO public.calendars(id,tenant_id,created_by,slug,title,accent,duration_min,min_notice_min,enabled,appointment_types) VALUES
 ('e0964000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','test-e09-sessions-northwind','Northwind consult','#3355AA',60,60,true,
  '[{"id":"t1","name":"Strategy call","duration_min":45}]'),
 ('e0964000-0000-4000-8000-000000000002','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','test-e09-sessions-paused','Paused calendar',NULL,30,60,false,'[]'),
 ('e0964000-0000-4000-8000-000000000003','e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000002','test-e09-sessions-tenant-b','Tenant B calendar',NULL,30,60,true,'[]');

-- Host A = ...001, host 2 in tenant A = staff ...005, host B = ...002. Times never overlap per host.
INSERT INTO public.internal_bookings(id,tenant_id,host_user_id,contact_id,calendar_id,title,notes,guest_email,guest_name,guest_phone,
  intake_answers,appointment_type,start_at,end_at,timezone,status,booking_kind,collective_group_id,class_session_id,location_type,location_value,meeting_url,zoom_meeting_id,source) VALUES
 -- A1: three hours out on a 60-minute calendar: changeable until two hours out.
 ('e0965000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'STAFF PRIVATE TITLE','PRIVATE STAFF NOTE','jordan.rivera@tests.invalid','Jordan Rivera','+15550000001','{"q":"PRIVATE INTAKE"}','{"id":"t1","name":"Strategy call","duration_min":45}',
  now()+interval '3 hours',now()+interval '4 hours','America/Chicago','scheduled','single',NULL,NULL,'zoom','https://zoom.example/j/1','https://zoom.example/j/1','ZOOM-PRIVATE-999','booking_page'),
 -- A2: thirty minutes out: the window closed half an hour ago.
 ('e0965000-0000-4000-8000-000000000002','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '30 minutes',now()+interval '60 minutes','UTC','scheduled','single',NULL,NULL,'phone','+15550000002',NULL,NULL,'internal'),
 -- A3: no calendar.
 ('e0965000-0000-4000-8000-000000000003','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001',NULL,
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '5 hours',now()+interval '5 hours 30 minutes','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 -- A4: paused calendar: may cancel, may not reschedule.
 ('e0965000-0000-4000-8000-000000000004','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000002',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '6 hours',now()+interval '6 hours 30 minutes','UTC','scheduled','single',NULL,NULL,'in_person','12 Harbor Lane',NULL,NULL,'internal'),
 -- A5: already started, still running.
 ('e0965000-0000-4000-8000-000000000005','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()-interval '10 minutes',now()+interval '20 minutes','UTC','scheduled','single',NULL,NULL,'google_meet',NULL,NULL,NULL,'internal'),
 -- A6: cancelled two days ago; A7: done three days ago.
 ('e0965000-0000-4000-8000-000000000006','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()-interval '2 days',now()-interval '2 days'+interval '30 minutes','UTC','cancelled','single',NULL,NULL,'zoom',NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000007','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()-interval '3 days',now()-interval '3 days'+interval '30 minutes','UTC','done','single',NULL,NULL,'in_person','40 Pier Road',NULL,NULL,'internal'),
 -- A8: same start as A1 with the second host: a real start-time tie for paging.
 ('e0965000-0000-4000-8000-000000000008','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '3 hours',now()+interval '3 hours 30 minutes','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 -- Class session marker (never a customer's session) and the customer's seat in it.
 ('e0965000-0000-4000-8000-000000000010','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '8 hours',now()+interval '9 hours','UTC','scheduled','class_session',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000011','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '8 hours',now()+interval '9 hours','UTC','scheduled','class_seat',NULL,'e0965000-0000-4000-8000-000000000010',NULL,NULL,NULL,NULL,'internal'),
 -- A host block that happens to carry the contact.
 ('e0965000-0000-4000-8000-000000000012','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '10 hours',now()+interval '11 hours','UTC','blocked','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 -- One collective meeting = two host legs.
 ('e0965000-0000-4000-8000-000000000013','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '12 hours',now()+interval '13 hours','UTC','scheduled','collective','e0967000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000014','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '12 hours',now()+interval '13 hours','UTC','scheduled','collective','e0967000-0000-4000-8000-000000000001',NULL,NULL,NULL,NULL,NULL,'internal'),
 -- Not the customer's: another customer's, an unconnected contact's, a booking in ANOTHER tenant
 -- that points at the customer's client id, and the merged contact's.
 ('e0965000-0000-4000-8000-000000000020','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005','e0963000-0000-4000-8000-000000000002','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '4 hours 30 minutes',now()+interval '5 hours','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000021','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '14 hours',now()+interval '15 hours','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000022','e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000002','e0963000-0000-4000-8000-000000000001','e0964000-0000-4000-8000-000000000003',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '3 hours',now()+interval '4 hours','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal'),
 ('e0965000-0000-4000-8000-000000000023','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000006','e0964000-0000-4000-8000-000000000001',
  'x',NULL,NULL,NULL,NULL,NULL,NULL,now()+interval '16 hours',now()+interval '17 hours','UTC','scheduled','single',NULL,NULL,NULL,NULL,NULL,NULL,'internal');

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.jordan(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0961000-0000-4000-8000-000000000003', _sql) $$;
-- One session out of a read result, by booking id.
CREATE FUNCTION pg_temp.s(_r jsonb, _id text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT e FROM jsonb_array_elements(_r->'sessions') e WHERE e->>'id' = _id $$;
CREATE FUNCTION pg_temp.ids(_r jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(right(e->>'id',2), ',' ORDER BY o) FROM jsonb_array_elements(_r->'sessions') WITH ORDINALITY x(e,o) $$;
CREATE FUNCTION pg_temp.keys(_o jsonb) RETURNS text LANGUAGE sql AS
 $$ SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(_o) k $$;

CREATE TEMP TABLE up AS SELECT pg_temp.jordan($q$SELECT public.client_portal_sessions()$q$) AS r;

-- 1. Signed-out and anonymous callers.
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_sessions()$q$,'anon')->>'sqlstate','42501','anonymous read refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_sessions()$q$)->>'error','customer authentication required','signed-out authenticated-role read refused with the exact message');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_sessions(uuid,text,timestamptz,integer)','EXECUTE'),'anon cannot execute the sessions read');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_session_change_admit(uuid,text,uuid,timestamptz,uuid)','EXECUTE'),'anon cannot execute admission');
SELECT ok(has_function_privilege('authenticated','public.client_portal_sessions(uuid,text,timestamptz,integer)','EXECUTE')
  AND has_function_privilege('service_role','public.client_portal_session_change_admit(uuid,text,uuid,timestamptz,uuid)','EXECUTE'),'signed-in callers and the service role can execute');
SELECT ok(NOT has_function_privilege('authenticated','public._portal_session_location_label(text,text,boolean,boolean)','EXECUTE'),'the location helper is not client-callable');
SELECT ok(NOT has_function_privilege('authenticated','public._portal_session_move_class_seat(uuid,timestamptz,timestamptz,timestamptz)','EXECUTE')
  AND NOT has_function_privilege('anon','public._portal_session_move_class_seat(uuid,timestamptz,timestamptz,timestamptz)','EXECUTE')
  AND has_function_privilege('service_role','public._portal_session_move_class_seat(uuid,timestamptz,timestamptz,timestamptz)','EXECUTE'),'the class-seat move helper is service-role only');

-- 2. Staff with no customer relationship.
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000005',$q$SELECT public.client_portal_sessions()$q$) IS NULL,'staff member with no relationship gets NULL');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.client_portal_sessions()$q$) IS NULL,'business owner is not a customer of their own business');

-- 3. Own booking, exact allowlist.
SELECT is((SELECT r->>'tenant_id' FROM up),'e0962000-0000-4000-8000-000000000001','read resolves the customer''s own business');
SELECT is((SELECT pg_temp.keys(r) FROM up),'next_before,server_now,sessions,tenant_id','envelope carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.keys(pg_temp.s(r,'e0965000-0000-4000-8000-000000000001')) FROM up),
 'calendar,change,end_at,id,kind,location,location_kind,start_at,status,timezone,title','a session carries exactly the allowlisted keys');
SELECT is((SELECT pg_temp.keys(pg_temp.s(r,'e0965000-0000-4000-8000-000000000001')->'location')||'|'||pg_temp.keys(pg_temp.s(r,'e0965000-0000-4000-8000-000000000001')->'calendar')
  ||'|'||pg_temp.keys(pg_temp.s(r,'e0965000-0000-4000-8000-000000000001')->'change') FROM up),
 'join_url,label,type|accent,appointment_type_id,duration_min,slug|can_cancel,can_reschedule,deadline,reason','nested objects carry exactly the allowlisted keys');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000001') - 'change' - 'start_at' - 'end_at' FROM up),
 '{"id":"e0965000-0000-4000-8000-000000000001","kind":"single","title":"Strategy call","status":"scheduled","timezone":"America/Chicago","location_kind":"video",
   "location":{"type":"zoom","label":"Zoom","join_url":"https://zoom.example/j/1"},
   "calendar":{"slug":"test-e09-sessions-northwind","accent":"#3355AA","duration_min":45,"appointment_type_id":"t1"}}'::jsonb,
 'title is the service name, never the staff title; join link and service length are projected');
SELECT ok((SELECT strpos(r::text,'STAFF PRIVATE TITLE')=0 AND strpos(r::text,'PRIVATE STAFF NOTE')=0 AND strpos(r::text,'PRIVATE INTAKE')=0
  AND strpos(r::text,'jordan.rivera@tests.invalid')=0 AND strpos(r::text,'+15550000001')=0 AND strpos(r::text,'ZOOM-PRIVATE-999')=0 FROM up),
 'staff title, notes, intake answers, guest PII and the provider meeting id are never projected');
SELECT ok((SELECT strpos(r::text,'e0961000-0000-4000-8000-000000000001')=0 AND strpos(r::text,'e0961000-0000-4000-8000-000000000005')=0
  AND strpos(r::text,'e0963000-0000-4000-8000-000000000001')=0 AND strpos(r::text,'booking_page')=0 FROM up),
 'host identity, the contact id and the booking source are never projected');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000002')->'location'||jsonb_build_object('kind',pg_temp.s(r,'e0965000-0000-4000-8000-000000000002')->'location_kind') FROM up),
 '{"type":"phone","label":"Phone call: +15550000002","join_url":null,"kind":"phone"}'::jsonb,'a phone session shows the confirmation wording, no join link, a phone icon');

-- 4. Not the customer's.
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000021') IS NULL FROM up),'an unconnected contact''s booking in the same business is not visible');
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000020') IS NULL FROM up),'another customer''s booking is not visible');
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000022') IS NULL FROM up),'a booking in another business that points at this client id is not visible');
SELECT is(pg_temp.ids(pg_temp.as_user('e0961000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_sessions()$q$)),'20','the other customer sees only their own booking');

-- 5. Business argument and multiple relationships.
SELECT ok(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_tenant_id=>'e0962000-0000-4000-8000-000000000002')$q$) IS NULL,'a foreign business argument returns NULL, never that business''s rows');
-- The current per-business schema supports two original relationships.
-- Ambiguous unscoped scheduling still refuses; no index is disabled.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0963000-0000-4000-8000-000000000005','e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000006','e0961000-0000-4000-8000-000000000002','Two','Businesses','active');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000006',$q$SELECT public.client_portal_sessions()$q$),
 '{"sqlstate":"42501","error":"select an authorized customer relationship"}'::jsonb,'two relationships raise 42501 with the exact message');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000006',$q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'sqlstate','42501','two relationships raise 42501 on admission too');
DELETE FROM public.clients WHERE id='e0963000-0000-4000-8000-000000000005';

-- 6. Kinds.
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000010') IS NULL FROM up),'a class session marker row is excluded');
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000012') IS NULL FROM up),'a host block is excluded');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000011')->>'kind' FROM up),'class_seat','a class seat is the customer''s session');
SELECT is((SELECT count(*) FROM up, jsonb_array_elements(r->'sessions') e WHERE e->>'id' IN ('e0965000-0000-4000-8000-000000000013','e0965000-0000-4000-8000-000000000014')),1::bigint,'a two-leg collective meeting is one session');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000013')->>'kind' FROM up),'collective','the representative is the smallest leg id');

-- 7. Window maths on a 60-minute calendar.
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000002')->'change' FROM up),
 jsonb_build_object('can_cancel',false,'can_reschedule',false,'deadline',now()-interval '30 minutes','reason','WINDOW_CLOSED'),'thirty minutes out: window closed');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000001')->'change' FROM up),
 jsonb_build_object('can_cancel',true,'can_reschedule',true,'deadline',now()+interval '2 hours','reason',null),'three hours out: changeable, deadline is start minus 60 minutes');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000003')->'change'||jsonb_build_object('calendar',pg_temp.s(r,'e0965000-0000-4000-8000-000000000003')->'calendar') FROM up),
 '{"can_cancel":false,"can_reschedule":false,"deadline":null,"reason":"NO_CALENDAR","calendar":null}'::jsonb,'no calendar: not changeable, calendar is null');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000003')->>'title' FROM up),'Session','no service and no calendar: the generic title');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000004')->'change' FROM up),
 jsonb_build_object('can_cancel',true,'can_reschedule',false,'deadline',now()+interval '5 hours','reason','CALENDAR_UNAVAILABLE'),'paused calendar: may cancel, may not reschedule');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000004')->>'title' FROM up),'Paused calendar','no service: the calendar title');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000005')->'change'->>'reason' FROM up),'WINDOW_CLOSED','a running session is upcoming but closed');

-- 8. Windows, order, paging, clamp.
SELECT is((SELECT pg_temp.ids(r) FROM up),'05,02,01,08,03,04,11,13','upcoming: running and future scheduled sessions, oldest first, ties by id');
SELECT ok((SELECT r->'next_before' = 'null'::jsonb FROM up),'a full upcoming list has no next page');
SELECT is(pg_temp.ids(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_window=>'past')$q$)),'06,07','past: cancelled and done sessions, newest first');
CREATE TEMP TABLE pg1 AS SELECT pg_temp.jordan($q$SELECT public.client_portal_sessions(p_limit=>3)$q$) AS r;
SELECT is((SELECT pg_temp.ids(r) FROM pg1),'05,02,01,08','a page never splits sessions that share a start time');
SELECT is((SELECT (r->>'next_before')::timestamptz FROM pg1),now()+interval '3 hours','next_before is the last start time on the page');
CREATE TEMP TABLE pg2 AS SELECT pg_temp.jordan(format($q$SELECT public.client_portal_sessions(p_before=>%L,p_limit=>3)$q$,(SELECT r->>'next_before' FROM pg1))) AS r;
SELECT is((SELECT pg_temp.ids(r) FROM pg2),'03,04,11','page two continues after the cursor, losing and repeating nothing');
SELECT is(pg_temp.ids(pg_temp.jordan(format($q$SELECT public.client_portal_sessions(p_before=>%L,p_limit=>3)$q$,(SELECT r->>'next_before' FROM pg2)))),'13','the last page holds the rest');
SELECT ok(pg_temp.jordan(format($q$SELECT public.client_portal_sessions(p_before=>%L,p_limit=>3)$q$,(SELECT r->>'next_before' FROM pg2)))->'next_before' = 'null'::jsonb,'and reports no further page');
SELECT is(pg_temp.ids(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_window=>'past',p_limit=>1)$q$)),'06','past pages newest first');
SELECT is(pg_temp.ids(pg_temp.jordan(format($q$SELECT public.client_portal_sessions(p_window=>'past',p_before=>%L,p_limit=>1)$q$,
  pg_temp.jordan($q$SELECT public.client_portal_sessions(p_window=>'past',p_limit=>1)$q$)->>'next_before'))),'07','past page two is older');
SELECT is(jsonb_array_length(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_limit=>0)$q$)->'sessions'),1,'a limit below one clamps to one');
SELECT is(jsonb_array_length(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_limit=>1000)$q$)->'sessions'),8,'a huge limit clamps and still returns everything that exists');

-- 9. Merged contacts.
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000007',$q$SELECT public.client_portal_sessions()$q$) IS NULL,'a merged contact''s account sees nothing');
SELECT ok((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000023') IS NULL FROM up),'a merged contact''s booking never reaches another customer');

-- Admission. Snapshot every booking first: admission must never write one.
CREATE TEMP TABLE before_admit AS SELECT md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) AS h FROM public.internal_bookings b;

-- Admission refusals for a signed-out caller.
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000001')$q$,'anon')->>'sqlstate','42501','anonymous admission refused');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000001')$q$)->>'error','customer authentication required','signed-out admission refused');

-- 10. Input refusals.
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel',NULL)$q$),
 '{"ok":false,"error":"REQUEST_ID_REQUIRED"}'::jsonb,'request id required');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','delete','e0966000-0000-4000-8000-000000000002')$q$),
 '{"ok":false,"error":"BAD_ACTION"}'::jsonb,'unknown action refused');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','reschedule','e0966000-0000-4000-8000-000000000003')$q$),
 '{"ok":false,"error":"NEW_TIME_REQUIRED"}'::jsonb,'a reschedule needs the new time');

-- 11. One "not found" for everything that is not the caller's own.
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000020','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'error','SESSION_NOT_FOUND','another customer''s booking is not found');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-0000000000ff','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'error','SESSION_NOT_FOUND','a random id gets the same code');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000022','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'error','SESSION_NOT_FOUND','another business''s booking pointing at this client id is not found');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000012','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'error','SESSION_NOT_FOUND','a hidden host block is not found');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000005',$q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000004')$q$)->>'error','SESSION_NOT_FOUND','staff with no relationship cannot admit a customer change');

-- 12. Window, state and calendar refusals; then a clean admission.
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000002','cancel','e0966000-0000-4000-8000-000000000005')$q$),
 jsonb_build_object('ok',false,'error','SESSION_CHANGE_WINDOW_CLOSED','deadline',now()-interval '30 minutes'),'inside the notice window: closed, with the deadline');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000005','cancel','e0966000-0000-4000-8000-000000000005')$q$)->>'error','SESSION_CHANGE_WINDOW_CLOSED','a session that has already started is closed');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000007','cancel','e0966000-0000-4000-8000-000000000005')$q$)->>'error','SESSION_NOT_CHANGEABLE','a done session cannot change');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000003','cancel','e0966000-0000-4000-8000-000000000005')$q$)->>'error','SESSION_CHANGE_UNAVAILABLE','a session without a calendar cannot change here');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000004','reschedule','e0966000-0000-4000-8000-000000000005',now()+interval '1 day')$q$)->>'error','SESSION_CHANGE_UNAVAILABLE','a paused calendar cannot reschedule');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000004','cancel','e0966000-0000-4000-8000-000000000005')$q$)->>'ok','true','but its session can still be cancelled');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000006')$q$),
 jsonb_build_object('ok',true,'booking_id','e0965000-0000-4000-8000-000000000001','tenant_id','e0962000-0000-4000-8000-000000000001',
  'client_id','e0963000-0000-4000-8000-000000000001','deadline',now()+interval '2 hours'),'own changeable session is admitted with exactly the admission keys');

-- 13. Replay from booking-manage's audit row.
INSERT INTO public.audit_logs(user_id,action,entity,entity_id,data) VALUES
 ('e0961000-0000-4000-8000-000000000003','client_portal_cancel','internal_booking','e0965000-0000-4000-8000-000000000001',
  jsonb_build_object('tenant_id','e0962000-0000-4000-8000-000000000001','client_id','e0963000-0000-4000-8000-000000000001',
   'portal_request_id','e0966000-0000-4000-8000-000000000010','from_start',now()+interval '3 hours','to_start',null)),
 ('e0961000-0000-4000-8000-000000000003','client_portal_reschedule','internal_booking','e0965000-0000-4000-8000-000000000008',
  jsonb_build_object('tenant_id','e0962000-0000-4000-8000-000000000001','client_id','e0963000-0000-4000-8000-000000000001',
   'portal_request_id','e0966000-0000-4000-8000-000000000011','from_start',now()+interval '2 hours','to_start',now()+interval '3 hours'));
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','cancel','e0966000-0000-4000-8000-000000000010')$q$),
 jsonb_build_object('ok',true,'replay',true,'status','scheduled','start_at',now()+interval '3 hours'),'a committed request id replays');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000004','cancel','e0966000-0000-4000-8000-000000000010')$q$)->>'error','REQUEST_ID_CONFLICT','the request id reused for a different booking conflicts');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','reschedule','e0966000-0000-4000-8000-000000000010',now()+interval '1 day')$q$)->>'error','REQUEST_ID_CONFLICT','the request id reused for a different action conflicts');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000004',$q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000020','cancel','e0966000-0000-4000-8000-000000000010')$q$)->>'error','REQUEST_ID_CONFLICT','another customer cannot ride a foreign request id');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000008','reschedule','e0966000-0000-4000-8000-000000000011',now()+interval '3 hours')$q$)->>'replay','true','a committed reschedule replays for the same new time');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000008','reschedule','e0966000-0000-4000-8000-000000000011',now()+interval '7 hours')$q$)->>'error','REQUEST_ID_CONFLICT','the same reschedule request id with a different time conflicts');

-- 14. State replay: the change already landed (e.g. its audit row was never written).
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000006','cancel','e0966000-0000-4000-8000-000000000020')$q$),
 jsonb_build_object('ok',true,'replay',true,'status','cancelled','start_at',now()-interval '2 days'),'cancelling an already-cancelled session replays');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000001','reschedule','e0966000-0000-4000-8000-000000000021',now()+interval '3 hours')$q$)->>'replay','true','rescheduling to the time it already has replays');

SELECT is((SELECT pg_get_expr(i.indpred,i.indrelid)||'|'||pg_get_indexdef(i.indexrelid,1,true) FROM pg_index i WHERE i.indexrelid=to_regclass('public.audit_logs_portal_request_id')),
 '((entity = ''internal_booking''::text) AND (data ? ''portal_request_id''::text))|(data ->> ''portal_request_id''::text)','the replay lookup has its partial index');

-- 15. Admission wrote nothing.
SELECT is((SELECT md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) FROM public.internal_bookings b),(SELECT h FROM before_admit),'every booking row is byte-identical after every admission call');

-- 16. Location wording follows the session's status; the icon follows the kind of place.
CREATE TEMP TABLE pastr AS SELECT pg_temp.jordan($q$SELECT public.client_portal_sessions(p_window=>'past')$q$) AS r;
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000006')->'location'||jsonb_build_object('kind',pg_temp.s(r,'e0965000-0000-4000-8000-000000000006')->'location_kind') FROM pastr),
 '{"type":"zoom","label":"Zoom","join_url":null,"kind":"video"}'::jsonb,'a cancelled Zoom session names the place only, never "link to follow"');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000007')->'location'||jsonb_build_object('kind',pg_temp.s(r,'e0965000-0000-4000-8000-000000000007')->'location_kind') FROM pastr),
 '{"type":"in_person","label":"40 Pier Road","join_url":null,"kind":"in_person"}'::jsonb,'a done in-person session names the address only');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000005')->'location'||jsonb_build_object('kind',pg_temp.s(r,'e0965000-0000-4000-8000-000000000005')->'location_kind') FROM up),
 '{"type":"google_meet","label":"Google Meet — link to follow","join_url":null,"kind":"video"}'::jsonb,'a running session with no link yet still says the link is to follow');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000003')->'location'||jsonb_build_object('kind',pg_temp.s(r,'e0965000-0000-4000-8000-000000000003')->'location_kind') FROM up),
 '{"type":"unknown","label":"To be confirmed","join_url":null,"kind":"tbd"}'::jsonb,'an upcoming session with no place is to be confirmed, with the neutral icon');
SELECT is((SELECT pg_temp.s(r,'e0965000-0000-4000-8000-000000000004')->>'location_kind' FROM up),'in_person','an upcoming in-person session gets the place icon');
SELECT is(public._portal_session_location_label('custom',NULL,false,true)||'|'||public._portal_session_location_label(NULL,NULL,false,true)||'|'||public._portal_session_location_label('phone','+15550000002',false,true),
 'Location not recorded|Location not recorded|Phone call','a settled session never promises details to follow, and drops the phone number');
-- A custom place is a video link only when it carries one.
UPDATE public.internal_bookings SET location_type='custom', location_value='https://meet.example/northwind' WHERE id='e0965000-0000-4000-8000-000000000008';
UPDATE public.internal_bookings SET location_type='custom', location_value='Studio B, back entrance' WHERE id='e0965000-0000-4000-8000-000000000011';
CREATE TEMP TABLE up2 AS SELECT pg_temp.jordan($q$SELECT public.client_portal_sessions()$q$) AS r;
SELECT is((SELECT (pg_temp.s(r,'e0965000-0000-4000-8000-000000000008')->>'location_kind')||'|'||(pg_temp.s(r,'e0965000-0000-4000-8000-000000000011')->>'location_kind')
  ||'|'||(pg_temp.s(r,'e0965000-0000-4000-8000-000000000011')->'location'->>'label') FROM up2),
 'video|tbd|Studio B, back entrance','a custom place with a link is video; without one, the neutral icon and its own words');

-- 17. A negative notice value never opens a session after it starts.
UPDATE public.calendars SET min_notice_min=-120 WHERE id='e0964000-0000-4000-8000-000000000001';
SELECT is((SELECT pg_temp.s(pg_temp.jordan($q$SELECT public.client_portal_sessions()$q$),'e0965000-0000-4000-8000-000000000005')->'change'),
 jsonb_build_object('can_cancel',false,'can_reschedule',false,'deadline',now()-interval '10 minutes','reason','WINDOW_CLOSED'),'read: a negative notice clamps to zero, so a started session stays closed');
SELECT is(pg_temp.jordan($q$SELECT public.client_portal_session_change_admit('e0965000-0000-4000-8000-000000000005','cancel','e0966000-0000-4000-8000-000000000030')$q$),
 jsonb_build_object('ok',false,'error','SESSION_CHANGE_WINDOW_CLOSED','deadline',now()-interval '10 minutes'),'admission: a negative notice clamps to zero too');
SELECT is((SELECT pg_temp.s(pg_temp.jordan($q$SELECT public.client_portal_sessions()$q$),'e0965000-0000-4000-8000-000000000002')->'change'->>'deadline')::timestamptz,
 now()+interval '30 minutes','a negative notice makes the deadline the start itself');
UPDATE public.calendars SET min_notice_min=60 WHERE id='e0964000-0000-4000-8000-000000000001';

-- 18. A scheduled session that has simply ended is settled: place only.
UPDATE public.internal_bookings SET start_at=now()-interval '2 hours', end_at=now()-interval '90 minutes' WHERE id='e0965000-0000-4000-8000-000000000002';
SELECT is((SELECT pg_temp.s(pg_temp.jordan($q$SELECT public.client_portal_sessions(p_window=>'past')$q$),'e0965000-0000-4000-8000-000000000002')->'location'->>'label'),
 'Phone call','an ended scheduled phone session names the place, not the number to dial');

-- 19. The class-seat move booking-manage's customer mode uses is claimed on the start it loaded.
CREATE TEMP TABLE seat0 AS SELECT start_at, class_session_id FROM public.internal_bookings WHERE id='e0965000-0000-4000-8000-000000000011';
SELECT is(public._portal_session_move_class_seat('e0965000-0000-4000-8000-000000000011',now()+interval '7 hours',now()+interval '20 hours',now()+interval '21 hours'),
 '{"moved":false}'::jsonb,'a seat no longer at the start the caller loaded is not moved');
SELECT ok((SELECT b.start_at=s0.start_at AND b.class_session_id=s0.class_session_id FROM public.internal_bookings b, seat0 s0 WHERE b.id='e0965000-0000-4000-8000-000000000011'),'and is left exactly where it was');
SELECT is(public._portal_session_move_class_seat('e0965000-0000-4000-8000-000000000011',(SELECT start_at FROM seat0),now()+interval '20 hours',now()+interval '21 hours'),
 jsonb_build_object('moved',true,'start_at',now()+interval '20 hours'),'a seat still at the loaded start moves through the class engine');
SELECT ok((SELECT b.start_at=now()+interval '20 hours' AND b.class_session_id IS DISTINCT FROM s0.class_session_id FROM public.internal_bookings b, seat0 s0 WHERE b.id='e0965000-0000-4000-8000-000000000011'),'into the class session at the new time');
SELECT is(public._portal_session_move_class_seat('e0965000-0000-4000-8000-000000000011',(SELECT start_at FROM seat0),now()+interval '20 hours',now()+interval '21 hours'),
 '{"moved":false}'::jsonb,'a duplicate of the same move, carrying the old start, moves nothing');

-- CURA source reuse: original93 assertions retained; all fixtures remain CI rollback-only.
CREATE FUNCTION pg_temp.sessions_projection_role_probe(_role text) RETURNS jsonb LANGUAGE plpgsql AS $probe$
DECLARE observed text; result jsonb;
BEGIN
 IF _role NOT IN('anon','authenticated','service_role') THEN RAISE EXCEPTION 'test role refused'; END IF;
 EXECUTE format('SET LOCAL ROLE %I',_role); observed:=current_user;
 BEGIN
  SELECT public._client_portal_sessions_projection(NULL,NULL,'upcoming',NULL,20) INTO result;
 EXCEPTION WHEN OTHERS THEN result:=jsonb_build_object('sqlstate',SQLSTATE);
 END;
 RESET ROLE;
 RETURN jsonb_build_object('database_role',observed)||coalesce(result,'{}'::jsonb);
END $probe$;
CREATE TEMP TABLE sessions_projection_before AS SELECT md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) h FROM public.internal_bookings b;
SELECT ok(NOT has_function_privilege('authenticated','public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)','EXECUTE'),'trusted Sessions projection is not customer-callable');
SELECT ok(NOT has_function_privilege('anon','public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)','EXECUTE'),'trusted Sessions projection is not anonymous-callable');
SELECT ok(NOT has_function_privilege('service_role','public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)','EXECUTE'),'trusted Sessions projection is not service-callable');
SELECT is(pg_temp.sessions_projection_role_probe('authenticated'),'{"database_role":"authenticated","sqlstate":"42501"}'::jsonb,'actual authenticated role cannot execute the private source');
SELECT is(pg_temp.sessions_projection_role_probe('anon'),'{"database_role":"anon","sqlstate":"42501"}'::jsonb,'actual anonymous role cannot execute the private source');
SELECT is(pg_temp.sessions_projection_role_probe('service_role'),'{"database_role":"service_role","sqlstate":"42501"}'::jsonb,'actual service role cannot execute the private source');
SELECT ok(public._client_portal_sessions_projection(NULL,'e0963000-0000-4000-8000-000000000001','upcoming',NULL,20) IS NULL
 AND public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000002','e0963000-0000-4000-8000-000000000001','upcoming',NULL,20) IS NULL,'missing/mismatched scope is not an empty authorized source');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=""'] FROM pg_proc WHERE oid='public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)'::regprocedure),'private projection retains postgres/STABLE/definer/empty-path contract');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' AND provolatile='s' AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']
 AND pg_get_function_arguments(oid)=$args$p_tenant_id uuid DEFAULT NULL::uuid, p_window text DEFAULT 'upcoming'::text, p_before timestamp with time zone DEFAULT NULL::timestamp with time zone, p_limit integer DEFAULT 20$args$
 AND pg_get_function_result(oid)='jsonb' FROM pg_proc WHERE oid='public.client_portal_sessions(uuid,text,timestamptz,integer)'::regprocedure)
 AND has_function_privilege('authenticated','public.client_portal_sessions(uuid,text,timestamptz,integer)','EXECUTE')
 AND has_function_privilege('service_role','public.client_portal_sessions(uuid,text,timestamptz,integer)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_sessions(uuid,text,timestamptz,integer)','EXECUTE'),'public reader ABI/defaults/attributes/owner/ACL remain original');
SELECT is((SELECT md5(left(prosrc,725)) FROM pg_proc WHERE oid='public.client_portal_sessions(uuid,text,timestamptz,integer)'::regprocedure),'bbfc6ca47d341033e388db163ffaab3b','complete original Auth/resolver prelude remains byte-exact');
SELECT is((SELECT md5(substring(prosrc FROM position('  WITH own AS (' IN prosrc) FOR 5449)) FROM pg_proc WHERE oid='public._client_portal_sessions_projection(uuid,uuid,text,timestamptz,integer)'::regprocedure),'71c4e2f07dd8fa3bfb7471695e4c5727','complete original client-safe query tail remains byte-exact');
SELECT is((SELECT md5(prosrc) FROM pg_proc WHERE oid='public._portal_session_location_label(text,text,boolean,boolean)'::regprocedure),'2263158bf71f718f1b372f621e7ef3b3','original location helper unchanged');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','upcoming',NULL,20),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',NULL,20)$q$),'original public/private projection parity: default upcoming');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','past',NULL,20),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','past',NULL,20)$q$),'original public/private projection parity: past');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','upcoming',NULL,1),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',NULL,1)$q$),'original public/private projection parity: one-item page/ties');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','upcoming',NULL,-10),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',NULL,-10)$q$),'original public/private projection parity: negative limit');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','upcoming',NULL,NULL),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',NULL,NULL)$q$),'original public/private projection parity: null limit');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','upcoming',now()+interval '5 hours',100),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',now()+interval '5 hours',100)$q$),'original public/private projection parity: large limit with cursor');
SELECT is(public._client_portal_sessions_projection('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001',NULL,NULL,20),
 pg_temp.jordan($q$SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001',NULL,NULL,20)$q$),'original public/private projection parity: null window');
SELECT is((SELECT md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) FROM public.internal_bookings b),(SELECT h FROM sessions_projection_before),'all original booking rows remain unchanged by source reads');
-- 20. One canonical appointment in the original SOLO Calendar and customer Sessions.
-- Real original writers/readers, actual fixture roles; no provider or browser IO.
-- This proves owner-created linkage. It does not grant customer first-booking authority.
CREATE TEMP TABLE calendar_portal_created AS
SELECT pg_temp.as_user('e0961000-0000-4000-8000-000000000001', $q$
 SELECT to_jsonb(public.create_internal_booking(
  _title=>'Customer appointment parity',_start_at=>now()+interval '10 days',
  _end_at=>now()+interval '10 days 45 minutes',_timezone=>'America/Chicago',
  _contact_id=>'e0963000-0000-4000-8000-000000000001',
  _tenant_id=>'e0962000-0000-4000-8000-000000000001',
  _calendar_id=>'e0964000-0000-4000-8000-000000000001',
  _appointment_type=>'{"id":"t1","name":"Strategy call","duration_min":45}'::jsonb,
  _source=>'manual'))
$q$) AS r;
SELECT ok((SELECT r#>>'{}' ~ '^[0-9a-f-]{36}$' FROM calendar_portal_created),
 'the original authorized owner writer returns a booking identity');
SELECT ok((SELECT count(*)=1 AND bool_and(
 tenant_id='e0962000-0000-4000-8000-000000000001' AND
 calendar_id='e0964000-0000-4000-8000-000000000001' AND
 contact_id='e0963000-0000-4000-8000-000000000001' AND
 host_user_id='e0961000-0000-4000-8000-000000000001' AND
 start_at=now()+interval '10 days' AND end_at=now()+interval '10 days 45 minutes')
 FROM public.internal_bookings WHERE id=(SELECT (r#>>'{}')::uuid FROM calendar_portal_created)),
 'one native appointment retains the original business, calendar, CRM customer, host and exact time');
CREATE TEMP TABLE calendar_portal_owner AS
SELECT pg_temp.as_user('e0961000-0000-4000-8000-000000000001', $q$
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb)
 FROM public.list_team_bookings(now(),now()+interval '11 days',NULL::uuid[],
  'e0962000-0000-4000-8000-000000000001') b
$q$) AS r;
SELECT ok((SELECT count(*)=1 AND bool_and(e->>'contact_id'='e0963000-0000-4000-8000-000000000001')
 FROM calendar_portal_owner,jsonb_array_elements(r) e
 WHERE e->>'id'=(SELECT r#>>'{}' FROM calendar_portal_created)),
 'the built-in SOLO Calendar reads that same identity linked to the original CRM customer');
CREATE TEMP TABLE calendar_portal_customer AS
SELECT pg_temp.jordan($q$SELECT public.client_portal_sessions(
 'e0962000-0000-4000-8000-000000000001','upcoming',NULL,50)$q$) AS r;
SELECT ok((SELECT e->>'status'='scheduled' AND (e->>'start_at')::timestamptz=now()+interval '10 days'
 AND (e->>'end_at')::timestamptz=now()+interval '10 days 45 minutes'
 FROM calendar_portal_customer, LATERAL pg_temp.s(r,(SELECT r#>>'{}' FROM calendar_portal_created)) e),
 'customer Sessions reads the same appointment identity, scheduled status and exact start/end');
SELECT is((SELECT r FROM calendar_portal_customer),pg_temp.jordan($q$SELECT public.client_portal_sessions(
 'e0962000-0000-4000-8000-000000000001','upcoming',NULL,50)$q$),
 'returning to Sessions reads the original saved appointment without manufacturing state');
SELECT is((SELECT count(*) FROM public.internal_bookings WHERE id=(SELECT (r#>>'{}')::uuid FROM calendar_portal_created)),
 1::bigint,'owner and customer readback never create a second calendar record');
SELECT ok(pg_temp.s(pg_temp.as_user('e0961000-0000-4000-8000-000000000004',$q$
 SELECT public.client_portal_sessions('e0962000-0000-4000-8000-000000000001','upcoming',NULL,50)$q$),
 (SELECT r#>>'{}' FROM calendar_portal_created)) IS NULL,'another customer cannot read the newly linked appointment');
SELECT ok(pg_temp.jordan($q$SELECT public.client_portal_sessions(
 'e0962000-0000-4000-8000-000000000002','upcoming',NULL,50)$q$) IS NULL,
 'a different business selection cannot expose the appointment');
SELECT is(pg_temp.jordan($q$SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb)
 FROM public.list_team_bookings(now(),now()+interval '11 days',NULL::uuid[],
 'e0962000-0000-4000-8000-000000000001') b$q$)->>'sqlstate','42501',
 'a customer never gains the business owner Calendar reader');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000002',$q$
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb)
 FROM public.list_team_bookings(now(),now()+interval '11 days',NULL::uuid[],
 'e0962000-0000-4000-8000-000000000001') b$q$)->>'sqlstate','42501',
 'the other business owner cannot read this business Calendar');
SELECT is(pg_temp.jordan($q$SELECT to_jsonb(public.create_internal_booking(
 _title=>'Forbidden owner action',_start_at=>now()+interval '11 days',_end_at=>now()+interval '11 days 30 minutes',
 _contact_id=>'e0963000-0000-4000-8000-000000000001',_tenant_id=>'e0962000-0000-4000-8000-000000000001'))$q$)->>'sqlstate',
 '42501','customer membership does not grant the original owner-only booking writer');
SELECT ok((SELECT count(*)=1 AND bool_and(user_id='e0961000-0000-4000-8000-000000000001'
 AND data->>'contact_id'='e0963000-0000-4000-8000-000000000001')
 FROM public.audit_logs WHERE entity='internal_booking' AND action='create_internal_booking'
 AND entity_id=(SELECT (r#>>'{}')::uuid FROM calendar_portal_created)),
 'the original create audit attributes the actual owner and exact CRM relationship');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',format($q$
 SELECT to_jsonb(public.admin_set_booking_status(%L::uuid,'cancelled'))$q$,
 (SELECT r#>>'{}' FROM calendar_portal_created))),
 (SELECT r FROM calendar_portal_created),'the permitted status writer returns the original appointment identity');
SELECT ok((SELECT e->>'status'='cancelled' FROM jsonb_array_elements(
 pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) FROM public.list_team_bookings(
 now(),now()+interval '11 days',NULL::uuid[],'e0962000-0000-4000-8000-000000000001') b$q$)) e
 WHERE e->>'id'=(SELECT r#>>'{}' FROM calendar_portal_created))
 AND pg_temp.s(pg_temp.jordan($q$SELECT public.client_portal_sessions(
 'e0962000-0000-4000-8000-000000000001','past',NULL,50)$q$),
 (SELECT r#>>'{}' FROM calendar_portal_created))->>'status'='cancelled',
 'owner Calendar and customer return both read the original cancellation, not a copied appointment');

-- A typed email is deliberately insufficient: owner guest booking is still a guest.
CREATE TEMP TABLE calendar_portal_guest AS
SELECT pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$
 SELECT to_jsonb(public.create_internal_booking(
 _title=>'Unlinked guest',_start_at=>now()+interval '12 days',_end_at=>now()+interval '12 days 30 minutes',
 _guest_name=>'Jordan Rivera',_guest_email=>'jordan.rivera@tests.invalid',
 _tenant_id=>'e0962000-0000-4000-8000-000000000001',_calendar_id=>'e0964000-0000-4000-8000-000000000001',
 _source=>'manual'))$q$) AS r;
SELECT ok((SELECT r#>>'{}' ~ '^[0-9a-f-]{36}$' FROM calendar_portal_guest),'the existing guest writer still works for the owner');
SELECT ok((SELECT contact_id IS NULL FROM public.internal_bookings
 WHERE id=(SELECT (r#>>'{}')::uuid FROM calendar_portal_guest)),
 'matching typed name/email do not manufacture a CRM relationship');
SELECT ok(pg_temp.s(pg_temp.jordan($q$SELECT public.client_portal_sessions(
 'e0962000-0000-4000-8000-000000000001','upcoming',NULL,50)$q$),
 (SELECT r#>>'{}' FROM calendar_portal_guest)) IS NULL,'the unlinked guest appointment cannot appear in customer Sessions by email match');
SELECT is((SELECT count(*) FROM jsonb_array_elements(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$
 SELECT coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) FROM public.list_team_bookings(
 now(),now()+interval '13 days',NULL::uuid[],'e0962000-0000-4000-8000-000000000001') b$q$)) e
 WHERE e->>'id'=(SELECT r#>>'{}' FROM calendar_portal_guest)),1::bigint,
 'the guest appointment remains visible exactly once to its legitimate business Calendar');

-- 21. Discover original published calendars for the exact current customer.
-- No availability/writer/provider surface is introduced by this read.
CREATE FUNCTION pg_temp.booking_calendars(
 _actor uuid DEFAULT 'e0961000-0000-4000-8000-000000000003',
 _tenant uuid DEFAULT 'e0962000-0000-4000-8000-000000000001',
 _client uuid DEFAULT 'e0963000-0000-4000-8000-000000000001',
 _after text DEFAULT NULL,_limit integer DEFAULT 20,_headers jsonb DEFAULT '{}'
) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE r jsonb;
BEGIN
 PERFORM set_config('request.headers',_headers::text,true);
 r:=pg_temp.as_user(_actor,format('SELECT public.client_portal_booking_calendars(%L,%L,%L,%L)',
  _tenant,_client,_after,_limit));
 PERFORM set_config('request.headers','{}',true);
 RETURN r;
END $test$;
SELECT has_function('public','client_portal_booking_calendars',ARRAY['uuid','uuid','text','integer'],
 'published Calendar discovery is an additive native read');
SELECT ok((SELECT pg_get_userbyid(proowner)='postgres' AND prosecdef AND provolatile='s'
 AND proconfig=ARRAY['search_path=""'] FROM pg_proc
 WHERE oid='public.client_portal_booking_calendars(uuid,uuid,text,integer)'::regprocedure),
 'discovery has the original safe postgres/STABLE/definer/empty-path reader shape');
SELECT ok(has_function_privilege('authenticated','public.client_portal_booking_calendars(uuid,uuid,text,integer)','EXECUTE')
 AND NOT has_function_privilege('anon','public.client_portal_booking_calendars(uuid,uuid,text,integer)','EXECUTE')
 AND NOT has_function_privilege('service_role','public.client_portal_booking_calendars(uuid,uuid,text,integer)','EXECUTE'),
 'only the ordinary authenticated lane can execute discovery');
SELECT is(pg_temp.booking_calendars(_actor=>NULL)->>'sqlstate','42501','a database role without an Auth subject is refused');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000001')->>'sqlstate','42501',
 'business owner credentials do not substitute for customer membership');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000005')->>'sqlstate','42501',
 'business staff credentials do not substitute for customer membership');
SELECT is(pg_temp.booking_calendars(_client=>'e0963000-0000-4000-8000-000000000002')->>'sqlstate','42501',
 'another customer id cannot supply authority');
SELECT is(pg_temp.booking_calendars(_tenant=>'e0962000-0000-4000-8000-000000000002')->>'sqlstate','42501',
 'another business id cannot supply authority');
SELECT is(pg_temp.booking_calendars(_tenant=>NULL)->>'sqlstate','42501','the business intent is required');
SELECT is(pg_temp.booking_calendars(_client=>NULL)->>'sqlstate','42501','the customer intent is required');
SELECT is(pg_temp.booking_calendars(_headers=>'{"x-client-portal-business":"e0962000-0000-4000-8000-000000000002"}')->>'sqlstate',
 '42501','a stale business request header cannot widen the selected relationship');
SELECT is(pg_temp.booking_calendars(_headers=>'{"x-client-portal-business":"invalid"}')->>'sqlstate','42501',
 'malformed request business is refused by the original resolver');
SELECT is(pg_temp.booking_calendars()->'calendars','[]'::jsonb,'an enabled calendar with no roster is not offered');

INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES
 ('e0964000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001'),
 ('e0964000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000001'),
 ('e0964000-0000-4000-8000-000000000003','e0961000-0000-4000-8000-000000000002');
INSERT INTO public.calendars(id,tenant_id,created_by,slug,title,description,duration_min,enabled,type) VALUES
 ('e0964000-0000-4000-8000-000000000004','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001',
  'test-e09-sessions-class','Group session',repeat('Public description ',100),45,true,'event'),
 ('e0964000-0000-4000-8000-000000000005','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001',
  'test-e09-sessions-team','Team session',NULL,30,true,'collective'),
 ('e0964000-0000-4000-8000-000000000006','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001',
  'test-e09-sessions-unrostered','No host',NULL,30,true,'personal'),
 ('e0964000-0000-4000-8000-000000000007','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001',
  'test-e09-sessions-wrong-host','Wrong business host',NULL,30,true,'personal');
INSERT INTO public.calendar_hosts(calendar_id,user_id) VALUES
 ('e0964000-0000-4000-8000-000000000004','e0961000-0000-4000-8000-000000000001'),
 ('e0964000-0000-4000-8000-000000000005','e0961000-0000-4000-8000-000000000001'),
 ('e0964000-0000-4000-8000-000000000005','e0961000-0000-4000-8000-000000000005'),
 ('e0964000-0000-4000-8000-000000000007','e0961000-0000-4000-8000-000000000002');
CREATE TEMP TABLE calendar_discovery_before AS SELECT
 md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) h FROM public.internal_bookings b;
CREATE TEMP TABLE calendar_discovery AS SELECT pg_temp.booking_calendars() r;
SELECT is((SELECT r->>'tenant_id' FROM calendar_discovery),'e0962000-0000-4000-8000-000000000001',
 'discovery returns the original selected business identity');
SELECT is((SELECT r->>'client_id' FROM calendar_discovery),'e0963000-0000-4000-8000-000000000001',
 'discovery returns the verified CRM relationship identity');
SELECT is((SELECT jsonb_agg(c->>'slug' ORDER BY c->>'slug') FROM calendar_discovery,jsonb_array_elements(r->'calendars') c),
 '["test-e09-sessions-class","test-e09-sessions-northwind","test-e09-sessions-team"]'::jsonb,
 'only this business published, properly rostered single, class and collective calendars are discoverable');
SELECT ok((SELECT bool_and((SELECT array_agg(k ORDER BY k)=ARRAY['description','duration_min','id','slug','timezone','title']
 FROM jsonb_object_keys(c) k)) FROM calendar_discovery,jsonb_array_elements(r->'calendars') c),
 'calendar rows expose only presentation fields, never hosts, guest data, notes, intake, notifications or providers');
SELECT is((SELECT length(c->>'description') FROM calendar_discovery,jsonb_array_elements(r->'calendars') c
 WHERE c->>'slug'='test-e09-sessions-class'),1200,'published descriptions are bounded without reading private materials');
SELECT is((SELECT r->>'has_more' FROM calendar_discovery),'false','a complete page truthfully reports no additional calendars');
SELECT is((SELECT r->'next_after_slug' FROM calendar_discovery),'null'::jsonb,'a complete page has no continuation cursor');
CREATE TEMP TABLE calendar_discovery_first AS SELECT pg_temp.booking_calendars(_limit=>1) r;
SELECT is((SELECT jsonb_array_length(r->'calendars') FROM calendar_discovery_first),1,'the requested page bound is enforced');
SELECT is((SELECT r->>'has_more' FROM calendar_discovery_first),'true','a bounded first page reports genuine additional calendars');
SELECT is((SELECT r->>'next_after_slug' FROM calendar_discovery_first),'test-e09-sessions-class',
 'continuation binds the last actual returned native slug');
SELECT is(pg_temp.booking_calendars(_after=>'test-e09-sessions-class',_limit=>1)->'calendars'->0->>'slug',
 'test-e09-sessions-northwind','the next page returns the next original calendar without a duplicate');
SELECT is(pg_temp.booking_calendars(_after=>'test-e09-sessions-northwind',_limit=>1)->'calendars'->0->>'slug',
 'test-e09-sessions-team','keyset paging reaches the final permitted calendar');
SELECT is(pg_temp.booking_calendars(_after=>'test-e09-sessions-team')->'calendars','[]'::jsonb,
 'exhausted paging does not expose another business or a paused calendar');
SELECT is(pg_temp.booking_calendars(_limit=>0)->>'sqlstate','22023','zero page size is refused');
SELECT is(pg_temp.booking_calendars(_limit=>51)->>'sqlstate','22023','unbounded page size is refused');
SELECT is(pg_temp.booking_calendars(_limit=>NULL)->>'sqlstate','22023','null page size is refused');
SELECT is(pg_temp.booking_calendars(_after=>repeat('x',241))->>'sqlstate','22023','oversized continuation is refused');
SELECT is(pg_temp.booking_calendars(),(SELECT r FROM calendar_discovery),'returning reads preserve the exact native list');

-- The same real login can resolve two original relationships; selection must
-- choose each business's own list, never combine them or borrow a staff scope.
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0963000-0000-4000-8000-000000000005','e0962000-0000-4000-8000-000000000002',
  'e0961000-0000-4000-8000-000000000006','e0961000-0000-4000-8000-000000000002','Two','Businesses','active');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000006',
 _client=>'e0963000-0000-4000-8000-000000000004')->'calendars',(SELECT r->'calendars' FROM calendar_discovery),
 'a multi-business customer selecting this relationship sees only this business calendars');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000006',
 _tenant=>'e0962000-0000-4000-8000-000000000002',_client=>'e0963000-0000-4000-8000-000000000005')
 ->'calendars'->0->>'slug','test-e09-sessions-tenant-b','switching the verified relationship resolves only the other business list');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000006',
 _client=>'e0963000-0000-4000-8000-000000000005')->>'sqlstate','42501',
 'a customer relationship from the previous business is refused');
UPDATE public.tenant_members SET status='suspended' WHERE tenant_id='e0962000-0000-4000-8000-000000000001'
 AND user_id='e0961000-0000-4000-8000-000000000005';
SELECT is(jsonb_array_length(pg_temp.booking_calendars()->'calendars'),2,
 'a published collective calendar with a no-longer-active host is withheld');
UPDATE public.tenant_members SET status='active' WHERE tenant_id='e0962000-0000-4000-8000-000000000001'
 AND user_id='e0961000-0000-4000-8000-000000000005';
UPDATE public.calendars SET enabled=false WHERE id='e0964000-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(pg_temp.booking_calendars()->'calendars'),2,'pausing the original calendar immediately removes it from discovery');
UPDATE public.calendars SET enabled=true WHERE id='e0964000-0000-4000-8000-000000000001';
SELECT is((SELECT md5(string_agg(to_jsonb(b)::text,'|' ORDER BY b.id)) FROM public.internal_bookings b),
 (SELECT h FROM calendar_discovery_before),'all discovery and paging calls leave every original appointment unchanged');
SELECT is(pg_temp.booking_calendars(_actor=>'e0961000-0000-4000-8000-000000000007',
 _client=>'e0963000-0000-4000-8000-000000000006')->>'sqlstate','42501','a merged-away customer cannot discover calendars');
UPDATE public.profiles SET active_tenant_id='e0962000-0000-4000-8000-000000000001'
 WHERE user_id='e0961000-0000-4000-8000-000000000001';
CREATE FUNCTION pg_temp.booking_access(_action text) RETURNS jsonb LANGUAGE plpgsql AS $test$
DECLARE v jsonb;
BEGIN
 v:=pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.read_client_portal_access(
  'e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001')$q$);
 RETURN pg_temp.as_user('e0961000-0000-4000-8000-000000000001',format($q$SELECT public.set_client_portal_access(
  'e0961000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000001',
  'e0963000-0000-4000-8000-000000000001',%L,'engagement_paused',NULL,%L)$q$,_action,v->>'since'));
END $test$;
SELECT is(pg_temp.booking_access('pause')->>'ok','true','the original owner control can pause this fixture customer');
SELECT is(pg_temp.booking_calendars()->>'sqlstate','42501','paused access invalidates the discovery read immediately');
SELECT is(pg_temp.booking_access('restore')->>'ok','true','the original owner control restores the same relationship');
SELECT is(pg_temp.booking_calendars(),(SELECT r FROM calendar_discovery),'restored access returns the same original calendar facts');
SELECT is(pg_temp.booking_access('end')->>'ok','true','the original owner control ends this fixture relationship');
SELECT is(pg_temp.booking_calendars()->>'sqlstate','42501','ended access cannot use a retained login to discover the business calendars');

SELECT * FROM finish();
ROLLBACK;
