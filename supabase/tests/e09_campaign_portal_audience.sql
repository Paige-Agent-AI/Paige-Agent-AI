-- E09 C1: announcements to customers through the one governed campaign system (20271111060000).
-- Full replayed schema, actual caller roles, synthetic data only (§63: Northwind Studio, Jordan Rivera);
-- everything rolled back.
--
-- Proves:
--   1. the five new helpers are internal (no anon / authenticated / service_role EXECUTE);
--   2. _client_portal_customer_open agrees with client_portal_relationship_id (Slice 7) for every
--      linked customer — open, paused, inactive, merged, another business, and a suspended business;
--   3. the `portal` audience reaches open-access customers of THIS business only;
--   4. owner Q1 at plan: a promotion / announcement / newsletter to a portal-linked contact needs their
--      Updates and offers consent whatever the rule; unlinked contacts and other kinds are unchanged;
--      the 3-argument _email_audience (series, dashboard) is unchanged apart from the portal filter;
--   5. rule keys are validated on every campaign draft write and on the rule frozen at request_approval
--      (a saved segment's too); the series checker still refuses `portal`;
--   6. the owner's preview counts the same people the plan freezes;
--   7. through the real seams (create → update_draft → request_approval → approve → dispatch_claim):
--      a customer paused after approval is skipped as contact_removed, and Updates turned off by the
--      customer after approval is skipped as no_consent — on a portal audience AND on a plain one;
--   8. the editor's portal count is this business's open-access customers only.
BEGIN;
SELECT plan(72);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data)
SELECT ('e0c10100-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid,'authenticated','authenticated',
       'c1-user-'||n||'@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'
  FROM generate_series(1,13) n;
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,account_number_prefix,account_number,features) VALUES
 ('e0c10200-0000-4000-8000-000000000001','test-tenant-e09-c1-northwind','Northwind Studio','active','standalone',NULL,'E09C1',9411001,'{}'),
 ('e0c10200-0000-4000-8000-000000000002','test-tenant-e09-c1-harbor','Harbor Lane Studio','active','standalone',NULL,'E09C2',9411002,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000001','owner','active',true,now()),
 ('e0c10200-0000-4000-8000-000000000002','e0c10100-0000-4000-8000-000000000012','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='e0c10200-0000-4000-8000-000000000001' WHERE user_id='e0c10100-0000-4000-8000-000000000001';
UPDATE public.profiles SET active_tenant_id='e0c10200-0000-4000-8000-000000000002' WHERE user_id='e0c10100-0000-4000-8000-000000000012';
INSERT INTO public.tenant_legal_profile(tenant_id,legal_business_name,registered_address) VALUES
 ('e0c10200-0000-4000-8000-000000000001','Northwind Studio LLC','1 Test Way, Springfield, ZZ 00000');
INSERT INTO public.channel_connectors(id,tenant_id,channel_type,provider,from_name,from_address,status,active) VALUES
 ('e0c10900-0000-4000-8000-000000000001','e0c10200-0000-4000-8000-000000000001','email','smtp','Northwind Studio','hello@northwind.tests.invalid','active',true);

-- Contacts of Northwind (A..J) and one customer of Harbor Lane (X). Letter = last two id digits.
--  A Jordan Rivera  linked, open,   Updates on      B Casey Park   linked, open,   Updates never given
--  C Riley Chen     linked, paused, Updates on      D Morgan Lee   access ended (unlinked), Updates on
--  E Sam Ortiz      never linked,   Updates never   F Avery Brooks linked, open, INACTIVE contact, Updates on
--  G Taylor Kim     linked, open, MERGED into E     H Jamie Fox    linked, open,   Updates on
--  I Drew Hale      linked, open,   Updates on      J Quinn Rowe   linked, open,   Updates on
--  X Rowan Ellis    linked, open, Updates on — Harbor Lane's customer
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,email,status) VALUES
 ('e0c10300-0000-4000-8000-000000000001','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000002','e0c10100-0000-4000-8000-000000000001','Jordan','Rivera','jordan.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000002','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000003','e0c10100-0000-4000-8000-000000000001','Casey','Park','casey.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000003','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000004','e0c10100-0000-4000-8000-000000000001','Riley','Chen','riley.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000004','e0c10200-0000-4000-8000-000000000001',NULL,'e0c10100-0000-4000-8000-000000000001','Morgan','Lee','morgan.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000005','e0c10200-0000-4000-8000-000000000001',NULL,'e0c10100-0000-4000-8000-000000000001','Sam','Ortiz','sam.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000006','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000007','e0c10100-0000-4000-8000-000000000001','Avery','Brooks','avery.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000007','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000008','e0c10100-0000-4000-8000-000000000001','Taylor','Kim','taylor.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000008','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000009','e0c10100-0000-4000-8000-000000000001','Jamie','Fox','jamie.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000009','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000010','e0c10100-0000-4000-8000-000000000001','Drew','Hale','drew.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000010','e0c10200-0000-4000-8000-000000000001','e0c10100-0000-4000-8000-000000000011','e0c10100-0000-4000-8000-000000000001','Quinn','Rowe','quinn.c1@tests.invalid','active'),
 ('e0c10300-0000-4000-8000-000000000011','e0c10200-0000-4000-8000-000000000002','e0c10100-0000-4000-8000-000000000013','e0c10100-0000-4000-8000-000000000012','Rowan','Ellis','rowan.c1@tests.invalid','active');
-- States the access seam owns (set here as fixtures through its own write flag).
DO $$ BEGIN PERFORM set_config('paige.portal_access_write','1',true); END $$;
UPDATE public.clients SET portal_access_state='paused' WHERE id='e0c10300-0000-4000-8000-000000000003';
UPDATE public.clients SET portal_access_state='ended', portal_access_former_user_id='e0c10100-0000-4000-8000-000000000005' WHERE id='e0c10300-0000-4000-8000-000000000004';
DO $$ BEGIN PERFORM set_config('paige.portal_access_write','',true); END $$;
UPDATE public.clients SET status='inactive' WHERE id='e0c10300-0000-4000-8000-000000000006';
-- Merge lineage is written only by the governed merge; set as a fixture through its own flag.
DO $$ BEGIN PERFORM set_config('request.jwt.claims','{"role":"service_role"}',true), set_config('app.crm_merge_lineage_write','on',true); END $$;
UPDATE public.clients SET merged_into_contact_id='e0c10300-0000-4000-8000-000000000005', merged_at=now() WHERE id='e0c10300-0000-4000-8000-000000000007';
DO $$ BEGIN PERFORM set_config('request.jwt.claims','{}',true), set_config('app.crm_merge_lineage_write','',true); END $$;
-- Updates and offers consent, recorded the way a sign-up form records it.
INSERT INTO public.paige_consent_events(tenant_id,contact_id,address_normalized,channel,topic,action,source,created_at)
SELECT c.tenant_id, c.id, lower(c.email), 'email', 'newsletter', 'granted', 'signup_form', now()-interval '3 days'
  FROM public.clients c
 WHERE c.id IN ('e0c10300-0000-4000-8000-000000000001','e0c10300-0000-4000-8000-000000000003','e0c10300-0000-4000-8000-000000000004',
                'e0c10300-0000-4000-8000-000000000006','e0c10300-0000-4000-8000-000000000007','e0c10300-0000-4000-8000-000000000008',
                'e0c10300-0000-4000-8000-000000000009','e0c10300-0000-4000-8000-000000000010','e0c10300-0000-4000-8000-000000000011');

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='service_role' THEN SET LOCAL ROLE service_role; ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.owner(_sql text) RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user('e0c10100-0000-4000-8000-000000000001', _sql) $$;
CREATE FUNCTION pg_temp.c(_n int) RETURNS uuid LANGUAGE sql IMMUTABLE AS
 $$ SELECT ('e0c10300-0000-4000-8000-0000000000'||lpad(_n::text,2,'0'))::uuid $$;
-- Who an audience reaches, as "letter:reason" for every matched contact of Northwind, sorted.
CREATE FUNCTION pg_temp.aud(_rule jsonb, _kind text) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(chr(64 + right(a.client_id::text,2)::int)||':'||COALESCE(a.ineligible,'ok'), ' ' ORDER BY a.client_id)
   FROM public._email_audience('e0c10200-0000-4000-8000-000000000001', _rule, _kind = 'newsletter', _kind) a $$;
CREATE FUNCTION pg_temp.aud3(_rule jsonb) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(chr(64 + right(a.client_id::text,2)::int)||':'||COALESCE(a.ineligible,'ok'), ' ' ORDER BY a.client_id)
   FROM public._email_audience('e0c10200-0000-4000-8000-000000000001', _rule, false) a $$;
-- The relationship a customer's own session resolves for a business (Slice 7), as that customer.
CREATE FUNCTION pg_temp.rel(_uid uuid, _tenant uuid) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN _r := pg_temp.as_user(_uid, format('SELECT to_jsonb(public.client_portal_relationship_id(%L::uuid))', _tenant));
 RETURN CASE WHEN _r IS NULL OR jsonb_typeof(_r) <> 'string' THEN NULL ELSE (_r #>> '{}')::uuid END; END $$;
-- Recipients of a campaign version, "letter:status[:reason]", sorted.
CREATE FUNCTION pg_temp.rcpt(_version uuid) RETURNS text LANGUAGE sql AS $$
 SELECT string_agg(chr(64 + right(r.client_id::text,2)::int)||':'||r.status||COALESCE(':'||r.skip_reason,''), ' ' ORDER BY r.client_id)
   FROM public.email_campaign_recipients r WHERE r.version_id = _version $$;
-- A campaign drafted through the editor's own writer, filed and approved by the owner. Returns the version.
CREATE FUNCTION pg_temp.campaign(_kind text, _rule jsonb, _name text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _made jsonb; _v uuid; _r jsonb;
BEGIN
 _made := pg_temp.owner(format('SELECT public.email_campaign_create(%L,%L)', _kind, _name));
 _v := (_made->>'version_id')::uuid;
 IF _v IS NULL THEN RAISE EXCEPTION 'create failed: %', _made; END IF;
 _r := pg_temp.owner(format('SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, NULL, NULL, %L, NULL, %L, NULL, %L::jsonb))',
        _v, 'News from Northwind', '<p>Hello from Northwind Studio.</p>', _rule));
 IF _r ? 'error' THEN RAISE EXCEPTION 'draft failed: %', _r; END IF;
 RETURN _v;
END $$;
CREATE FUNCTION pg_temp.file_and_approve(_v uuid) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 _r := pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', _v));
 IF _r ? 'error' THEN RETURN _r; END IF;
 RETURN pg_temp.owner(format('SELECT public.email_campaign_approve(%L::uuid)', _v));
END $$;
CREATE FUNCTION pg_temp.claim() RETURNS jsonb LANGUAGE sql AS
 $$ SELECT pg_temp.as_user(NULL, 'SELECT public.email_campaign_dispatch_claim(25)', 'service_role') $$;

-- ── 1. The new helpers are internal ─────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege(r, f, 'EXECUTE'), f||' is not executable by '||r)
  FROM unnest(ARRAY['anon','authenticated','service_role']) r,
       unnest(ARRAY['public._client_portal_customer_open(uuid,uuid)','public._email_rule_wants_portal(jsonb)',
                    'public._email_kind_needs_updates_consent(text)','public._email_campaign_rule_check(jsonb)',
                    'public._email_audience(uuid,jsonb,boolean,text)']) f;
SELECT ok(NOT has_function_privilege('authenticated','public._email_audience(uuid,jsonb,boolean)','EXECUTE')
      AND has_function_privilege('authenticated','public.email_audience_preview(jsonb,text,uuid)','EXECUTE')
      AND NOT has_function_privilege('authenticated','public.email_campaign_dispatch_claim(integer)','EXECUTE')
      AND has_function_privilege('service_role','public.email_campaign_dispatch_claim(integer)','EXECUTE'),
  'existing grants are kept: the 3-arg audience stays internal, preview owner-callable, dispatch service-only');

-- ── 2. One predicate: the campaign helper agrees with the customer's own resolver (Slice 7) ────────
SELECT is(public._client_portal_customer_open(c.tenant_id, c.id),
          pg_temp.rel(c.linked_user_id, c.tenant_id) IS NOT DISTINCT FROM c.id,
          'helper = client_portal_relationship_id for '||c.first_name)
  FROM public.clients c WHERE c.id IN (pg_temp.c(1),pg_temp.c(2),pg_temp.c(3),pg_temp.c(6),pg_temp.c(7),pg_temp.c(8),pg_temp.c(11))
 ORDER BY c.id;
SELECT ok(NOT public._client_portal_customer_open('e0c10200-0000-4000-8000-000000000001', pg_temp.c(4)),
  'an ended relationship (no login linked) is not open');
SELECT ok(NOT public._client_portal_customer_open('e0c10200-0000-4000-8000-000000000001', pg_temp.c(11)),
  'another business''s open customer is never open for this business');
UPDATE public.tenants SET status='suspended' WHERE id='e0c10200-0000-4000-8000-000000000001';
SELECT ok(NOT public._client_portal_customer_open('e0c10200-0000-4000-8000-000000000001', pg_temp.c(1))
      AND pg_temp.rel('e0c10100-0000-4000-8000-000000000002','e0c10200-0000-4000-8000-000000000001') IS NULL,
  'a suspended business: neither the helper nor the resolver admits its customer');
UPDATE public.tenants SET status='active' WHERE id='e0c10200-0000-4000-8000-000000000001';

-- ── 3. The portal audience: open-access customers of this business only ─────────────────────────
SELECT is(pg_temp.aud('{"portal":"active"}', 'standard'), 'A:ok B:ok H:ok I:ok J:ok',
  'portal audience = open-access customers; paused, ended, never-linked, inactive, merged and other-business excluded');
SELECT is(pg_temp.aud('{"portal":"anything"}', 'standard'), pg_temp.aud('{"portal":"active"}', 'standard'),
  'any non-null portal value narrows the same way (fails toward fewer)');
SELECT is(pg_temp.aud('{"portal":null}', 'standard'), pg_temp.aud('{}', 'standard'), 'portal:null is no filter');
SELECT is(pg_temp.aud('{"portal":"active","tags":["vip"]}', 'standard'), NULL, 'portal combines with the other keys (AND)');

-- ── 4. Owner Q1 at plan ─────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.aud('{}', 'standard'), 'A:ok B:ok C:ok D:ok E:ok F:ok H:ok I:ok J:ok',
  'a standard email: every contact, consent not required (unchanged)');
SELECT is(pg_temp.aud('{}', 'promotion'), 'A:ok B:no_consent C:ok D:ok E:ok F:ok H:ok I:ok J:ok',
  'a promotion: the portal-linked contact without Updates consent is left out; the never-linked one is not');
SELECT is(pg_temp.aud('{}', 'announcement'), pg_temp.aud('{}', 'promotion'), 'an announcement: the same rule');
SELECT is(pg_temp.aud('{}', 'newsletter'), 'A:ok B:no_consent C:ok D:ok E:no_consent F:ok H:ok I:ok J:ok',
  'a newsletter: consent required from everyone (unchanged)');
SELECT is(pg_temp.aud('{"portal":"active"}', 'promotion'), 'A:ok B:no_consent H:ok I:ok J:ok',
  'a promotion to the portal audience: Updates consent required');
SELECT is(pg_temp.aud('{}', 'event'), pg_temp.aud('{}', 'standard'), 'other kinds unchanged (event)');
SELECT is(pg_temp.aud3('{}'), pg_temp.aud('{}', NULL), 'the 3-argument audience (series, dashboard) = kind-less 4-argument');
SELECT is(pg_temp.aud3('{"portal":"active"}'), 'A:ok B:ok H:ok I:ok J:ok', 'the 3-argument audience applies the portal filter too');

-- ── 5. Rule keys are validated ──────────────────────────────────────────────────────────────────
CREATE TEMP TABLE v5(k text PRIMARY KEY, id uuid);
GRANT ALL ON v5 TO authenticated, service_role;
INSERT INTO v5 SELECT 'draft', (pg_temp.owner($q$SELECT public.email_campaign_create('announcement','Rule checks')$q$)->>'version_id')::uuid;
SELECT is(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_audience => '{"portal":"active"}'::jsonb))$q$, (SELECT id FROM v5 WHERE k='draft')))#>>'{}',
  (SELECT id::text FROM v5 WHERE k='draft'), 'update_draft accepts portal:"active"');
