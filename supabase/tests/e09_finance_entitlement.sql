-- E09 F1a: the per-business finance entitlement (20271111030000). Full replayed schema, real
-- caller roles, the seeded Marketplace items, synthetic data only (§63: Northwind Studio and
-- friends); all rolled back.
--
-- Proves:
--   1. THE predicate _tenant_finance_entitled: install alone, flag alone, both → true; neither → false;
--      it equals the persona expression for every business in the database, and the persona itself
--      answers the same for the businesses' owners.
--   2. Grants: a signed-in user cannot call the internal predicate or the user classifier; anon
--      cannot call the item classifier or the staff wrapper.
--   3. The wrappers: staff read their own business; a customer reads only an OPEN relationship in the
--      named business; a customer with two open relationships gets false, never the resolver's 42501.
--   4. The install guard (as a business admin): every direct write that creates, re-activates, swaps,
--      moves, uninstalls or deletes a finance install is refused, including the UNLISTED finance
--      item the admin cannot even see; a non-finance install is unaffected; the real Marketplace
--      install and uninstall still work (and the uninstall still clears the flag); service role still
--      writes.
--   5. The flag guard: an admin can neither add nor strip finance_in_scope; another features key
--      still saves; the service role still writes it; the platform owner (the one browser role RLS
--      lets insert a business) can still insert one, but not one already carrying the flag.
--   6. Push defaults are off for new rows; the two notify trigger bodies forward nothing, and all
--      three triggers they back stay attached;
--      create_subaccount refuses 'funding' (22023) and still accepts another preset.
--   7. Credit rows: staff of a NON-entitled business cannot file a credit alert about its customer,
--      nor update one they can read; staff of an entitled business can do both; a portal customer cannot file a credit upload (table or
--      storage); a staff member's own upload (the Q5 path) is unchanged.
--   8. A freshly created business is not entitled.
BEGIN;
SELECT plan(66);

-- ── Seed ────────────────────────────────────────────────────────────────────────────────────────
-- Users: A-owner, B-owner (also owns B2), customer of A, customer of B, agency owner, platform owner.
INSERT INTO auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data) VALUES
 ('f1a00100-0000-4000-8000-0000000000a1','authenticated','authenticated','f1a-owner-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f1a00100-0000-4000-8000-0000000000b1','authenticated','authenticated','f1a-owner-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f1a00100-0000-4000-8000-0000000000a2','authenticated','authenticated','f1a-customer-a@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f1a00100-0000-4000-8000-0000000000b2','authenticated','authenticated','f1a-customer-b@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f1a00100-0000-4000-8000-0000000000e1','authenticated','authenticated','f1a-agency-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}'),
 ('f1a00100-0000-4000-8000-0000000000f1','authenticated','authenticated','f1a-platform-owner@tests.invalid',now(),'{"comms_provider_execution":"disabled"}');
INSERT INTO public.user_roles(user_id,role) VALUES ('f1a00100-0000-4000-8000-0000000000f1','super_admin');

-- A: not entitled. B: entitled by a real Marketplace install (below). B2: B-owner's second business.
-- C: an active finance install row and no flag. D: the flag and no install. G: an agency.
INSERT INTO public.tenants(id,slug,name,status,account_type,parent_tenant_id,features) VALUES
 ('f1a00200-0000-4000-8000-00000000000a','test-tenant-f1a-a','Northwind Studio','active','standalone',NULL,'{}'),
 ('f1a00200-0000-4000-8000-00000000000b','test-tenant-f1a-b','Harbor Lane Advisors','active','standalone',NULL,'{}'),
 ('f1a00200-0000-4000-8000-0000000000b2','test-tenant-f1a-b2','Harbor Lane Two','active','standalone',NULL,'{}'),
 ('f1a00200-0000-4000-8000-00000000000c','test-tenant-f1a-c','Cedar Row Partners','active','standalone',NULL,'{}'),
 ('f1a00200-0000-4000-8000-00000000000d','test-tenant-f1a-d','Delta Point Co','active','standalone',NULL,'{"finance_in_scope": true}'),
 ('f1a00200-0000-4000-8000-0000000000e0','test-tenant-f1a-g','Evergreen Agency','active','agency',NULL,'{}');
