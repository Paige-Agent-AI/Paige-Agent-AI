-- E09 Slice 6 Profile & Consent: actual caller roles, synthetic businesses and people, all rolled back.
-- Proves: the customer reads and writes ONLY their own preferences, through their relationship; their
-- opt-out lands even under a business pause and survives the business lifting it (B2); staff can never
-- forge, override or delete a customer's choice by any path (B1); another client's phone rows are never
-- touched or shown (M1); a merge keeps the opt-out (M5); data sharing is customer-only on INSERT and
-- UPDATE (M4); the owner reads the same truth read-only; the marketing dashboard counts portal opt-outs
-- as unsubscribes (M6). Round 2: deleting a contact keeps the opt-outs they hold (MAJOR 1); a merge
-- moves them to the winner so the card and the send gate agree (MAJOR 2); only the customer takes back
-- their own spam report; after leaving Updates only the customer can subscribe again; a raw DELETE of
-- every row class the contact holds is refused (MEDIUM 4); quiet hours say "your time" only for a zone
-- the send gate can use.
BEGIN;
SELECT plan(246);

-- Production grants these table privileges to authenticated through project default privileges that
-- no migration writes (fact 4: has_column_privilege('authenticated','clients',...,'UPDATE') = true).
-- A replayed local database lacks them, so the RLS and trigger paths below would otherwise die at the
-- grant layer before the code under test runs. Rolled back with everything else; a no-op in CI.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients TO authenticated;

INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0961000-0000-4000-8000-000000000001','authenticated','authenticated','consent-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000002','authenticated','authenticated','consent-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000003','authenticated','authenticated','jordan.rivera@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000004','authenticated','authenticated','sam.okafor@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000005','authenticated','authenticated','consent-staff-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000006','authenticated','authenticated','consent-agency@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000007','authenticated','authenticated','consent-sub-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000008','authenticated','authenticated','riley.chen@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000009','authenticated','authenticated','morgan.lee@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000010','authenticated','authenticated','casey.foreign@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000011','authenticated','authenticated','avery.sub@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000012','authenticated','authenticated','taylor.two@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0962000-0000-4000-8000-000000000001','test-tenant-e09-consent-a','Northwind Studio','active','standalone',NULL,'E09CA',9461001,'{}'),
 ('e0962000-0000-4000-8000-000000000002','test-tenant-e09-consent-b','Test tenant consent B','active','standalone',NULL,'E09CB',9461002,'{}'),
 ('e0962000-0000-4000-8000-000000000003','test-tenant-e09-consent-agency','Test agency consent','active','agency',NULL,'E09CG',9461003,'{}');
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0962000-0000-4000-8000-000000000004','test-tenant-e09-consent-sub','Harbor Lane','active','sub_account','e0962000-0000-4000-8000-000000000003','E09CS',9461004,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000002','owner','active',true,now()),
 ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005','member','active',false,now()),
 ('e0962000-0000-4000-8000-000000000003','e0961000-0000-4000-8000-000000000006','owner','active',true,now()),
 ('e0962000-0000-4000-8000-000000000004','e0961000-0000-4000-8000-000000000007','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0962000-0000-4000-8000-000000000001'
 WHERE user_id IN('e0961000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000005');
-- The staff member holds the GLOBAL 'admin' app role but is only a member here: the §59 trap.
INSERT INTO public.user_roles(user_id,role) VALUES ('e0961000-0000-4000-8000-000000000005','admin') ON CONFLICT DO NOTHING;
UPDATE public.profiles SET active_tenant_id='e0962000-0000-4000-8000-000000000002' WHERE user_id='e0961000-0000-4000-8000-000000000002';
-- The agency owner has switched into the sub-account (the context-switch path RLS admits).
UPDATE public.profiles SET active_tenant_id='e0962000-0000-4000-8000-000000000004' WHERE user_id IN('e0961000-0000-4000-8000-000000000006','e0961000-0000-4000-8000-000000000007');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,timezone) VALUES
 ('e0963000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000003','e0961000-0000-4000-8000-000000000001','Jordan','Rivera','active',NULL),
 ('e0963000-0000-4000-8000-000000000002','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000004','e0961000-0000-4000-8000-000000000001','Sam','Okafor','active','America/Chicago'),
 ('e0963000-0000-4000-8000-000000000003','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000008','e0961000-0000-4000-8000-000000000001','Riley','Chen','active',NULL),
 ('e0963000-0000-4000-8000-000000000004','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Drew','Chen','active',NULL),
 ('e0963000-0000-4000-8000-000000000005','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000009','e0961000-0000-4000-8000-000000000001','Morgan','Lee','active',NULL),
 ('e0963000-0000-4000-8000-000000000006','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Morgan','Lee (new)','active',NULL),
 ('e0963000-0000-4000-8000-000000000007','e0962000-0000-4000-8000-000000000002','e0961000-0000-4000-8000-000000000010','e0961000-0000-4000-8000-000000000002','Casey','Foreign','active',NULL),
 ('e0963000-0000-4000-8000-000000000008','e0962000-0000-4000-8000-000000000004','e0961000-0000-4000-8000-000000000011','e0961000-0000-4000-8000-000000000007','Avery','Sub','active',NULL),
 ('e0963000-0000-4000-8000-000000000009','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000012','e0961000-0000-4000-8000-000000000001','Taylor','Two','active',NULL),
 ('e0963000-0000-4000-8000-000000000011','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Quinn','Deleted','active',NULL);
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email','Jordan.Rivera+portal@Tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','phone','(555) 010-0001',true,1),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email','sam.okafor@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','phone','+1 555 010 0002',true,1),
 -- Riley and Drew share one phone (M1): neither may read or write the other's text preference.
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','email','riley.chen@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','phone','5550100009',true,1),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000004','phone','+15550100009',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000005','email','morgan.lee@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000006','email','morgan.lee+new@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000002','e0963000-0000-4000-8000-000000000007','email','casey.foreign@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000004','e0963000-0000-4000-8000-000000000008','email','avery.sub@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000011','email','quinn.deleted@tests.invalid',true,0);

CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 IF _role = 'service_role' THEN
   PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true); SET LOCAL ROLE service_role;
 ELSE
   PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
   IF _role='anon' THEN SET LOCAL ROLE anon; ELSE SET LOCAL ROLE authenticated; END IF;
 END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