SELECT is(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_audience => '{"portal":null,"stages":["lead"]}'::jsonb))$q$, (SELECT id FROM v5 WHERE k='draft')))#>>'{}',
  (SELECT id::text FROM v5 WHERE k='draft'), 'update_draft accepts portal:null with other keys');
SELECT is(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_audience => '{"portal":"yes"}'::jsonb))$q$, (SELECT id FROM v5 WHERE k='draft')))->>'error',
  'rule_invalid', 'update_draft refuses a portal value other than "active"');
SELECT is(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_audience => '{"customers":"all"}'::jsonb))$q$, (SELECT id FROM v5 WHERE k='draft')))->>'error',
  'rule_invalid', 'update_draft refuses an unknown rule key');
SELECT is(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_audience => '{"tags":"vip"}'::jsonb))$q$, (SELECT id FROM v5 WHERE k='draft')))->>'error',
  'rule_invalid', 'update_draft refuses a malformed known key (the series checker''s rules still apply)');
SELECT is((SELECT audience FROM public.email_campaign_versions WHERE id=(SELECT id FROM v5 WHERE k='draft')),
  '{"portal":null,"stages":["lead"]}'::jsonb, 'a refused write changed nothing');
SELECT is(pg_temp.owner($q$SELECT public.email_campaign_draft('e0c10200-0000-4000-8000-000000000001', NULL, 'e0c10a00-0000-4000-8000-000000000001', 'From Paige', 'announcement', 'Hi', NULL, '<p>x</p>', '{"everyone":true}'::jsonb)$q$)->>'error',
  'rule_invalid', 'PAIGE''s draft writer (email_campaign_draft) refuses an unknown key through the same check');