INSERT INTO public.tenant_members(tenant_id,user_id,role,status,is_owner,joined_at) VALUES
 ('f1a00200-0000-4000-8000-00000000000a','f1a00100-0000-4000-8000-0000000000a1','owner','active',true,now()),
 ('f1a00200-0000-4000-8000-00000000000b','f1a00100-0000-4000-8000-0000000000b1','owner','active',true,now()),
 ('f1a00200-0000-4000-8000-0000000000b2','f1a00100-0000-4000-8000-0000000000b1','owner','active',true,now()),
 ('f1a00200-0000-4000-8000-0000000000e0','f1a00100-0000-4000-8000-0000000000e1','owner','active',true,now());
UPDATE public.profiles SET active_tenant_id='f1a00200-0000-4000-8000-00000000000a' WHERE user_id='f1a00100-0000-4000-8000-0000000000a1';
UPDATE public.profiles SET active_tenant_id='f1a00200-0000-4000-8000-00000000000b' WHERE user_id='f1a00100-0000-4000-8000-0000000000b1';
INSERT INTO public.clients(id,tenant_id,linked_user_id,created_by,first_name,last_name,status) VALUES
 ('f1a00300-0000-4000-8000-0000000000a2','f1a00200-0000-4000-8000-00000000000a','f1a00100-0000-4000-8000-0000000000a2','f1a00100-0000-4000-8000-0000000000a1','Jordan','Rivera','active'),
 ('f1a00300-0000-4000-8000-0000000000b2','f1a00200-0000-4000-8000-00000000000b','f1a00100-0000-4000-8000-0000000000b2','f1a00100-0000-4000-8000-0000000000b1','Casey','Morgan','active');

-- C's install row is written as the table owner (the service path), not by a browser.
INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status)
SELECT 'f1a00200-0000-4000-8000-00000000000c', i.id,
       (SELECT v.id FROM public.marketplace_item_versions v WHERE v.item_id=i.id ORDER BY v.created_at DESC LIMIT 1), 'active'
  FROM public.marketplace_items i WHERE i.slug='funding';

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────
CREATE FUNCTION pg_temp.as_user(_actor uuid, _sql text, _role text DEFAULT 'authenticated') RETURNS jsonb
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
 PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',_actor,'role',_role)::text,true);
 IF _role='anon' THEN SET LOCAL ROLE anon;
 ELSIF _role='service_role' THEN SET LOCAL ROLE service_role;
 ELSE SET LOCAL ROLE authenticated; END IF;
 BEGIN EXECUTE _sql INTO _r;
 EXCEPTION WHEN OTHERS THEN _r:=jsonb_build_object('sqlstate',SQLSTATE,'error',SQLERRM); END;
 RESET ROLE; PERFORM set_config('request.jwt.claims','{}',true);
 RETURN _r;
