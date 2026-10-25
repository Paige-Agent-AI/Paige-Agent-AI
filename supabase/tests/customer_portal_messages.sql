-- E09 portal channel: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: customer send/read is bound to the caller's own relationship; business reply is bound to
-- the current-workspace admin; idempotent retries; cross-business, wrong-role and anonymous refusal;
-- portal rows land in the canonical inbox thread; email history is never projected to the customer.
BEGIN;
SELECT plan(83);
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0914100-0000-4000-8000-000000000001','authenticated','authenticated','portal-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0914100-0000-4000-8000-000000000002','authenticated','authenticated','portal-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0914100-0000-4000-8000-000000000003','authenticated','authenticated','portal-customer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0914100-0000-4000-8000-000000000004','authenticated','authenticated','portal-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0914100-0000-4000-8000-000000000005','authenticated','authenticated','portal-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,account_number_prefix,account_number,features) VALUES
 ('e0924100-0000-4000-8000-000000000001','test-tenant-e09-portal-a','Test tenant portal A','active','standalone','E09PA',9441001,'{}'),
 ('e0924100-0000-4000-8000-000000000002','test-tenant-e09-portal-b','Test tenant portal B','active','standalone','E09PB',9441002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0924100-0000-4000-8000-000000000001','e0914100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0924100-0000-4000-8000-000000000002','e0914100-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0924100-0000-4000-8000-000000000001','e0914100-0000-4000-8000-000000000005','member','active',false,now());
UPDATE public.profiles SET active_tenant_id='e0924100-0000-4000-8000-000000000001'
 WHERE user_id IN('e0914100-0000-4000-8000-000000000001','e0914100-0000-4000-8000-000000000005');
UPDATE public.profiles SET active_tenant_id='e0924100-0000-4000-8000-000000000002' WHERE user_id='e0914100-0000-4000-8000-000000000002';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('e0934100-0000-4000-8000-000000000001','e0924100-0000-4000-8000-000000000001','e0914100-0000-4000-8000-000000000003','e0914100-0000-4000-8000-000000000001','Portal','Customer','active'),
 ('e0934100-0000-4000-8000-000000000002','e0924100-0000-4000-8000-000000000002','e0914100-0000-4000-8000-000000000004','e0914100-0000-4000-8000-000000000002','Foreign','Customer','active'),
 ('e0934100-0000-4000-8000-000000000003','e0924100-0000-4000-8000-000000000001',NULL,'e0914100-0000-4000-8000-000000000001','Unconnected','Contact','active');
-- An existing email row in customer A's thread must never reach the customer projection.
INSERT INTO public.messages(tenant_id,thread_key,contact_id,channel_type,direction,status,recipients,subject,body_text,meta)
VALUES('e0924100-0000-4000-8000-000000000001','contact:e0924100-0000-4000-8000-000000000001:e0934100-0000-4000-8000-000000000001',
 'e0934100-0000-4000-8000-000000000001','email','inbound','received','[]','Private email','PRIVATE EMAIL BODY','{}');

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

-- Customer send
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('  Hello team  ','e0954100-0000-4000-8000-000000000001')$q$)->>'ok','true','customer sends into own relationship');
SELECT is((SELECT count(*) FROM public.messages WHERE channel_type='portal' AND contact_id='e0934100-0000-4000-8000-000000000001'),1::bigint,'one portal row written');
SELECT is((SELECT body_text FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000001'),'Hello team','body is trimmed');
SELECT is((SELECT tenant_id::text||'|'||thread_key||'|'||direction||'|'||status FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000001'),
 'e0924100-0000-4000-8000-000000000001|contact:e0924100-0000-4000-8000-000000000001:e0934100-0000-4000-8000-000000000001|inbound|received','lands in the canonical per-contact thread as received');
SELECT is((SELECT unread_count FROM public.threads WHERE thread_key='contact:e0924100-0000-4000-8000-000000000001:e0934100-0000-4000-8000-000000000001'),2,'canonical inbox thread counts the customer message as unread');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('Hello team','e0954100-0000-4000-8000-000000000001')$q$)->>'replayed','true','identical retry replays');
SELECT is((SELECT count(*) FROM public.messages WHERE channel_type='portal' AND contact_id='e0934100-0000-4000-8000-000000000001'),1::bigint,'retry writes nothing new');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('Different text','e0954100-0000-4000-8000-000000000001')$q$)->>'error','REQUEST_ID_CONFLICT','reused request id with different content refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000004',
 $q$SELECT public.client_portal_send_message('Hello team','e0954100-0000-4000-8000-000000000001')$q$)->>'error','REQUEST_ID_CONFLICT','another customer cannot replay a foreign request id');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('Need help','e0954100-0000-4000-8000-000000000002','help')$q$)->>'ok','true','help request accepted');