-- The customer's write, as that customer.
CREATE FUNCTION pg_temp.pref(_uid uuid, _ch text, _topic text, _on boolean, _tenant uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$ SELECT pg_temp.as_user(_uid, format(
  'SELECT public.client_portal_set_communication_preference(%L,%L,%L::boolean,%L::uuid)', _ch, _topic, _on, _tenant)) $$;
CREATE FUNCTION pg_temp.prefs(_uid uuid, _tenant uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE sql AS $$ SELECT pg_temp.as_user(_uid, format('SELECT public.client_portal_communication_preferences(%L::uuid)', _tenant)) $$;
CREATE FUNCTION pg_temp.lift(_uid uuid, _contact uuid, _ch text, _suppressed boolean, _reason text DEFAULT 'manual') RETURNS jsonb
LANGUAGE sql AS $$ SELECT pg_temp.as_user(_uid, format(
  'SELECT public.set_contact_channel_suppression(%L::uuid,%L,%L::boolean,%L)', _contact, _ch, _suppressed, _reason)) $$;
-- A test mirror of runPreSend steps 2-3 for one recipient (the Deno parity test proves the TypeScript).
CREATE FUNCTION pg_temp.presend(_tenant uuid, _contact uuid, _ch text, _to text) RETURNS text
LANGUAGE sql AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.paige_suppressions s WHERE s.tenant_id=_tenant AND s.channel=_ch
      AND (s.contact_id=_contact OR s.address_normalized=public._comms_normalize_address(_ch,_to))) THEN 'blocked_suppressed'
    WHEN _ch='sms' AND coalesce((SELECT e.action FROM public.paige_consent_events e WHERE e.tenant_id=_tenant AND e.channel=_ch
      AND (e.contact_id=_contact OR e.address_normalized=public._comms_normalize_address(_ch,_to))
      ORDER BY e.created_at DESC, e.id DESC LIMIT 1),'none') <> 'granted' THEN 'blocked_no_consent'
    ELSE 'proceed' END $$;

-- ── 1. Grants ──────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon','public.client_portal_communication_preferences(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.client_portal_set_communication_preference(text,text,boolean,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.client_portal_set_shared_context_consent(boolean,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.read_client_communication_state(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public.client_portal_consent_disclosure(text)','EXECUTE'),'anon cannot execute any new public function');
SELECT ok(has_function_privilege('authenticated','public.client_portal_communication_preferences(uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.client_portal_set_communication_preference(text,text,boolean,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.client_portal_set_shared_context_consent(boolean,uuid)','EXECUTE')
  AND has_function_privilege('authenticated','public.read_client_communication_state(uuid,uuid)','EXECUTE')
  AND has_function_privilege('service_role','public.read_client_communication_state(uuid,uuid)','EXECUTE'),'authenticated and service can execute the public functions');
SELECT ok(NOT has_function_privilege('authenticated','public._client_communication_state(uuid,uuid)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._comms_contact_address(uuid,uuid,text)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public._comms_normalize_address(text,text)','EXECUTE')
  AND NOT has_function_privilege('anon','public._client_communication_state(uuid,uuid)','EXECUTE'),'internal helpers are granted to nobody');
SELECT ok(NOT has_function_privilege('anon','public.load_contact_context(uuid,text[])','EXECUTE')
  AND NOT has_function_privilege('anon','public.admin_propose_paige_actions(uuid,jsonb)','EXECUTE')
  AND has_function_privilege('authenticated','public.load_contact_context(uuid,text[])','EXECUTE'),'anon loses load_contact_context and admin_propose_paige_actions; authenticated keeps them');

-- ── 2. Widened CHECKs ──────────────────────────────────────────────────────────────────────────
SELECT throws_ok($q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','manual','portal')$q$,
  '23514', NULL, 'an unknown suppression source is still refused');
SELECT throws_ok($q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','nope','admin_ui')$q$,
  '23514', NULL, 'an unknown suppression reason is still refused');
SELECT lives_ok($q$SELECT set_config('paige.customer_consent_write','on',true), set_config('paige.customer_consent_contact','e0963000-0000-4000-8000-000000000004',true);
  INSERT INTO public.paige_consent_events(contact_id,channel,action,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','revoked','customer_portal');
  SELECT set_config('paige.customer_consent_write','',true), set_config('paige.customer_consent_contact','',true)$q$,
  'customer_portal is an accepted consent source');
DELETE FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000004';

-- ── 3. Customer read: who may read ─────────────────────────────────────────────────────────────
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_communication_preferences()$q$,'authenticated')->>'sqlstate','42501','signed out raises 42501');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000001'),NULL,'business owner with no relationship reads NULL');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003','e0962000-0000-4000-8000-000000000002'),NULL,'a foreign business argument reads NULL');
SELECT is(pg_temp.as_user(NULL,$q$SELECT public.client_portal_communication_preferences()$q$,'anon')->>'sqlstate','42501','anonymous refused');

-- ── 4. Exact keys, nothing private ─────────────────────────────────────────────────────────────
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')) k),
  ARRAY['business_name','data_sharing','email','quiet_hours','read_at','schema_version','sms','tenant_id','updates'],'root keys are exact');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->'email') k),
  ARRAY['can_turn_off','can_turn_on','set_at','set_by','state'],'email card keys are exact');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->'sms') k),
  ARRAY['can_turn_off','can_turn_on','set_at','set_by','state'],'texts card keys are exact');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->'updates') k),
  ARRAY['can_subscribe','can_unsubscribe','set_at','set_by','state'],'updates card keys are exact');
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->'data_sharing') k)
  || (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->'quiet_hours') k),
  ARRAY['allowed','updated_at','end','fallback_time_zone','start','time_zone_known'],'data sharing and quiet hours keys are exact');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')->>'business_name','Northwind Studio','business name is the tenant name');

-- ── 5. The state table (§1a) ───────────────────────────────────────────────────────────────────
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{email,state}','on','nothing on record: email on');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{sms,state}','not_set','nothing on record: texts not set (default-deny)');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','not_subscribed','nothing on record: not subscribed');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{quiet_hours,time_zone_known}','false','no time zone on record is said plainly');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000004')#>>'{quiet_hours,time_zone_known}','true','a recorded time zone is known');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000009')#>>'{sms,state}','no_number','no primary phone: no_number');
-- The business pauses Sam's email (staff RPC): off, set by the business, and the customer cannot lift it.
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email',true,'user_stop')->>'changed','true','owner pauses email');
SELECT is((SELECT reason FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email'),'manual','a staff reason argument cannot make the pause look like the contact''s STOP (B1)');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000004')->'email',
  jsonb_build_object('state','off','set_by','business','set_at',(SELECT created_at FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email'),
    'can_turn_on',false,'can_turn_off',true),'a business pause: off, set by the business, the customer can still record their own off (B2)');
-- An address-keyed suppression with no contact id still counts (the address is Jordan's alone).
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001',NULL,'jordan.rivera@tests.invalid','email','bounce_hard','webhook');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{email,state}','off','an address-keyed suppression counts');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{email,set_by}','delivery','a hard bounce reads as delivery');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,true)->>'error','EMAIL_UNDELIVERABLE','the customer cannot lift a hard bounce');
DELETE FROM public.paige_suppressions WHERE address_normalized='jordan.rivera@tests.invalid' AND contact_id IS NULL;
-- START (service, inbound) then a later revoke.
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref,created_at)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','+15550100001','sms','granted','inbound_message','SMtest1',now()-interval '2 minutes');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{sms,state}','on','a START reply: texts on');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{sms,set_by}','reply','set by a reply');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','sms','(555) 010-0001'),'proceed','parity: the send gate lets the text through');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','sms',NULL,true)->>'replayed','true','texts already on: asking on again replays');
INSERT INTO public.paige_consent_events(tenant_id,contact_id,channel,action,source,created_at)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','sms','revoked','admin_ui',now()-interval '1 minute');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{sms,state}','off','granted then a later revoked: off');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','sms','+15550100001'),'blocked_no_consent','parity: the send gate blocks it');