END $$;
CREATE FUNCTION pg_temp.oa(_sql text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user('f1a00100-0000-4000-8000-0000000000a1', _sql) $$;
CREATE FUNCTION pg_temp.ob(_sql text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user('f1a00100-0000-4000-8000-0000000000b1', _sql) $$;
CREATE FUNCTION pg_temp.ca(_sql text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user('f1a00100-0000-4000-8000-0000000000a2', _sql) $$;
CREATE FUNCTION pg_temp.cb(_sql text) RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.as_user('f1a00100-0000-4000-8000-0000000000b2', _sql) $$;
CREATE FUNCTION pg_temp.item(_slug text) RETURNS uuid LANGUAGE sql AS $$ SELECT id FROM public.marketplace_items WHERE slug=_slug $$;
CREATE FUNCTION pg_temp.ver(_slug text) RETURNS uuid LANGUAGE sql AS $$
 SELECT v.id FROM public.marketplace_item_versions v JOIN public.marketplace_items i ON i.id=v.item_id
  WHERE i.slug=_slug ORDER BY v.created_at DESC LIMIT 1 $$;
CREATE FUNCTION pg_temp.entitled(_t text) RETURNS boolean LANGUAGE sql AS $$ SELECT public._tenant_finance_entitled(_t::uuid) $$;

-- ── 1. The real Marketplace install makes B entitled (install + flag) ───────────────────────────
SELECT is(pg_temp.ob($q$SELECT public.install_marketplace_item('f1a00200-0000-4000-8000-00000000000b','funding',NULL,NULL)->'ok'$q$),
  'true'::jsonb, 'the Marketplace install RPC still installs the funding item for a business admin (through the guard)');

-- ── 2. THE predicate ────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000a'), false, 'neither install nor flag → not entitled');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000c'), true,  'an active finance install alone → entitled');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000d'), true,  'the flag alone → entitled');
SELECT is((SELECT features->>'finance_in_scope' FROM public.tenants WHERE id='f1a00200-0000-4000-8000-00000000000b'), 'true',
  'the install set the flag as well (B holds both legs)');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000b'), true,  'install and flag → entitled');
SELECT is(public._tenant_finance_entitled(NULL), false, 'no business → not entitled');
SELECT is(
  (SELECT count(*)::int FROM public.tenants t
    WHERE public._tenant_finance_entitled(t.id) IS DISTINCT FROM COALESCE(
      EXISTS (SELECT 1 FROM public.marketplace_installs mi JOIN public.marketplace_items it ON it.id = mi.item_id
               WHERE mi.tenant_id = t.id AND mi.status = 'active' AND it.is_finance = true)
      OR (t.features ->> 'finance_in_scope')::boolean, false)),
  0, 'the predicate equals the persona expression for every business in the database');
SELECT is(pg_temp.ob($q$SELECT to_jsonb((SELECT funding_enabled FROM public.get_paige_persona_context()))$q$), 'true'::jsonb,
  'the persona resolver answers funding_enabled=true for the entitled business''s owner');
SELECT is(pg_temp.oa($q$SELECT to_jsonb((SELECT funding_enabled FROM public.get_paige_persona_context()))$q$), 'false'::jsonb,
  'the persona resolver answers funding_enabled=false for the non-entitled business''s owner');

-- ── 3. Grants ───────────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.oa($q$SELECT to_jsonb(public._tenant_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$)->>'sqlstate',
  '42501', 'a signed-in user cannot call the internal predicate');
SELECT is(pg_temp.oa($q$SELECT to_jsonb(public._user_is_portal_customer_only('f1a00100-0000-4000-8000-0000000000a2'))$q$)->>'sqlstate',
  '42501', 'a signed-in user cannot classify another login');
SELECT is(pg_temp.as_user(NULL, $q$SELECT to_jsonb(public._marketplace_item_is_finance(gen_random_uuid()))$q$, 'anon')->>'sqlstate',
  '42501', 'anon cannot call the item classifier');
SELECT is(pg_temp.as_user(NULL, $q$SELECT to_jsonb(public.current_tenant_finance_entitled())$q$, 'anon')->>'sqlstate',
  '42501', 'anon cannot call the staff wrapper');
SELECT is(pg_temp.as_user(NULL, $q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$, 'anon')->>'sqlstate',
  '42501', 'anon cannot call the customer wrapper');

-- ── 4. The wrappers ─────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.ob($q$SELECT to_jsonb(public.current_tenant_finance_entitled())$q$), 'true'::jsonb,  'staff of the entitled business read true');
SELECT is(pg_temp.oa($q$SELECT to_jsonb(public.current_tenant_finance_entitled())$q$), 'false'::jsonb, 'staff of a non-entitled business read false');
SELECT is(pg_temp.cb($q$SELECT to_jsonb(public.current_tenant_finance_entitled())$q$), 'false'::jsonb, 'a portal customer holds no seat, so the staff wrapper reads false');
SELECT is(pg_temp.cb($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$), 'true'::jsonb,
  'a customer of the entitled business, with open access, reads true');