SELECT is((SELECT subject||'|'||(meta #>> '{portal,kind}') FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000002'),'Help request|help','help request is labelled for the inbox');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('   ','e0954100-0000-4000-8000-000000000003')$q$)->>'error','INVALID_BODY','blank body refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message(repeat('x',4001),'e0954100-0000-4000-8000-000000000003')$q$)->>'error','INVALID_BODY','over-long body refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('x','e0954100-0000-4000-8000-000000000003','urgent')$q$)->>'error','INVALID_KIND','unknown kind refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('x','e0954100-0000-4000-8000-000000000003',p_tenant_id=>'e0924100-0000-4000-8000-000000000002')$q$)->>'error','NO_RELATIONSHIP','a business argument cannot grant a foreign relationship');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',
 $q$SELECT public.client_portal_send_message('x','e0954100-0000-4000-8000-000000000004')$q$)->>'error','NO_RELATIONSHIP','business owner is not a customer of their own business');
SELECT is(pg_temp.as_user(NULL,
 $q$SELECT public.client_portal_send_message('x','e0954100-0000-4000-8000-000000000005')$q$,'anon')->>'sqlstate','42501','anonymous caller refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT count(*)::text::jsonb FROM public.messages$q$)::text,'0','customer still cannot read the raw inbox table');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$INSERT INTO public.messages(thread_key,contact_id,channel_type,direction,status,meta) VALUES('x','e0934100-0000-4000-8000-000000000001','portal','inbound','received','{"portal":{"request_id":"r","author_role":"customer"}}') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','customer cannot write the inbox table directly');

-- Business reply
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','Thanks, on it','e0954100-0000-4000-8000-000000000010')$q$)->>'ok','true','business admin replies on the portal channel');
SELECT is((SELECT direction||'|'||status||'|'||(meta #>> '{portal,author_role}') FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000010'),'outbound|delivered|business','reply is a delivered business row, never queued for a provider');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0914100-0000-4000-8000-000000000003' AND action_url='/app/messages' AND metadata->>'kind'='portal_message'),1::bigint,'customer gets one in-app notice');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','Thanks, on it','e0954100-0000-4000-8000-000000000010')$q$)->>'replayed','true','identical reply retry replays');
SELECT is((SELECT count(*) FROM public.notifications WHERE user_id='e0914100-0000-4000-8000-000000000003' AND metadata->>'kind'='portal_message'),1::bigint,'replay sends no second notice');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000005',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','staff','e0954100-0000-4000-8000-000000000011')$q$)->>'sqlstate','42501','non-admin member refused (admins only)');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000002',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','foreign','e0954100-0000-4000-8000-000000000012')$q$)->>'sqlstate','42501','another business owner refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000002',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000002','e0934100-0000-4000-8000-000000000001','foreign','e0954100-0000-4000-8000-000000000013')$q$)->>'error','CONTACT_NOT_FOUND','a foreign contact is not reachable from own workspace');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000003','hi','e0954100-0000-4000-8000-000000000014')$q$)->>'error','PORTAL_NOT_CONNECTED','contact without portal access refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','self','e0954100-0000-4000-8000-000000000015')$q$)->>'sqlstate','42501','customer cannot write as the business');

-- Customer projection. Every row above shares one transaction timestamp; give the reply its real
-- later time so ordering is proven on created_at, not on the id tie-break.
UPDATE public.messages SET created_at=now()+interval '1 second'
 WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000010';