-- ── 6. Email off ───────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,false)->>'ok','true','customer turns email off');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email' AND reason='customer_request' AND source='customer_portal'),1::bigint,'one customer suppression');
SELECT is((SELECT address_normalized FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email'),'jordan.rivera@tests.invalid','the suppression carries the normalized address (M5)');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email' AND action='revoked' AND source='customer_portal' AND topic IS NULL AND address_normalized='jordan.rivera@tests.invalid'),1::bigint,'one revoked event with the normalized address');
SELECT ok((SELECT evidence_ref FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email' AND source='customer_portal')
  = 'portal:e0961000-0000-4000-8000-000000000003:email-pref:v2:'||left(md5(public.client_portal_consent_disclosure('email-pref:v2')),12)
  AND (SELECT ip FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email' AND source='customer_portal') IS NULL,
  'evidence names the session and the exact disclosure; no spoofable IP is stored (M7)');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,false)->>'replayed','true','repeat off replays');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email'),1::bigint,'replay writes no new event');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity='client_portal' AND action='communication_preference_set' AND entity_id='e0963000-0000-4000-8000-000000000001'),1::bigint,'one audit row for the one real change');
SELECT ok(NOT (SELECT data::text FROM public.audit_logs WHERE entity='client_portal' AND action='communication_preference_set' AND entity_id='e0963000-0000-4000-8000-000000000001') ~ '@','the audit row carries no address');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{email,set_by}','you','set by you');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email','JORDAN.RIVERA+anything@tests.invalid'),'blocked_suppressed','parity: email to that address is blocked');
SELECT ok(NOT (pg_temp.prefs('e0961000-0000-4000-8000-000000000003')::text ~ '(@|\+1555|portal:|SMtest|e0961000)'),'the read never carries an address, phone, evidence or user id');

-- ── 7. Email on ────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,true)->>'ok','true','customer turns their own off back on');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email'),0::bigint,'their suppression is lifted');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email' AND action='granted'),0::bigint,'no granted event is written for email on');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000004','email',NULL,true)->>'error','EMAIL_PAUSED_BY_BUSINESS','a business pause cannot be lifted by the customer');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email'),1::bigint,'refusal changes no rows');
SELECT ok((pg_temp.pref('e0961000-0000-4000-8000-000000000004','email',NULL,true)->'preferences') ? 'email','a refusal still returns the fresh read');
-- Their own one-click unsubscribe (service, webhook) is theirs to lift.
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','jordan.rivera@tests.invalid','email','unsubscribe_link','webhook');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{email,set_by}','unsubscribe_link','their emailed link reads as such');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,true)->>'ok','true','the customer can lift their own unsubscribe');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email'),0::bigint,'unsubscribe row lifted');

-- ── 8. Updates and offers ──────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000004','email','newsletter',true)->>'error','EMAIL_OFF','subscribe while email is off is refused');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email','newsletter',true)->>'ok','true','subscribe while email is on');
SELECT ok((SELECT evidence_ref FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND topic='newsletter' AND action='granted')
  LIKE 'portal:e0961000-0000-4000-8000-000000000003:updates-optin:v2:%','the opt-in evidence names the updates disclosure the page shows (v2)');
SELECT ok(public._email_newsletter_subscribed('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','jordan.rivera@tests.invalid'),'the newsletter decider now says subscribed');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','subscribed','the card says subscribed only when both deciders agree');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,false)->>'ok','true','email off while subscribed');
SELECT ok(NOT public._email_newsletter_subscribed('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','jordan.rivera@tests.invalid'),'email off also leaves updates (D4)');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,true)->>'ok','true','email back on');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','not_subscribed','email back on never re-subscribes');
-- M9: subscribed, then the business pauses and lifts: the newsletter topic still says granted, but the
-- latest email event is the business revoke, which blocks marketing automations. Not "subscribed".
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email','newsletter',true)->>'ok','true','re-subscribe');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email',true)->>'changed','true','business pauses email');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email',false)->>'changed','true','business lifts its own pause');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','paused','the two deciders disagree: paused, never subscribed (M9)');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,set_by}','business','paused by the business');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email','newsletter',true)->>'replayed','false','re-subscribing from paused writes, never replays');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','subscribed','subscribed again');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email','newsletter',false)->>'ok','true','unsubscribe');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{updates,state}','not_subscribed','unsubscribed');

-- ── 9. Texts ───────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000004','sms',NULL,true)->>'error','SMS_OPT_IN_UNAVAILABLE','texts on is not offered from the portal (D1)');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='sms'),0::bigint,'the refusal writes nothing');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000004','sms',NULL,false)->>'ok','true','texts off is always allowed');
SELECT is((SELECT address_normalized FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='sms'),'+15550100002','keyed on the contact and the normalized phone');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='sms' AND action='revoked' AND address_normalized='+15550100002'),1::bigint,'a revoked SMS event with the number');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000004')#>>'{sms,set_by}','you','texts off set by you');
-- No primary phone still records a contact-keyed opt-out (Minor 8).
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000009','sms',NULL,false)->>'ok','true','texts off with no number on file');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000005' AND channel='sms' AND address_normalized IS NULL),1::bigint,'a contact-keyed row with no address');

-- ── 10. Bad input ──────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','sms','newsletter',true)->>'sqlstate','22023','sms+newsletter refused');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','voice',NULL,true)->>'sqlstate','22023','channel voice refused');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email','promo',true)->>'sqlstate','22023','topic promo refused');

-- ── 11. Isolation ──────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000003','email',NULL,false,'e0962000-0000-4000-8000-000000000002')->>'sqlstate','42501','a foreign business argument cannot reach another relationship');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000002'),0::bigint,'business B rows unchanged');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000003',$q$SELECT to_jsonb(count(*)) FROM public.paige_suppressions$q$)::text,'0','the customer cannot read the raw ledger');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000003',
  $q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000001','email','customer_request','customer_portal') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','the customer cannot write the ledger directly');