SELECT is((pg_temp.owner($q$SELECT public.email_campaign_draft('e0c10200-0000-4000-8000-000000000001', NULL, 'e0c10a00-0000-4000-8000-000000000002', 'From Paige', 'announcement', 'Hi', NULL, '<p>x</p>', '{"portal":"active"}'::jsonb)$q$)->>'created')::boolean,
  true, 'PAIGE''s draft writer accepts the portal audience');
SELECT throws_ok($q$SELECT public._email_sequence_rule_check('{"portal":"active"}'::jsonb)$q$, '22023', 'rule_invalid',
  'the series checker is unchanged: a series never takes the portal key');
-- A saved segment written before validation existed is checked when a campaign freezes it.
INSERT INTO v5 SELECT 'seg', (pg_temp.owner($q$SELECT to_jsonb(public.email_segment_save(NULL,'Old segment','{"legacy_key":true}'::jsonb))$q$)#>>'{}')::uuid;
SELECT ok(pg_temp.owner(format($q$SELECT to_jsonb(public.email_campaign_update_draft(%L::uuid, p_segment_id => %L::uuid))$q$,
  (SELECT id FROM v5 WHERE k='draft'), (SELECT id FROM v5 WHERE k='seg'))) ? 'error' = false, 'a draft can point at the old segment');
UPDATE public.email_campaign_versions SET subject='Hi', body_html='<p>x</p>' WHERE id=(SELECT id FROM v5 WHERE k='draft');
SELECT is(pg_temp.owner(format('SELECT public.email_campaign_request_approval(%L::uuid)', (SELECT id FROM v5 WHERE k='draft')))->>'error',
  'rule_invalid', 'request_approval refuses to freeze a rule (here a segment''s) with an unknown key');
SELECT is((SELECT state FROM public.email_campaign_versions WHERE id=(SELECT id FROM v5 WHERE k='draft')), 'draft',
  'and nothing was frozen');

-- ── 6. The owner's preview counts what the plan would freeze ────────────────────────────────────
SELECT is(pg_temp.owner($q$SELECT public.email_audience_preview('{"portal":"active"}'::jsonb,'promotion',NULL)$q$) - 'daily_cap' - 'used_last_24h' - 'remaining_today' - 'postal_address_set',
  '{"matched":5,"eligible":4,"no_address":0,"opted_out":0,"suppressed":0,"no_consent":1}'::jsonb,
  'preview: portal audience, promotion — 5 matched, Casey left out for Updates');
SELECT is((pg_temp.owner($q$SELECT public.email_audience_preview('{}'::jsonb,'standard',NULL)$q$)->>'no_consent')::int, 0,
  'preview: a standard email asks no consent (unchanged)');
SELECT is(pg_temp.as_user('e0c10100-0000-4000-8000-000000000002', $q$SELECT public.email_audience_preview('{"portal":"active"}'::jsonb,'promotion',NULL)$q$)->>'sqlstate',
  '42501', 'a customer cannot read the business''s audience');

-- ── 7. Through the real seams: plan, approve, then the send re-proves access and consent ─────────
-- 7a. An announcement to the portal audience.
INSERT INTO v5 SELECT 'ann', pg_temp.campaign('announcement', '{"portal":"active"}', 'Spring hours');
SELECT is(pg_temp.file_and_approve((SELECT id FROM v5 WHERE k='ann'))->>'recipients', '4',
  'filed and approved: four portal customers planned');
SELECT is(pg_temp.rcpt((SELECT id FROM v5 WHERE k='ann')), 'A:planned H:planned I:planned J:planned',
  'planned at approval: Jordan, Jamie, Drew, Quinn (Casey left out for Updates)');
-- After approval: Jamie's access is paused by the owner through the one access writer; Jordan turns
-- Updates and offers off in their own portal.
SELECT ok(NOT (pg_temp.owner(format('SELECT public.set_client_portal_access(%L,%L,%L,%L,%L,NULL,%L)',
  'e0c10100-0000-4000-8000-000000000001','e0c10200-0000-4000-8000-000000000001', pg_temp.c(8), 'pause', 'client_request',
  pg_temp.owner(format('SELECT public.read_client_portal_access(%L,%L)','e0c10200-0000-4000-8000-000000000001', pg_temp.c(8)))->>'since')) ? 'error'),
  'the owner pauses Jamie after approval');
SELECT ok(NOT (pg_temp.as_user('e0c10100-0000-4000-8000-000000000002',
  $q$SELECT public.client_portal_set_communication_preference('email','newsletter',false,'e0c10200-0000-4000-8000-000000000001'::uuid)$q$) ? 'error'),
  'Jordan turns Updates and offers off after approval');
CREATE TEMP TABLE claims(n serial, r jsonb);
GRANT ALL ON claims TO authenticated, service_role;
INSERT INTO claims(r) SELECT pg_temp.claim();
SELECT is((SELECT r->'campaign'->>'version_id' FROM claims WHERE n=1), (SELECT id::text FROM v5 WHERE k='ann'), 'the worker claims the announcement');
SELECT is((SELECT string_agg(x->>'email', ',' ORDER BY x->>'email') FROM claims, jsonb_array_elements(r->'recipients') x WHERE n=1),
  'drew.c1@tests.invalid,quinn.c1@tests.invalid', 'only Drew and Quinn are handed to the sender');
SELECT is(pg_temp.rcpt((SELECT id FROM v5 WHERE k='ann')), 'A:skipped:no_consent H:skipped:contact_removed I:sending J:sending',
  'Jordan skipped for Updates withdrawn, Jamie skipped as no longer in the portal audience');

-- 7b. A promotion to a plain (non-portal) rule: Q1 still applies to the portal-linked, at plan and send.
INSERT INTO v5 SELECT 'promo', pg_temp.campaign('promotion', '{}', 'Summer offer');
SELECT is(pg_temp.file_and_approve((SELECT id FROM v5 WHERE k='promo'))->>'recipients', '7',
  'filed and approved: seven planned');
SELECT is(pg_temp.rcpt((SELECT id FROM v5 WHERE k='promo')),
  'C:planned D:planned E:planned F:planned H:planned I:planned J:planned',
  'plan: Jordan (Updates off now) and Casey (never gave it) left out; Sam (never linked) planned without consent');
SELECT ok(NOT (pg_temp.as_user('e0c10100-0000-4000-8000-000000000011',
  $q$SELECT public.client_portal_set_communication_preference('email','newsletter',false,'e0c10200-0000-4000-8000-000000000001'::uuid)$q$) ? 'error'),
  'Quinn turns Updates and offers off after approval');
UPDATE public.email_campaign_recipients SET status='sent', sent_at=now(), lease_until=NULL
 WHERE version_id=(SELECT id FROM v5 WHERE k='ann') AND status='sending';
INSERT INTO claims(r) SELECT pg_temp.claim();
SELECT is((SELECT r->'campaign'->>'version_id' FROM claims WHERE n=2), (SELECT id::text FROM v5 WHERE k='promo'), 'the worker claims the promotion');
SELECT is(pg_temp.rcpt((SELECT id FROM v5 WHERE k='promo')),
  'C:sending D:sending E:sending F:sending H:sending I:sending J:skipped:no_consent',
  'send: Quinn skipped for Updates withdrawn; a paused customer (Jamie) is NOT dropped from a plain rule');

-- 7c. A standard email: neither the portal re-check nor Q1 touches it.
INSERT INTO v5 SELECT 'std', pg_temp.campaign('standard', '{}', 'Office move');
SELECT is(pg_temp.file_and_approve((SELECT id FROM v5 WHERE k='std'))->>'recipients', '9', 'standard: all nine planned');
UPDATE public.email_campaign_recipients SET status='sent', sent_at=now(), lease_until=NULL
 WHERE version_id=(SELECT id FROM v5 WHERE k='promo') AND status='sending';
INSERT INTO claims(r) SELECT pg_temp.claim();
SELECT is((SELECT count(*)::int FROM public.email_campaign_recipients WHERE version_id=(SELECT id FROM v5 WHERE k='std') AND status='skipped'), 0,
  'standard: nobody skipped at send (Updates is not asked of a standard email)');

-- 7d. A refused caller.
SELECT is(pg_temp.as_user('e0c10100-0000-4000-8000-000000000001', 'SELECT public.email_campaign_dispatch_claim(25)')->>'sqlstate', '42501',
  'the owner''s session cannot run the sender');

-- ── 8. The editor's portal count ────────────────────────────────────────────────────────────────
SELECT is(public._email_rule_choices('e0c10200-0000-4000-8000-000000000001')->'portal', '{"open":4}'::jsonb,
  'portal count: Jordan, Casey, Drew, Quinn (Jamie paused since)');
SELECT is(public._email_rule_choices('e0c10200-0000-4000-8000-000000000002')->'portal', '{"open":1}'::jsonb,
  'another business counts only its own');
SELECT ok(public._email_rule_choices('e0c10200-0000-4000-8000-000000000001') ?& ARRAY['stages','sources','tags','portal'],
  'the existing keys are all still there');
SELECT is(pg_temp.owner('SELECT public.read_email_rule_choices()')->'portal', '{"open":4}'::jsonb,
  'the owner''s read carries it');

SELECT * FROM finish();
ROLLBACK;