SELECT is(jsonb_array_length(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)->'messages'),3,'customer sees exactly their three portal messages');
SELECT ok(strpos(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)::text,'PRIVATE EMAIL BODY')=0,'email history is never projected to the customer');
SELECT ok(strpos(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)::text,'e0914100-0000-4000-8000-000000000001')=0,'staff identity is never projected');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)->'messages'->0->>'author','business','newest first, business reply attributed to the business');
SELECT is(jsonb_array_length(pg_temp.as_user('e0914100-0000-4000-8000-000000000004',
 $q$SELECT public.client_portal_conversation()$q$)->'messages'),0,'other business''s customer sees none of it');
SELECT ok(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',
 $q$SELECT public.client_portal_conversation()$q$) IS NULL,'business owner gets no customer projection');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_conversation()$q$,'anon')->>'sqlstate','42501','anonymous projection refused');

-- Paging. Customer A's thread now holds three portal rows: the reply (now()+1s) and two customer
-- rows that share the transaction timestamp exactly — a real boundary tie.
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation(p_limit=>3)$q$)->>'has_more','false','a thread of exactly one page reports no older messages');
SELECT is(jsonb_array_length(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation(p_limit=>3)$q$)->'messages'),3,'the exact page returns every row');
CREATE TEMP TABLE portal_page1 AS SELECT pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation(p_limit=>2)$q$) AS r;
SELECT is((SELECT jsonb_array_length(r->'messages')||'|'||(r->>'has_more') FROM portal_page1),'2|true','a short page returns its limit and reports an older row');
SELECT is((SELECT (r->'messages'->1->>'created_at')::timestamptz FROM portal_page1),
 (SELECT created_at FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000002'),'page one ends inside the timestamp tie');
CREATE TEMP TABLE portal_page2 AS SELECT pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 format($q$SELECT public.client_portal_conversation(p_before=>%L,p_limit=>2,p_before_id=>%L)$q$,
  (SELECT r->'messages'->1->>'created_at' FROM portal_page1),(SELECT r->'messages'->1->>'id' FROM portal_page1))) AS r;
SELECT is((SELECT jsonb_array_length(r->'messages')||'|'||(r->>'has_more') FROM portal_page2),'1|false','page two returns the tied row and nothing older');
SELECT set_eq(
 $q$SELECT e->>'id' FROM portal_page1, jsonb_array_elements(r->'messages') e
    UNION ALL SELECT e->>'id' FROM portal_page2, jsonb_array_elements(r->'messages') e$q$,
 $q$SELECT id::text FROM public.messages WHERE channel_type='portal' AND contact_id='e0934100-0000-4000-8000-000000000001'$q$,
 'two pages across a timestamp tie lose nothing');
SELECT is((SELECT count(*) FROM (SELECT e->>'id' FROM portal_page1, jsonb_array_elements(r->'messages') e
    UNION ALL SELECT e->>'id' FROM portal_page2, jsonb_array_elements(r->'messages') e) u),3::bigint,'and repeat nothing');

-- request_id: the customer's own idempotency key, on their own rows only.
SELECT is((SELECT e->>'request_id' FROM jsonb_array_elements(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)->'messages') e
 WHERE e->>'id'=(SELECT id::text FROM public.messages WHERE meta #>> '{portal,request_id}'='e0954100-0000-4000-8000-000000000001')),
 'e0954100-0000-4000-8000-000000000001','the customer''s own row carries its request id');
SELECT is((SELECT count(*) FROM jsonb_array_elements(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)->'messages') e WHERE e->>'author'='customer' AND e ? 'request_id'),2::bigint,'every own customer row carries a request id');
SELECT is((SELECT count(*) FROM jsonb_array_elements(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)->'messages') e WHERE e->>'author'='business' AND e ? 'request_id'),0::bigint,'a business row never carries a request id');
SELECT ok(strpos(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_conversation()$q$)::text,'e0954100-0000-4000-8000-000000000010')=0,'the business reply''s request id is never projected');
SELECT ok(strpos(pg_temp.as_user('e0914100-0000-4000-8000-000000000004',
 $q$SELECT public.client_portal_conversation()$q$)::text,'e0954100-0000-4000-8000-0000000000')=0,'another customer never sees these request ids');
-- If the relationship is relinked to a different account, that account sees the history but never
-- the previous account's idempotency keys.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0914100-0000-4000-8000-000000000006','authenticated','authenticated','portal-customer-relinked@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
UPDATE public.clients SET linked_user_id='e0914100-0000-4000-8000-000000000006' WHERE id='e0934100-0000-4000-8000-000000000001';
SELECT is(jsonb_array_length(pg_temp.as_user('e0914100-0000-4000-8000-000000000006',
 $q$SELECT public.client_portal_conversation()$q$)->'messages'),3,'a relinked account sees the relationship''s history');