-- ── 12. Sub-account parity ─────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000011')->>'business_name','Harbor Lane','a sub-account customer reads their business');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000011','email',NULL,false)->>'ok','true','a sub-account customer turns email off');
SELECT is((SELECT tenant_id::text FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000008'),'e0962000-0000-4000-8000-000000000004','the row lands in the sub-account, never the agency');

-- ── 13-15. Data sharing ────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_set_shared_context_consent(true)$q$)->>'replayed','false','the customer allows data sharing');
SELECT ok((SELECT paige_shared_context_consent AND paige_shared_context_consent_updated_at IS NOT NULL FROM public.clients WHERE id='e0963000-0000-4000-8000-000000000001'),'the flag and its timestamp are set');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000003',$q$SELECT public.client_portal_set_shared_context_consent(true)$q$)->>'replayed','true','repeat replays');
SELECT is((SELECT count(*) FROM public.audit_logs WHERE entity='client_portal' AND action='shared_context_consent_set' AND entity_id='e0963000-0000-4000-8000-000000000001'),1::bigint,'one audit row');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000003')#>>'{data_sharing,allowed}','true','the read shows it');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET paige_shared_context_consent=true WHERE id='e0963000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$)->>'error',
  'SHARED_CONTEXT_CUSTOMER_ONLY: only the client can allow this, from their portal account','the owner cannot turn it on with a raw update');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET paige_shared_context_consent=false WHERE id='e0963000-0000-4000-8000-000000000001' RETURNING to_jsonb(paige_shared_context_consent)$q$)::text,'false','the owner can still turn it off');