SELECT is(pg_temp.ca($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000a'))$q$), 'false'::jsonb,
  'a customer of a non-entitled business reads false');
SELECT is(pg_temp.ca($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$), 'false'::jsonb,
  'a customer naming a business they are not a customer of reads false');
SELECT is(pg_temp.ob($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$), 'false'::jsonb,
  'staff holding no customer relationship read false from the customer wrapper');
SELECT set_config('paige.portal_access_write','1',true);
UPDATE public.clients SET portal_access_state='paused',portal_access_reason='other',portal_access_changed_at=clock_timestamp()
 WHERE id='f1a00300-0000-4000-8000-0000000000b2';
SELECT is(pg_temp.cb($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$), 'false'::jsonb,
  'a paused customer of the entitled business reads false');
UPDATE public.clients SET portal_access_state='open',portal_access_reason=NULL,portal_access_changed_at=clock_timestamp()
 WHERE id='f1a00300-0000-4000-8000-0000000000b2';
SELECT set_config('paige.portal_access_write','',true);
-- (the several-relationships case runs last: it stands the resolver in for a raising one)

-- ── 5. The install guard ────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.oa(format($q$WITH w AS (INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status)
  VALUES ('f1a00200-0000-4000-8000-00000000000a',%L,%L,'active') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$,
  pg_temp.item('funding'), pg_temp.ver('funding')))->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot insert an active install of the listed finance item');
SELECT is(pg_temp.oa($q$SELECT to_jsonb(count(*)) FROM public.marketplace_items WHERE slug='funding_coach'$q$), '0'::jsonb,
  'the unlisted finance item is invisible to that admin');
SELECT is(pg_temp.oa(format($q$WITH w AS (INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status)
  VALUES ('f1a00200-0000-4000-8000-00000000000a',%L,%L,'active') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$,
  pg_temp.item('funding_coach'), pg_temp.ver('funding_coach')))->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot insert an install of the UNLISTED finance item either');
SELECT is(pg_temp.ob(format($q$WITH w AS (INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status)
  VALUES ('f1a00200-0000-4000-8000-0000000000b2',%L,%L,'active') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$,
  pg_temp.item('renewals_and_offboarding'), pg_temp.ver('renewals_and_offboarding'))), '1'::jsonb,
  'a non-finance install still inserts directly');
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.marketplace_installs SET status='uninstalled'
  WHERE tenant_id='f1a00200-0000-4000-8000-00000000000b' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='funding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$)->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot uninstall a finance install directly (skipping teardown)');
SELECT is(pg_temp.ob($q$WITH w AS (DELETE FROM public.marketplace_installs
  WHERE tenant_id='f1a00200-0000-4000-8000-00000000000b' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='funding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$)->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot delete a finance install');
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.marketplace_installs SET tenant_id='f1a00200-0000-4000-8000-0000000000b2'
  WHERE tenant_id='f1a00200-0000-4000-8000-00000000000b' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='funding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$)->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot move a finance install to another business they administer');
SELECT is(pg_temp.ob(format($q$WITH w AS (UPDATE public.marketplace_installs SET item_id=%L, version_id=%L
  WHERE tenant_id='f1a00200-0000-4000-8000-0000000000b2' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='renewals_and_offboarding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$, pg_temp.item('funding'), pg_temp.ver('funding')))->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot swap a non-finance install into a finance item');
INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status,uninstalled_at)
  VALUES ('f1a00200-0000-4000-8000-0000000000b2', pg_temp.item('funding'), pg_temp.ver('funding'), 'uninstalled', now());
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.marketplace_installs SET status='active', uninstalled_at=NULL
  WHERE tenant_id='f1a00200-0000-4000-8000-0000000000b2' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='funding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$)->>'error', 'FINANCE_INSTALL_REQUIRES_MARKETPLACE',
  'an admin cannot re-activate an uninstalled finance install');
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.marketplace_installs SET status='uninstalled', uninstalled_at=now()
  WHERE tenant_id='f1a00200-0000-4000-8000-0000000000b2' AND item_id=(SELECT id FROM public.marketplace_items WHERE slug='renewals_and_offboarding') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$), '1'::jsonb,
  'a non-finance install still updates directly');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-0000000000b2'), false, 'none of the refused writes made B2 entitled');
SELECT is(pg_temp.as_user(NULL, format($q$WITH w AS (INSERT INTO public.marketplace_installs(tenant_id,item_id,version_id,status)
  VALUES ('f1a00200-0000-4000-8000-0000000000e0',%L,%L,'uninstalled') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$,
  pg_temp.item('funding'), pg_temp.ver('funding')), 'service_role'), '1'::jsonb,
  'the service role (stripe-webhook, marketplace-install) still writes a finance install row');

-- ── 6. The flag guard ───────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.oa($q$WITH w AS (UPDATE public.tenants SET features = features || '{"finance_in_scope": true}'::jsonb
  WHERE id='f1a00200-0000-4000-8000-00000000000a' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'error',
  'FINANCE_FLAG_REQUIRES_MARKETPLACE', 'an admin cannot set finance_in_scope on their own business');
SELECT is(pg_temp.oa($q$WITH w AS (UPDATE public.tenants SET features = features || '{"finance_in_scope": "true"}'::jsonb
  WHERE id='f1a00200-0000-4000-8000-00000000000a' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'error',
  'FINANCE_FLAG_REQUIRES_MARKETPLACE', '...nor as the string "true"');
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.tenants SET features = features - 'finance_in_scope'
  WHERE id='f1a00200-0000-4000-8000-00000000000b' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'error',
  'FINANCE_FLAG_REQUIRES_MARKETPLACE', 'an admin cannot strip the flag directly either (the Marketplace uninstall does)');
SELECT is(pg_temp.oa($q$WITH w AS (UPDATE public.tenants SET features = features || '{"f1a_probe": 1}'::jsonb
  WHERE id='f1a00200-0000-4000-8000-00000000000a' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$), '1'::jsonb,
  'an admin still saves another features key');
SELECT is((SELECT features->>'f1a_probe' FROM public.tenants WHERE id='f1a00200-0000-4000-8000-00000000000a'), '1',
  '...and it persisted');
SELECT is(pg_temp.as_user(NULL, $q$WITH w AS (UPDATE public.tenants SET features = features || '{"finance_in_scope": false}'::jsonb
  WHERE id='f1a00200-0000-4000-8000-00000000000d' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$, 'service_role'), '1'::jsonb,
  'the service role still writes the flag');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000d'), false, '...and the predicate follows it');
-- INSERT: RLS lets only the platform owner insert a business from the browser ("Platform owner
-- manages tenants"), so the control proves the refusal below is the guard and not RLS.
SELECT is(pg_temp.as_user('f1a00100-0000-4000-8000-0000000000f1', $q$WITH w AS (INSERT INTO public.tenants(id,slug,name,status,account_type,features)
  VALUES ('f1a00200-0000-4000-8000-0000000000f2','test-tenant-f1a-po','Juniper Works','active','standalone','{"f1a_probe": 1}') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$), '1'::jsonb,
  'the platform owner still inserts a business from the browser');
SELECT is(pg_temp.as_user('f1a00100-0000-4000-8000-0000000000f1', $q$WITH w AS (INSERT INTO public.tenants(id,slug,name,status,account_type,features)
  VALUES ('f1a00200-0000-4000-8000-0000000000f3','test-tenant-f1a-po2','Juniper Works Two','active','standalone','{"finance_in_scope": true}') RETURNING 1)
  SELECT to_jsonb(count(*)) FROM w$q$)->>'error', 'FINANCE_FLAG_REQUIRES_MARKETPLACE',
  '...but not one that already carries finance_in_scope');

-- The real Marketplace uninstall still tears down and clears the flag.
SELECT is(pg_temp.ob($q$SELECT public.uninstall_marketplace_item('f1a00200-0000-4000-8000-00000000000b','funding')->'ok'$q$),
  'true'::jsonb, 'the Marketplace uninstall RPC still works for a business admin (through the guard)');
SELECT is((SELECT (features ? 'finance_in_scope') FROM public.tenants WHERE id='f1a00200-0000-4000-8000-00000000000b'), false,
  '...its teardown clears finance_in_scope');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-00000000000b'), false, '...and B is no longer entitled');
SELECT is(pg_temp.ob($q$SELECT public.install_marketplace_item('f1a00200-0000-4000-8000-00000000000b','funding',NULL,NULL)->'ok'$q$),
  'true'::jsonb, 'the Marketplace re-install still works');

-- ── 7. Defaults, retired triggers, starter presets ──────────────────────────────────────────────
SELECT is((SELECT count(*)::int FROM information_schema.columns
  WHERE table_schema='public' AND table_name='push_notification_preferences'
    AND column_name IN ('notify_dispute_updates','notify_funding_matches','notify_credit_score_changes')
    AND column_default='false'), 3, 'the three credit/funding push categories default to off');
INSERT INTO public.push_notification_preferences(user_id) VALUES ('f1a00100-0000-4000-8000-0000000000a1');
SELECT is((SELECT ARRAY[notify_dispute_updates, notify_funding_matches, notify_credit_score_changes, notify_task_reminders]
  FROM public.push_notification_preferences WHERE user_id='f1a00100-0000-4000-8000-0000000000a1'),
  ARRAY[false,false,false,true], 'a new preference row is off for credit/funding and unchanged for task reminders');
SELECT is((SELECT count(*)::int FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname IN ('notify_credit_alert_inserted','notify_new_funding_match')
    AND p.prosrc !~* '(http_post|_internal_secrets|service_role_key)' AND NOT p.prosecdef), 2,
  'neither legacy notify trigger body reads a key or posts anywhere, and neither runs as definer');
SELECT is((SELECT count(*)::int FROM pg_trigger WHERE NOT tgisinternal
  AND tgname IN ('trg_notify_credit_alert_inserted','trg_funding_matches_notify','trg_user_funding_matches_notify')), 3,
  'all three triggers they back are still attached (notify_new_funding_match backs two)');
SELECT throws_ok($q$SELECT public.create_subaccount('Evergreen Funding Sub', NULL, NULL,
  'f1a00200-0000-4000-8000-0000000000e0'::uuid, 'f1a00100-0000-4000-8000-0000000000e1'::uuid, 'funding', true)$q$,
  '22023', NULL, 'create_subaccount refuses funding as a starter preset');
SELECT lives_ok($q$SELECT public.create_subaccount('Evergreen Consulting Sub', NULL, NULL,
  'f1a00200-0000-4000-8000-0000000000e0'::uuid, 'f1a00100-0000-4000-8000-0000000000e1'::uuid, 'consultant', true)$q$,
  'create_subaccount still accepts another starter preset');

-- ── 8. Credit rows ──────────────────────────────────────────────────────────────────────────────
SELECT is(pg_temp.oa($q$WITH w AS (INSERT INTO public.credit_alerts(client_id,alert_type,alert_severity,alert_title,alert_description)
  VALUES ('f1a00100-0000-4000-8000-0000000000a2','score_change','informational','Probe','Synthetic probe') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'sqlstate',
  '42501', 'staff of a NON-entitled business cannot file a credit alert about its customer');
SELECT is(pg_temp.ob($q$WITH w AS (INSERT INTO public.credit_alerts(client_id,alert_type,alert_severity,alert_title,alert_description)
  VALUES ('f1a00100-0000-4000-8000-0000000000b2','score_change','informational','Probe','Synthetic probe') RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$),
  '1'::jsonb, 'staff of the entitled business still can');
SELECT is(pg_temp.ob($q$WITH w AS (UPDATE public.credit_alerts SET is_read=true
  WHERE client_id='f1a00100-0000-4000-8000-0000000000b2' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$),
  '1'::jsonb, '...and still update it');
-- An alert about A's customer, written as the table owner (the service path). A's staff can read it
-- (the read policy is unchanged), so a zero-row update is the update policy refusing, not RLS hiding.
INSERT INTO public.credit_alerts(client_id,alert_type,alert_severity,alert_title,alert_description)
  VALUES ('f1a00100-0000-4000-8000-0000000000a2','score_change','informational','Probe','Synthetic probe');
SELECT is(pg_temp.oa($q$SELECT to_jsonb(count(*)) FROM public.credit_alerts WHERE client_id='f1a00100-0000-4000-8000-0000000000a2'$q$),
  '1'::jsonb, 'staff of a NON-entitled business still read the alert about their customer');
SELECT is(pg_temp.oa($q$WITH w AS (UPDATE public.credit_alerts SET is_read=true
  WHERE client_id='f1a00100-0000-4000-8000-0000000000a2' RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$),
  '0'::jsonb, '...but cannot update it');
SELECT is(pg_temp.ca($q$WITH w AS (INSERT INTO public.credit_report_uploads(user_id,uploaded_by,file_name,file_path)
  VALUES ('f1a00100-0000-4000-8000-0000000000a2','f1a00100-0000-4000-8000-0000000000a2','r.pdf','f1a00100-0000-4000-8000-0000000000a2/r.pdf')
  RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'sqlstate', '42501',
  'a portal customer cannot file a credit upload record');
SELECT is(pg_temp.ca($q$WITH w AS (INSERT INTO storage.objects(bucket_id,name,owner,metadata)
  VALUES ('credit-report-uploads','f1a00100-0000-4000-8000-0000000000a2/r.pdf','f1a00100-0000-4000-8000-0000000000a2','{"size":1}')
  RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$)->>'sqlstate', '42501',
  'a portal customer cannot put a file in the credit-report bucket');
SELECT is(pg_temp.oa($q$WITH w AS (INSERT INTO public.credit_report_uploads(user_id,uploaded_by,file_name,file_path)
  VALUES ('f1a00100-0000-4000-8000-0000000000a1','f1a00100-0000-4000-8000-0000000000a1','s.pdf','f1a00100-0000-4000-8000-0000000000a1/s.pdf')
  RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$), '1'::jsonb,
  'a staff member of a NON-entitled business still files their own upload record (Q5 untouched)');
SELECT is(pg_temp.oa($q$WITH w AS (INSERT INTO storage.objects(bucket_id,name,owner,metadata)
  VALUES ('credit-report-uploads','f1a00100-0000-4000-8000-0000000000a1/s.pdf','f1a00100-0000-4000-8000-0000000000a1','{"size":1}')
  RETURNING 1) SELECT to_jsonb(count(*)) FROM w$q$), '1'::jsonb,
  '...and their own file');

-- ── 9. A freshly created business is not entitled ───────────────────────────────────────────────
INSERT INTO public.tenants(id,slug,name,status,account_type) VALUES
 ('f1a00200-0000-4000-8000-0000000000f0','test-tenant-f1a-fresh','Fresh Solo Co','active','standalone');
SELECT is(pg_temp.entitled('f1a00200-0000-4000-8000-0000000000f0'), false, 'a newly created business is not finance-entitled');

-- ── 10. The customer wrapper never raises the resolver's 42501 ──────────────────────────────────
-- Several open relationships make Slice 7's resolver raise 42501 (it refuses to pick one). Today's
-- constraints (one business per linked login, one row per business and login) keep that from
-- happening, so the resolver is stood in for, inside this rolled-back transaction only, by one that
-- raises exactly that error: the wrapper must answer false rather than raise to the page.
CREATE OR REPLACE FUNCTION public.client_portal_relationship_id(p_tenant_id uuid DEFAULT NULL::uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $f$
BEGIN RAISE EXCEPTION 'select an authorized customer relationship' USING ERRCODE = '42501'; END $f$;
SELECT is(pg_temp.cb($q$SELECT to_jsonb(public.client_portal_relationship_id('f1a00200-0000-4000-8000-00000000000b'))$q$)->>'sqlstate', '42501',
  'with several open relationships the resolver raises 42501');
SELECT is(pg_temp.cb($q$SELECT to_jsonb(public.client_portal_finance_entitled('f1a00200-0000-4000-8000-00000000000b'))$q$), 'false'::jsonb,
  '...and the customer wrapper answers false instead of raising');

SELECT * FROM finish();
ROLLBACK;