SELECT ok(strpos(pg_temp.as_user('e0914100-0000-4000-8000-000000000006',
 $q$SELECT public.client_portal_conversation()$q$)::text,'request_id')=0,'but never the previous account''s request ids');
UPDATE public.clients SET linked_user_id='e0914100-0000-4000-8000-000000000003' WHERE id='e0934100-0000-4000-8000-000000000001';

-- Shape guard binds every writer, including the trusted backend.
SELECT throws_ok($q$INSERT INTO public.messages(tenant_id,thread_key,contact_id,channel_type,direction,status,meta)
 VALUES('e0924100-0000-4000-8000-000000000001','x','e0934100-0000-4000-8000-000000000001','portal','outbound','queued','{"portal":{"request_id":"z","author_role":"business"}}')$q$,
 '23514',NULL,'a portal row can never be queued for a provider');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message(E'\n\t \r\n','e0954100-0000-4000-8000-000000000020')$q$)->>'error','INVALID_BODY','whitespace-only body (newlines/tabs) refused');

-- Rate limit: 20 new customer messages per relationship per minute.
-- Activity reuses the same original messages and original client-lens reader.
SELECT is((SELECT count(*) FROM public.paige_client_events e JOIN public.messages m ON e.ref_table='messages' AND e.ref_id=m.id
 WHERE m.channel_type='portal' AND m.contact_id='e0934100-0000-4000-8000-000000000001'),3::bigint,'Portal activity: each saved shared message has its original Rail reference');
SELECT is((SELECT count(*) FROM (SELECT e.ref_id FROM public.paige_client_events e JOIN public.messages m ON e.ref_table='messages' AND e.ref_id=m.id
 WHERE m.channel_type='portal' GROUP BY e.ref_id HAVING count(*)<>1) x),0::bigint,'Portal activity: retries and conflicts never duplicate activity');
SELECT is((SELECT count(*) FROM public.paige_client_events e JOIN public.messages m ON e.ref_table='messages' AND e.ref_id=m.id
 WHERE m.channel_type='portal' AND (e.tenant_id IS DISTINCT FROM m.tenant_id OR e.contact_id IS DISTINCT FROM m.contact_id)),0::bigint,'Portal activity: exact canonical business and customer binding');
SELECT is((SELECT count(*) FROM public.paige_client_events WHERE ref_table='messages' AND event_kind='comms.inbound'
 AND actor_type='client' AND actor_user_id='e0914100-0000-4000-8000-000000000003' AND surface='client_portal'
 AND audience='both' AND visibility='client_visible'),2::bigint,'Portal activity: customer message and help have truthful actual actor and audience');
SELECT is((SELECT count(*) FROM public.paige_client_events WHERE ref_table='messages' AND event_kind='comms.outbound'
 AND actor_type='owner_staff' AND actor_user_id='e0914100-0000-4000-8000-000000000001' AND surface='client_portal'
 AND audience='both' AND visibility='client_visible'),1::bigint,'Portal activity: business reply retains actual actor and permitted audience');
SELECT is((SELECT count(*) FROM public.paige_client_events WHERE ref_table='messages'
 AND (payload<>'{}'::jsonb OR summary IS NOT NULL OR title NOT IN('Message sent','Message from your team') OR actor_agent_slug IS NOT NULL)),0::bigint,'Portal activity: no message body, private Cura history or fabricated specialist');