SELECT is(pg_temp.as_user(NULL,$q$UPDATE public.clients SET paige_shared_context_consent=true WHERE id='e0963000-0000-4000-8000-000000000002' RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','42501','the service role cannot turn it on either');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$UPDATE public.clients SET first_name='Samuel' WHERE id='e0963000-0000-4000-8000-000000000002' RETURNING to_jsonb(first_name)$q$)::text,'"Samuel"','other owner edits are unaffected');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$INSERT INTO public.clients(tenant_id,created_by,first_name,last_name,status,paige_shared_context_consent) VALUES ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','Imported','Row','active',true) RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','an INSERT with the flag on is refused too (M4)');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$INSERT INTO public.clients(tenant_id,created_by,first_name,last_name,status) VALUES ('e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','Imported','Row','active') RETURNING to_jsonb(id)$q$) ? 'sqlstate' = false,'an INSERT with the default still works');
SELECT is((SELECT md5(replace(prosrc,'This client hasn''''t allowed this yet. They can turn it on in their portal account.','')) FROM pg_proc WHERE proname='load_contact_context'),
  '272f696116e42910332b8d09e1155a91','load_contact_context differs from production only in its refusal message');
SELECT ok((SELECT prosrc FROM pg_proc WHERE proname='load_contact_context') ~ 'They can turn it on in their portal account' AND NOT (SELECT prosrc FROM pg_proc WHERE proname='load_contact_context') ~ 'workspace settings','the message names the real setting');

-- ── 16-17. Staff pause and lift ────────────────────────────────────────────────────────────────
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','sms',false)->>'sqlstate','42501','a staff lift over the customer''s own texts-off is refused');
SELECT ok(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','sms',false)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','with SUPPRESSION_HELD_BY_CONTACT');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='sms'),1::bigint,'the customer row survives');
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','+15550100009','sms','user_stop','inbound_message');
SELECT ok(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','sms',false)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','a staff lift over a STOP is refused');
SELECT ok(pg_temp.as_user(NULL,$q$SELECT public.set_contact_channel_suppression('e0963000-0000-4000-8000-000000000003','sms',false)$q$,'service_role')->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','the service path refuses the same lift');
DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000003';
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email',false)->>'changed','true','the business lifts its own email pause');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email' AND action='granted'),0::bigint,'the lift writes no granted event (D3)');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email' AND action='revoked' AND source='admin_ui'),1::bigint,'the pause still wrote its revoked event');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000005','e0963000-0000-4000-8000-000000000002','email',true)->>'sqlstate','42501','a member with only the global admin role is refused (§59)');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000002','e0963000-0000-4000-8000-000000000002','email',true)->>'error','SUPPRESSION_CONTACT_NOT_IN_TENANT','a foreign owner cannot touch this contact');

-- ── B1. No raw path forges, overrides or deletes a customer's choice ─────────────────────────────
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$WITH d AS (DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='sms' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','an owner raw DELETE of a customer_request row is refused');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$INSERT INTO public.paige_consent_events(contact_id,channel,topic,action,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','newsletter','granted','customer_portal') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','an owner raw INSERT as customer_portal is refused');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$INSERT INTO public.paige_consent_events(contact_id,channel,action,source) VALUES ('e0963000-0000-4000-8000-000000000004','sms','granted','inbound_message') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','an owner raw INSERT posing as a START reply is refused');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','unsubscribe_link','admin_ui') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','an owner raw suppression posing as the contact''s unsubscribe is refused');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$INSERT INTO public.paige_consent_events(contact_id,channel,action,source) VALUES ('e0963000-0000-4000-8000-000000000004','sms','granted','admin_ui') RETURNING to_jsonb(id)$q$) ? 'sqlstate' = false,'paper consent the business records itself is still allowed (D7)');
SELECT is((public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000004'))#>>'{sms,set_by}','business','and it reads as set by the business, never the contact');
-- The agency owner, switched into the sub-account, gets the same refusals (RLS admits agencies).
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000006',
  $q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000008','sms','customer_request','customer_portal') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501','an agency raw INSERT as customer_portal is refused');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000006',
  $q$WITH d AS (DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000008' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','an agency raw DELETE of the sub-account customer''s row is refused');
SELECT is(pg_temp.as_user(NULL,
  $q$INSERT INTO public.paige_suppressions(contact_id,channel,reason,source) VALUES ('e0963000-0000-4000-8000-000000000004','email','customer_request','customer_portal') RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','42501','even the service role cannot write a customer_portal row');
-- Deleting the contact itself still cascades (the row's owner is gone).
INSERT INTO public.paige_suppressions(tenant_id,contact_id,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000011','email','unsubscribe_link','webhook');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$DELETE FROM public.clients WHERE id='e0963000-0000-4000-8000-000000000011' RETURNING to_jsonb(id)$q$) ? 'sqlstate' = false,'deleting a contact with a customer-held row still cascades');

-- ── B2. A customer opt-out under a business pause survives the business lifting it ───────────────
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email',true)->>'changed','true','business pauses Sam again');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000004','email',NULL,false)->>'replayed','false','the customer still records their own off (never a replay of the business state)');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000002' AND channel='email'),2::bigint,'two rows: the business pause and the customer''s own');
SELECT ok(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email',false)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','the business can no longer lift it');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002','email','sam.okafor@tests.invalid'),'blocked_suppressed','parity: email stays blocked');
SELECT is((pg_temp.prefs('e0961000-0000-4000-8000-000000000004')->'email'->>'can_turn_off'),'false','the customer has recorded off');

-- The service writers keep working on the new holder-class slots: a one-click unsubscribe now lands
-- even while the business holds the contact's slot (it used to be swallowed as 23505), and a START
-- reply (service role) still lifts the customer's own texts-off.
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email',true)->>'changed','true','the business pauses Jordan''s email');
SELECT ok(pg_temp.as_user(NULL,$q$INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
  VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','jordan.rivera@tests.invalid','email','unsubscribe_link','webhook') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,'the unsubscribe insert succeeds');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000001' AND channel='email'),2::bigint,'an unsubscribe click lands beside a business pause');
SELECT is(pg_temp.as_user(NULL,$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND channel='sms' AND contact_id='e0963000-0000-4000-8000-000000000002' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$,'service_role')::text,'1','a START reply (service) lifts the customer''s texts-off');

-- ── M1. A shared phone: Riley's choice never touches or shows Drew's ─────────────────────────────
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000004','+15550100009','sms','granted','inbound_message','SMdrew');
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref)
VALUES ('e0962000-0000-4000-8000-000000000001',NULL,'+15550100009','sms','granted','inbound_message','SMcontactless');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000008')#>>'{sms,state}','not_set','Riley never sees Drew''s START (or a contactless one on the shared number)');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000008','sms',NULL,false)->>'ok','true','Riley turns texts off');
SELECT is((SELECT address_normalized FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000003' AND channel='sms'),NULL,'Riley''s row is contact-keyed only: the shared number is not written');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000004','sms','+15550100009'),'proceed','Drew''s send disposition is unchanged');

-- ── M5. A merge keeps the opt-out ──────────────────────────────────────────────────────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000009','email',NULL,false)->>'ok','true','Morgan turns email off');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0963000-0000-4000-8000-000000000005';
UPDATE public.clients SET merged_into_contact_id='e0963000-0000-4000-8000-000000000006',merged_at=now(),status='archived' WHERE id='e0963000-0000-4000-8000-000000000005';
UPDATE public.clients SET linked_user_id='e0961000-0000-4000-8000-000000000009' WHERE id='e0963000-0000-4000-8000-000000000006';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000006','email','morgan.lee@tests.invalid'),'blocked_suppressed','after the merge, email to the address is still blocked');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000009')#>>'{email,state}','off','and the winner''s card still says off');

-- ── 18. The owner read ─────────────────────────────────────────────────────────────────────────
SELECT is((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002')$q$)) k),
  ARRAY['contact_id','data_sharing','dnd_active','do_not_contact','email','portal_access','portal_joined','quiet_hours','read_at','schema_version','sms','tenant_id','updates'],'owner read keys are exact');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002')$q$)#>>'{sms,set_by}','you','the owner sees the client set it');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000005',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002')$q$)->>'error','Client unavailable','a non-admin member is refused');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000002',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000002')$q$)->>'error','Client unavailable','a foreign owner naming this business is refused');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000007')$q$)->>'error','Client unavailable','a foreign contact answers the same');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000007',
  $q$SELECT public.read_client_communication_state('e0962000-0000-4000-8000-000000000004','e0963000-0000-4000-8000-000000000008')$q$)#>>'{email,state}','off','the sub-account owner reads their client (Sub-account tier)');

-- ── 19. §37 readers keep their shape; the dashboard counts portal opt-outs (M6) ──────────────────
SELECT ok((pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.tenant_comms_readiness()$q$) ? 'consent'),'tenant_comms_readiness still returns its consent block');
SELECT is((pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.read_email_marketing_dashboard(30,'UTC')$q$)#>>'{stats,unsubscribes}')::int,
  (SELECT count(*)::int FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND channel='email' AND reason IN ('unsubscribe_link','customer_request')),'unsubscribes count the portal opt-outs');
SELECT ok((pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.read_email_marketing_dashboard(30,'UTC')$q$)#>>'{stats,unsubscribes}')::int >= 2,'and there are at least two of them here');
SELECT ok(EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT public.read_email_marketing_dashboard(30,'UTC')$q$)->'activity') a
  WHERE a->>'kind'='unsubscribed' AND a->>'detail'='customer_request'),'the activity feed lists a portal opt-out as unsubscribed');

-- ══ Round 2 ═══════════════════════════════════════════════════════════════════════════════════
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0961000-0000-4000-8000-000000000013','authenticated','authenticated','blair.ng@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000014','authenticated','authenticated','kai.moreno@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000015','authenticated','authenticated','reese.park@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('e0961000-0000-4000-8000-000000000016','authenticated','authenticated','lee.adams@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,timezone) VALUES
 ('e0963000-0000-4000-8000-000000000012','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000013','e0961000-0000-4000-8000-000000000001','Blair','Ng','active',NULL),
 ('e0963000-0000-4000-8000-000000000013','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000014','e0961000-0000-4000-8000-000000000001','Kai','Moreno','active',NULL),
 ('e0963000-0000-4000-8000-000000000014','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Kai','Moreno (work)','active',NULL),
 ('e0963000-0000-4000-8000-000000000015','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000015','e0961000-0000-4000-8000-000000000001','Reese','Park','active','america/new_york'),
 ('e0963000-0000-4000-8000-000000000016','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000016','e0961000-0000-4000-8000-000000000001','Lee','Adams','active','Mars/Olympus_Mons'),
 ('e0963000-0000-4000-8000-000000000017','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Lee','Adams (new)','active',NULL),
 ('e0963000-0000-4000-8000-000000000018','e0962000-0000-4000-8000-000000000001',NULL,'e0961000-0000-4000-8000-000000000001','Rowan','Held','active',NULL);
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000012','email','blair.ng@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000013','email','kai.moreno@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000013','phone','555 010 0013',true,1),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','email','kai.work@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','phone','555 010 0014',true,1),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000015','email','reese.park@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000016','email','lee.adams@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017','email','lee.new@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017','phone','555 010 0017',true,1),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000018','email','rowan.held@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000018','phone','555 010 0018',true,1);

-- ── R2-1. Deleting a contact never deletes the opt-out they hold (verifier MAJOR 1) ───────────────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000013','email',NULL,false)->>'ok','true','Blair turns email off');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000012','sms',true)->>'changed','true','the business also pauses Blair''s texts (its own row)');
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000012','blair.ng@tests.invalid','email','manual','api');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000005',$q$WITH d AS (DELETE FROM public.clients WHERE id='e0963000-0000-4000-8000-000000000012' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)::text,'1',
  'a staff raw DELETE of the client goes through (the attack the verifier ran)');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND channel='email'
  AND contact_id IS NULL AND address_normalized='blair.ng@tests.invalid' AND reason='customer_request' AND source='customer_portal'),1::bigint,
  'the customer''s opt-out survives, address-keyed (contact_id set to NULL, address kept)');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000004','email','Blair.Ng+again@tests.invalid'),'blocked_suppressed',
  'a send to that address, from any contact, is still blocked');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND contact_id IS NULL
  AND address_normalized='blair.ng@tests.invalid' AND action='revoked' AND source='customer_portal'),1::bigint,'and so does the evidence of it');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND reason='manual'
  AND (address_normalized='blair.ng@tests.invalid' OR (contact_id IS NULL AND channel='sms'))),0::bigint,
  'the business''s own pauses go with the contact, as before, even one that carries the address');
INSERT INTO public.clients(id,tenant_id,created_by,first_name,last_name,status) VALUES
 ('e0963000-0000-4000-8000-000000000019','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000001','Blair','Ng (re-imported)','active');
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000019','email','blair.ng@tests.invalid',true,0);
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000019')#>>'{email,state}','off',
  'a re-imported contact on that address reads email off');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000019','email','blair.ng@tests.invalid'),'blocked_suppressed',
  'and the send gate agrees');
SELECT ok(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000019','email',false)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%',
  'the business cannot lift it through the re-imported contact');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE address_normalized='blair.ng@tests.invalid' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%',
  'nor delete the detached row raw');

-- ── R2-2. A merge moves the opt-out to the winner; card and send gate agree (verifier MAJOR 2) ────
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000014','email',NULL,false)->>'ok','true','Kai turns email off');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000013','sms',true)->>'changed','true','the business pauses Kai''s texts');
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref,created_at)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000013','+15550100013','sms','granted','inbound_message','SMkai',now()-interval '1 hour');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET linked_user_id=NULL WHERE id='e0963000-0000-4000-8000-000000000013';
UPDATE public.clients SET merged_into_contact_id='e0963000-0000-4000-8000-000000000014',merged_at=now(),status='archived' WHERE id='e0963000-0000-4000-8000-000000000013';
UPDATE public.clients SET linked_user_id='e0961000-0000-4000-8000-000000000014' WHERE id='e0963000-0000-4000-8000-000000000014';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000014')#>>'{email,state}','off','after a merge onto a different email, the card says off');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','email','kai.work@tests.invalid'),'blocked_suppressed',
  'and a send to the winner''s own address is blocked too (they agree)');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','email','kai.moreno@tests.invalid'),'blocked_suppressed',
  'the old address stays blocked');
SELECT is((SELECT contact_id::text||'|'||address_normalized FROM public.paige_suppressions WHERE channel='email' AND reason='customer_request' AND address_normalized='kai.moreno@tests.invalid'),
  'e0963000-0000-4000-8000-000000000014|kai.moreno@tests.invalid','the row now names the winner and keeps the address');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000014' AND action='revoked'),2::bigint,
  'the opt-out events move with it (email off, texts paused)');
SELECT is((SELECT count(*) FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000013' AND action='granted'),1::bigint,
  'a START given for the old number stays with the archived contact');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000014')#>>'{sms,state}','off','texts read off on the winner (the business pause moved)');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','sms','555 010 0014'),'blocked_suppressed','and the send gate agrees');
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','sms',false)->>'changed','true','the business can lift its own moved pause on the winner');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000014')#>>'{sms,state}','off','the old number''s START never turns texts on for the new number (the moved pause event is the latest)');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000014','sms','555 010 0014'),'blocked_no_consent','nor in the send gate');
-- The winner already holds the same slot: the archived contact's row stays, address-keyed.
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017','lee.new@tests.invalid','email','unsubscribe_link','webhook');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000016','email',NULL,false)->>'ok','true','Lee turns email off');
-- Lee also replied START from an old number (contact-keyed): consent for that number only.
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000016','+15550100016','sms','granted','inbound_message','SMlee');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('app.crm_merge_lineage_write','on',true);
UPDATE public.clients SET merged_into_contact_id='e0963000-0000-4000-8000-000000000017',merged_at=now(),status='archived' WHERE id='e0963000-0000-4000-8000-000000000016';
SELECT set_config('app.crm_merge_lineage_write','off',true);
SELECT set_config('request.jwt.claims','{}',true);
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id IS NULL AND address_normalized='lee.adams@tests.invalid' AND reason='customer_request'),1::bigint,
  'a slot the winner already holds keeps the old row address-keyed');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017','email','lee.adams@tests.invalid'),'blocked_suppressed','the old address stays blocked');
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017')#>>'{email,state}','off','the winner reads off');
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017')#>>'{sms,state}','not_set',
  'the archived contact''s START is not read as consent for the winner''s number (one derivation: no merged-contact rows)');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000017','sms','555 010 0017'),'blocked_no_consent','and the send gate agrees');

-- ── R2-3. A spam report: only the customer takes it back (integrator default (owner may overrule)) ──────────────────────────
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,topic,action,source,created_at)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','riley.chen@tests.invalid','email','newsletter','granted','signup_form',now()-interval '2 hours');
SELECT ok(pg_temp.as_user(NULL,$q$INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
  VALUES ('e0962000-0000-4000-8000-000000000001',NULL,'riley.chen@tests.invalid','email','complaint','webhook') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,'a contactless spam report lands (service)');
SELECT is((pg_temp.prefs('e0961000-0000-4000-8000-000000000008')->'email') - 'set_at'::text,
  jsonb_build_object('state','off','set_by','reported','can_turn_on',true,'can_turn_off',false),'the card reads it as the customer''s own report, and offers them the way back');
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003')#>>'{email,set_by}','reported','the owner reads "reported", never "delivery"');
SELECT ok(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','email',false)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%','the business cannot lift a spam report');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000008','email',NULL,true)->>'replayed','false','the customer turns email back on');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE address_normalized='riley.chen@tests.invalid' AND channel='email'),0::bigint,'their report is lifted');
SELECT is((SELECT string_agg(coalesce(topic,'-')||':'||action, ',' ORDER BY created_at) FROM public.paige_consent_events
  WHERE contact_id='e0963000-0000-4000-8000-000000000003' AND channel='email' AND source='customer_portal'),'-:granted,newsletter:revoked',
  'evidence of the act (granted), then out of Updates and offers (revoked), in that order');
SELECT ok((SELECT evidence_ref FROM public.paige_consent_events WHERE contact_id='e0963000-0000-4000-8000-000000000003' AND channel='email' AND topic IS NULL AND action='granted')
  LIKE 'portal:e0961000-0000-4000-8000-000000000008:email-pref:v2:%','the lift names the session and the email disclosure the page shows (v2)');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000008')#>>'{email,state}','on','email is on');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000008')#>>'{updates,state}','not_subscribed','taking back a spam report never re-subscribes them');
SELECT is(pg_temp.presend('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000003','email','riley.chen@tests.invalid'),'proceed','the send gate agrees email is on');
SELECT is((SELECT action FROM public.paige_consent_events WHERE tenant_id='e0962000-0000-4000-8000-000000000001' AND channel='email'
  AND (contact_id='e0963000-0000-4000-8000-000000000003' OR address_normalized='riley.chen@tests.invalid') ORDER BY created_at DESC, id DESC LIMIT 1),'revoked',
  'marketing automations stay closed (tenantConsent reads revoked)');
-- A contact-keyed report (process_resend_receipt writes contact_id, no address).
SELECT ok(pg_temp.as_user(NULL,$q$INSERT INTO public.paige_suppressions(tenant_id,contact_id,channel,reason,source)
  VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000015','email','complaint','webhook') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,'a contact-keyed spam report lands');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000015')#>>'{email,set_by}','reported','it reads as reported');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000015','email',NULL,true)->>'ok','true','and the customer can take it back');
-- A report under a business pause: the pause still decides.
SELECT is(pg_temp.lift('e0961000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000015','email',true)->>'changed','true','the business pauses Reese');
SELECT ok(pg_temp.as_user(NULL,$q$INSERT INTO public.paige_suppressions(tenant_id,contact_id,channel,reason,source)
  VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000015','email','complaint','webhook') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,'and Reese reports again');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000015','email',NULL,true)->>'error','EMAIL_PAUSED_BY_BUSINESS','under a business pause the customer cannot turn email on');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000015' AND reason='complaint'),1::bigint,'and their report is untouched');

-- ── R2-4. After a customer leaves Updates, only they can come back (integrator default (owner may overrule)) ────────────────
-- Jordan unsubscribed from Updates in the portal (section 8).
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000001',true))$q$)->>'sqlstate','42501',
  'the owner cannot subscribe them again through the newsletter setter');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000001',true))$q$)->>'error' LIKE 'NEWSLETTER_LEFT_BY_CONTACT%','with NEWSLETTER_LEFT_BY_CONTACT');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',
  $q$INSERT INTO public.paige_consent_events(contact_id,channel,topic,action,source) VALUES ('e0963000-0000-4000-8000-000000000001','email','newsletter','granted','admin_ui') RETURNING to_jsonb(id)$q$)->>'sqlstate','42501',
  'nor with a raw insert');
SELECT is(pg_temp.as_user(NULL,
  $q$INSERT INTO public.paige_consent_events(tenant_id,contact_id,channel,topic,action,source) VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000001','email','newsletter','granted','api') RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','42501',
  'nor can Paige acting for the business (service, api)');
SELECT is(pg_temp.as_user(NULL,
  $q$INSERT INTO public.paige_consent_events(tenant_id,address_normalized,channel,topic,action,source) VALUES ('e0962000-0000-4000-8000-000000000001','jordan.rivera@tests.invalid','email','newsletter','granted','admin_ui') RETURNING to_jsonb(id)$q$,'service_role')->>'sqlstate','42501',
  'nor by address alone');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000001',false))$q$)::text,'true',
  'the business can still record an unsubscribe');
-- Taking back a spam report also counts as leaving Updates (R2-3): Riley.
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000003',true))$q$)->>'sqlstate','42501',
  'after a spam report the business cannot subscribe them');
-- A held unsubscribe click counts too: Rowan.
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000018','rowan.held@tests.invalid','email','unsubscribe_link','webhook');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000018',true))$q$)->>'sqlstate','42501',
  'while they hold their unsubscribe click, the business cannot subscribe them');
-- The customer comes back themselves (Riley, whose email is on again); then the business may record it.
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000008','email','newsletter',true)->>'ok','true','Riley subscribes again themselves');
SELECT is(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000003',true))$q$)::text,'true',
  'after which the business''s own grant is accepted');
SELECT ok(pg_temp.as_user(NULL,$q$INSERT INTO public.paige_consent_events(tenant_id,contact_id,channel,topic,action,source) VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000018','email','newsletter','granted','signup_form') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,
  'a sign-up form (the person''s own act) is never refused');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$SELECT to_jsonb(public.email_newsletter_consent_set('e0963000-0000-4000-8000-000000000004',true))$q$) ? 'sqlstate' = false,
  'a contact who never left Updates can be recorded by the business (D7 unchanged)');

-- ── R2-5. Raw DELETE of every row class the contact holds (verifier MEDIUM 4) ────────────────────
INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000018','+15550100018','sms','user_stop','inbound_message'),
 ('e0962000-0000-4000-8000-000000000001',NULL,'nobody.report@tests.invalid','email','complaint','webhook');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000018' AND reason='user_stop' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%',
  'an owner raw DELETE of a STOP is refused');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000018' AND reason='unsubscribe_link' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%',
  'an owner raw DELETE of an unsubscribe click is refused');
SELECT ok(pg_temp.as_user('e0961000-0000-4000-8000-000000000001',$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE address_normalized='nobody.report@tests.invalid' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$)->>'error' LIKE 'SUPPRESSION_HELD_BY_CONTACT%',
  'an owner raw DELETE of a contactless spam report is refused');
SELECT is((SELECT count(*) FROM public.paige_suppressions WHERE (contact_id='e0963000-0000-4000-8000-000000000018' AND reason IN ('user_stop','unsubscribe_link')) OR address_normalized='nobody.report@tests.invalid'),3::bigint,
  'all three rows survive');

-- ── R2-6. Quiet hours: "your time" only when the send gate can use the zone (compliance should-fix 5)
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000015')#>>'{quiet_hours,time_zone_known}','true','a valid zone in any case is known (the gate''s Intl accepts it)');
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000016')#>>'{quiet_hours,time_zone_known}','false',
  'an invalid zone is not known: the gate falls back to its default, so it is not their time');

-- ── R3-1. The evidence names exactly the disclosure the customer is shown (verifier BLOCKING 1) ────
-- The current sentences' hashes, pinned. src/lib/client-portal-preferences.test.ts computes md5 of the
-- page's CURRENT_DISCLOSURE text and requires these same literals, so page text → hash → this pin →
-- every writer's evidence is one checked chain.
SELECT is(left(md5(public.client_portal_consent_disclosure('email-pref:v2')),12),'b4d412982660','pin: email-pref:v2');
SELECT is(left(md5(public.client_portal_consent_disclosure('updates-optin:v2')),12),'17d1249d3abe','pin: updates-optin:v2');
SELECT is(left(md5(public.client_portal_consent_disclosure('sms-pref:v2')),12),'8b66faa37a43','pin: sms-pref:v2');
SELECT is(left(md5(public.client_portal_consent_disclosure('data-sharing:v1')),12),'a7fbb88f3732','pin: data-sharing:v1');
SELECT ok(public.client_portal_consent_disclosure('email-pref:v1') IS NOT NULL AND public.client_portal_consent_disclosure('updates-optin:v1') IS NOT NULL
  AND public.client_portal_consent_disclosure('sms-pref:v1') IS NOT NULL,'v1 sentences are kept: evidence already written names them');
-- Every branch, fresh: Avery (sub-account) and a new customer, Parker, subscribed with texts on.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('e0961000-0000-4000-8000-000000000030','authenticated','authenticated','parker.vale@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status,timezone) VALUES
 ('e0963000-0000-4000-8000-000000000030','e0962000-0000-4000-8000-000000000001','e0961000-0000-4000-8000-000000000030','e0961000-0000-4000-8000-000000000001','Parker','Vale','active',NULL);
INSERT INTO public.client_contact_methods(tenant_id,client_id,kind,value,is_primary,position) VALUES
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000030','email','parker.vale@tests.invalid',true,0),
 ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000030','phone','+15550100030',true,1);
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,action,source,evidence_ref)
VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000030','+15550100030','sms','granted','inbound_message','SMparker');
CREATE FUNCTION pg_temp.ev(_contact uuid, _ch text, _topic text, _action text) RETURNS text
LANGUAGE sql AS $$ SELECT e.evidence_ref FROM public.paige_consent_events e WHERE e.contact_id=_contact AND e.channel=_ch
  AND e.topic IS NOT DISTINCT FROM _topic AND e.action=_action AND e.source='customer_portal' ORDER BY e.created_at DESC, e.id DESC LIMIT 1 $$;
CREATE FUNCTION pg_temp.names(_ref text, _id text) RETURNS boolean
LANGUAGE sql AS $$ SELECT _ref = 'portal:e0961000-0000-4000-8000-000000000030:'||_id||':'||left(md5(public.client_portal_consent_disclosure(_id)),12) $$;
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','email','newsletter',true)->>'ok','true','Parker subscribes');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email','newsletter','granted'),'updates-optin:v2'),'subscribe records updates-optin:v2 and its hash');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','email','newsletter',false)->>'ok','true','Parker unsubscribes');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email','newsletter','revoked'),'updates-optin:v2'),'unsubscribe records updates-optin:v2 and its hash');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','email','newsletter',true)->>'ok','true','Parker subscribes again');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','email',NULL,false)->>'ok','true','Parker turns email off while subscribed');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email',NULL,'revoked'),'email-pref:v2'),'email off records email-pref:v2 and its hash');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email','newsletter','revoked'),'updates-optin:v2'),'the Updates exit email off writes (D4) records updates-optin:v2');
-- Their own spam report replaces their portal choice (service context, as the delivery webhook writes it).
SELECT ok(pg_temp.as_user(NULL,$q$WITH d AS (DELETE FROM public.paige_suppressions WHERE contact_id='e0963000-0000-4000-8000-000000000030' AND channel='email' RETURNING 1) SELECT to_jsonb(count(*)) FROM d$q$,'service_role') ? 'sqlstate' = false
  AND pg_temp.as_user(NULL,$q$INSERT INTO public.paige_suppressions(tenant_id,contact_id,address_normalized,channel,reason,source) VALUES ('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000030','parker.vale@tests.invalid','email','complaint','webhook') RETURNING to_jsonb(id)$q$,'service_role') ? 'sqlstate' = false,
  'Parker''s email is now held by their own spam report');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','email',NULL,true)->>'ok','true','Parker takes the report back');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email',NULL,'granted'),'email-pref:v2'),'taking a report back records email-pref:v2 and its hash');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','email','newsletter','revoked'),'updates-optin:v2'),'and its Updates exit records updates-optin:v2');
SELECT is(pg_temp.pref('e0961000-0000-4000-8000-000000000030','sms',NULL,false)->>'ok','true','Parker turns texts off');
SELECT ok(pg_temp.names(pg_temp.ev('e0963000-0000-4000-8000-000000000030','sms',NULL,'revoked'),'sms-pref:v2'),'texts off records sms-pref:v2 and its hash');
-- Across every customer and every branch this file ran: no portal event and no audit row names anything
-- but a current id, and every hash is the hash of that id's sentence.
SELECT is((SELECT count(*) FROM public.paige_consent_events e WHERE e.source='customer_portal'
   AND e.tenant_id IN ('e0962000-0000-4000-8000-000000000001','e0962000-0000-4000-8000-000000000004')
   AND (e.evidence_ref !~ '^portal:[0-9a-f-]{36}:(email-pref:v2|updates-optin:v2|sms-pref:v2):[0-9a-f]{12}$'
        OR right(e.evidence_ref,12) <> left(md5(public.client_portal_consent_disclosure(substring(e.evidence_ref from '^portal:[0-9a-f-]{36}:(.*):[0-9a-f]{12}$'))),12))),0::bigint,
  'every portal consent event names a current disclosure and its exact hash');
SELECT ok((SELECT count(*) FROM public.paige_consent_events e WHERE e.source='customer_portal' AND e.tenant_id='e0962000-0000-4000-8000-000000000001') >= 10,'that sweep covered real rows');
SELECT is((SELECT count(*) FROM public.audit_logs a WHERE a.entity='client_portal' AND a.action='communication_preference_set'
   AND a.data->>'disclosure' NOT IN ('email-pref:v2','updates-optin:v2','sms-pref:v2')),0::bigint,'every audit row names a current disclosure');

-- ── R3-2. Quiet hours name the zone the send gate actually falls back to (verifier MINOR 4) ────────
-- runPreSend: safeTz(client.timezone ?? business autosend_dnd_timezone) — a stored client zone, valid or
-- not, is used first (an invalid one falls to Eastern); with none, the business's valid zone; else Eastern.
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000004')#>'{quiet_hours,fallback_time_zone}','null'::jsonb,'a known zone needs no fallback');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000030')#>>'{quiet_hours,fallback_time_zone}','America/New_York','no zone anywhere: Eastern');
INSERT INTO public.tenant_comms_preferences(tenant_id,autosend_dnd_timezone) VALUES ('e0962000-0000-4000-8000-000000000001','america/chicago');
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000030')#>>'{quiet_hours,fallback_time_zone}','America/Chicago','no client zone: the business''s zone, as the gate reads it');
SELECT is(public._client_communication_state('e0962000-0000-4000-8000-000000000001','e0963000-0000-4000-8000-000000000016')#>>'{quiet_hours,fallback_time_zone}','America/New_York',
  'an invalid client zone falls to Eastern even when the business has one (safeTz of the client''s string)');
UPDATE public.tenant_comms_preferences SET autosend_dnd_timezone='Mars/Olympus_Mons' WHERE tenant_id='e0962000-0000-4000-8000-000000000001';
SELECT is(pg_temp.prefs('e0961000-0000-4000-8000-000000000030')#>>'{quiet_hours,fallback_time_zone}','America/New_York','an invalid business zone: Eastern');

SELECT * FROM finish();
ROLLBACK;
