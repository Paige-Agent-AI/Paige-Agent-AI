-- E09 portal channel: full replayed schema, actual caller roles, synthetic data; all rolled back.
-- Proves: customer send/read is bound to the caller's own relationship; business reply is bound to
-- the current-workspace admin; idempotent retries; cross-business, wrong-role and anonymous refusal;
-- portal rows land in the canonical inbox thread; email history is never projected to the customer.
BEGIN;
SELECT plan(63);
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
SELECT lives_ok($q$DELETE FROM public.clients WHERE id='e0934100-0000-4000-8000-000000000001'$q$,'a customer with portal messages can still be deleted');
SELECT is((SELECT count(*) FROM public.messages WHERE channel_type='portal' AND contact_id IS NULL AND tenant_id='e0924100-0000-4000-8000-000000000001'),21::bigint,'their portal rows are orphaned, not lost');

SELECT ok(NOT has_function_privilege('anon','public.client_portal_send_message(text,uuid,text,uuid)','EXECUTE'),'anon cannot execute customer send');
SELECT ok(NOT has_function_privilege('anon','public.comms_portal_reply(uuid,uuid,text,uuid)','EXECUTE'),'anon cannot execute business reply');
SELECT ok(NOT has_function_privilege('anon','public.client_portal_conversation(uuid,timestamptz,integer,uuid)','EXECUTE'),'anon cannot execute the customer projection');
SELECT ok(has_function_privilege('authenticated','public.client_portal_conversation(uuid,timestamptz,integer,uuid)','EXECUTE'),'signed-in callers can execute the customer projection');
SELECT hasnt_function('public','client_portal_conversation',ARRAY['uuid','timestamp with time zone','integer'],'the superseded three-argument projection is gone, so calls never resolve ambiguously');
SELECT * FROM finish();
ROLLBACK;