SELECT is((SELECT count(*) FROM public.audit_logs a JOIN public.paige_client_events e ON a.entity_id=e.id AND a.user_id=e.actor_user_id
 WHERE a.action='paige_rail_event' AND e.ref_table='messages'),3::bigint,'Portal activity: original Rail audit retains actual attribution');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',$q$SELECT count(*)::text::jsonb FROM public.get_client_rail(
 p_contact_id=>'e0934100-0000-4000-8000-000000000001',p_limit=>50,p_lens=>'client') r WHERE r.surface='client_portal' AND r.event_kind IN('comms.inbound','comms.outbound')$q$),'3'::jsonb,'Portal activity: original customer history reload sees the three saved shared messages');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',$q$SELECT count(*)::text::jsonb FROM public.get_client_rail(
 p_contact_id=>'e0934100-0000-4000-8000-000000000001',p_limit=>50,p_lens=>'client') r
 WHERE r.actor_user_id IS NOT NULL OR r.from_department IS NOT NULL OR r.to_department IS NOT NULL OR r.payload<>'{}'::jsonb OR r.ref_table IS NOT NULL OR r.ref_id IS NOT NULL$q$),'0'::jsonb,'Portal activity: original client lens withholds staff identity, internal departments, payload and refs');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000004',$q$SELECT to_jsonb(r) FROM public.get_client_rail(
 p_contact_id=>'e0934100-0000-4000-8000-000000000001',p_limit=>50,p_lens=>'client') r$q$)->>'sqlstate','42501','Portal activity: other business customer cannot read this history');
SELECT is(pg_temp.as_user(NULL,$q$SELECT to_jsonb(r) FROM public.get_client_rail(
 p_contact_id=>'e0934100-0000-4000-8000-000000000001',p_limit=>50,p_lens=>'client') r$q$,'anon')->>'sqlstate','42501','Portal activity: anonymous history refused');
CREATE FUNCTION pg_temp.e09_portal_activity_snapshot() RETURNS jsonb LANGUAGE sql AS $$
 SELECT jsonb_build_object('messages',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.messages x),
 'events',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.paige_client_events x),
 'audit',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.audit_logs x),
 'notices',(SELECT jsonb_agg(to_jsonb(x) ORDER BY id) FROM public.notifications x));
$$;
CREATE TEMP TABLE e09_portal_activity_before AS SELECT pg_temp.e09_portal_activity_snapshot() AS snapshot;
CREATE FUNCTION pg_temp.e09_refuse_portal_rail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF NEW.action='paige_rail_event' THEN RAISE EXCEPTION 'synthetic original Rail audit refusal'; END IF; RETURN NEW; END $$;
CREATE TRIGGER e09_refuse_portal_rail_audit BEFORE INSERT ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION pg_temp.e09_refuse_portal_rail_audit();
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',$q$SELECT public.client_portal_send_message(
 'Audit must refuse this message','e0954100-0000-4000-8000-000000900001')$q$)->>'sqlstate','P0001','Portal activity: original customer Rail audit refusal propagates');
SELECT is(pg_temp.e09_portal_activity_snapshot(),(SELECT snapshot FROM e09_portal_activity_before),'Portal activity: failed customer Rail audit rolls back original message and activity');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000001',$q$SELECT public.comms_portal_reply(
 'e0924100-0000-4000-8000-000000000001','e0934100-0000-4000-8000-000000000001','Audit must refuse this reply','e0954100-0000-4000-8000-000000900002')$q$)->>'sqlstate','P0001','Portal activity: original business Rail audit refusal propagates');
SELECT is(pg_temp.e09_portal_activity_snapshot(),(SELECT snapshot FROM e09_portal_activity_before),'Portal activity: failed business Rail audit rolls back message, notice and activity');
DROP TRIGGER e09_refuse_portal_rail_audit ON public.audit_logs;
DROP FUNCTION pg_temp.e09_refuse_portal_rail_audit();

-- Rate limit: 20 new customer messages per relationship per minute (original cases).
DO $$BEGIN FOR i IN 1..18 LOOP
 PERFORM pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
  format($q$SELECT public.client_portal_send_message('burst %s',%L)$q$, i, ('e0954100-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid));
END LOOP;END$$;
SELECT is((SELECT count(*) FROM public.messages WHERE channel_type='portal' AND direction='inbound' AND contact_id='e0934100-0000-4000-8000-000000000001'),20::bigint,'twenty customer messages accepted');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('one too many','e0954100-0000-4000-8000-000000000200')$q$)->>'error','RATE_LIMITED','the twenty-first within a minute is refused');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',
 $q$SELECT public.client_portal_send_message('Hello team','e0954100-0000-4000-8000-000000000001')$q$)->>'replayed','true','a retry of an earlier request still replays under the limit');

-- Inactive business: the reply is refused with an honest reason.
UPDATE public.tenants SET status='suspended' WHERE id='e0924100-0000-4000-8000-000000000002';
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000002',
 $q$SELECT public.comms_portal_reply('e0924100-0000-4000-8000-000000000002','e0934100-0000-4000-8000-000000000002','hi','e0954100-0000-4000-8000-000000000201')$q$)->>'error','WORKSPACE_INACTIVE','inactive business cannot post portal replies');

-- Deleting a customer keeps retained portal history (contact_id SET NULL) and does not fail.
SELECT is((SELECT count(*) FROM public.paige_client_events WHERE ref_table='messages' AND event_kind='comms.inbound'
 AND contact_id='e0934100-0000-4000-8000-000000000001'),20::bigint,'Portal activity: each permitted customer post creates one saved activity');
SELECT is((SELECT count(*) FROM public.paige_client_events WHERE ref_table='messages' AND event_kind='comms.outbound'
 AND contact_id='e0934100-0000-4000-8000-000000000001'),1::bigint,'Portal activity: retries and rate refusals create no extra reply activity');
SELECT ok(NOT EXISTS(SELECT m.id FROM public.messages m LEFT JOIN public.paige_client_events e ON e.ref_table='messages' AND e.ref_id=m.id
 WHERE m.channel_type='portal' AND m.contact_id='e0934100-0000-4000-8000-000000000001' GROUP BY m.id HAVING count(e.id)<>1),'Portal activity: original persisted message and event stay one to one');
SELECT is(pg_temp.as_user('e0914100-0000-4000-8000-000000000003',$q$SELECT count(*)::text::jsonb FROM public.get_client_rail(
 p_contact_id=>'e0934100-0000-4000-8000-000000000001',p_limit=>50,p_lens=>'client') r WHERE r.surface='client_portal' AND r.event_kind IN('comms.inbound','comms.outbound')$q$),'21'::jsonb,'Portal activity: returning customer reads actual saved activity after retries and refusals');
SELECT ok((SELECT bool_and(pg_get_userbyid(proowner)='postgres' AND prosecdef AND proconfig=ARRAY['search_path=public, pg_temp']
 AND has_function_privilege('authenticated',oid,'EXECUTE') AND has_function_privilege('service_role',oid,'EXECUTE') AND NOT has_function_privilege('anon',oid,'EXECUTE'))
 FROM pg_proc WHERE oid IN('public.client_portal_send_message(text,uuid,text,uuid)'::regprocedure,'public.comms_portal_reply(uuid,uuid,text,uuid)'::regprocedure))
 AND (SELECT md5(prosrc)='d30a77a8908d3ddab03fd17b882b6d0b' FROM pg_proc WHERE oid='public.client_portal_send_message(text,uuid,text,uuid)'::regprocedure)
 AND (SELECT md5(prosrc)='12123877ad1df9570869815aca0666bc' FROM pg_proc WHERE oid='public.comms_portal_reply(uuid,uuid,text,uuid)'::regprocedure),'Portal activity: exact original signatures, permissions and reviewed bodies');

-- Original retained-history deletion checks.
SELECT lives_ok($q$DELETE FROM public.clients WHERE id='e0934100-0000-4000-8000-000000000001'$q$,'a customer with portal messages can still be deleted');
SELECT is((SELECT count(*) FROM public.messages WHERE channel_type='portal' AND contact_id IS NULL AND tenant_id='e0924100-0000-4000-8000-000000000001'),21::bigint,'their portal rows are orphaned, not lost');

SELECT ok(NOT has_function_privilege('anon','public.client_portal_send_message(text,uuid,text,uuid)','EXECUTE'),'anon cannot execute customer send');
SELECT ok(NOT has_function_privilege('anon','public.comms_portal_reply(uuid,uuid,text,uuid)','EXECUTE'),'anon cannot execute business reply');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_conversation(uuid,timestamptz,integer,uuid)','EXECUTE'),'anon cannot execute the customer projection');
SELECT ok(has_function_privilege('authenticated','public.client_portal_conversation(uuid,timestamptz,integer,uuid)','EXECUTE'),'signed-in callers can execute the customer projection');
SELECT hasnt_function('public','client_portal_conversation',ARRAY['uuid','timestamp with time zone','integer'],'the superseded three-argument projection is gone, so calls never resolve ambiguously');
SELECT * FROM finish();
ROLLBACK;
