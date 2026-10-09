-- INT-345 K-3 — the calling block of tenant_comms_readiness() mirrors the canonical
-- classifier (voice-access-token/authorization.ts) EXACTLY. These assertions pin the
-- mirror to the classifier's fixture semantics so the SQL and the token seam cannot
-- drift silently: same vocabulary, same decision order, same four facts.
--
-- Synthetic fixtures only (S-alias tenants, AC/SK/PN test-shaped identifiers).
-- Always rolled back. pgTAP runs in a transaction, which is also what makes the
-- multiple-primary fixture possible at all: the partial unique index is dropped INSIDE
-- the rolled-back transaction so the classifier's unreachable-state guard can be
-- exercised against real rows.
BEGIN;

SELECT plan(21);

-- ── Grant surface (§59) ──
SELECT ok(
  NOT has_function_privilege('anon', 'public.tenant_comms_readiness()', 'EXECUTE'),
  'anonymous callers cannot execute the readiness record'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.tenant_comms_readiness()', 'EXECUTE'),
  'authenticated callers can reach the readiness record'
);
SELECT ok(
  has_function_privilege('service_role', 'public.tenant_comms_readiness()', 'EXECUTE'),
  'the service-role path stays open for the Systems Check runners'
);

-- ── Fixtures: one owner per scenario tenant, each with a global admin role (the
--    resolver's in-body gate admits admin/coach or platform operator). IDs are
--    unique valid hex per role: 1=ready 2=nosub 3=noprim 4=multi 5=wrong 6=novoice
--    7=bystander 8=member. ──
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('c1000000-0000-0000-0000-000000002001', 'authenticated', 'authenticated', 'int345-nosub@tests.invalid'),
  ('c1000000-0000-0000-0000-000000001001', 'authenticated', 'authenticated', 'int345-ready@tests.invalid'),
  ('c1000000-0000-0000-0000-000000003001', 'authenticated', 'authenticated', 'int345-noprimary@tests.invalid'),
  ('c1000000-0000-0000-0000-000000004001', 'authenticated', 'authenticated', 'int345-multi@tests.invalid'),
  ('c1000000-0000-0000-0000-000000005001', 'authenticated', 'authenticated', 'int345-wrongsub@tests.invalid'),
  ('c1000000-0000-0000-0000-000000006001', 'authenticated', 'authenticated', 'int345-novoice@tests.invalid'),
  ('c1000000-0000-0000-0000-000000007001', 'authenticated', 'authenticated', 'int345-bystander@tests.invalid'),
  ('c1000000-0000-0000-0000-000000008001', 'authenticated', 'authenticated', 'int345-member@tests.invalid');

INSERT INTO public.tenants
  (id, slug, name, status, account_type, account_number_prefix, account_number, features)
VALUES
  ('c1000000-0000-0000-0000-000000002111', 'int345-nosub',  'INT345 NoSub',  'active', 'standalone', 'INS', 8600001, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000001111', 'int345-ready',  'INT345 Ready',  'active', 'standalone', 'INS', 8600002, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000003111', 'int345-noprim', 'INT345 NoPrim', 'active', 'standalone', 'INS', 8600003, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000004111', 'int345-multi',  'INT345 Multi',  'active', 'standalone', 'INS', 8600004, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000005111', 'int345-wrong',  'INT345 Wrong',  'active', 'standalone', 'INS', 8600005, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000006111', 'int345-novoice','INT345 NoVoice','active', 'standalone', 'INS', 8600006, '{}'::jsonb),
  ('c1000000-0000-0000-0000-000000007111', 'int345-by',     'INT345 By',     'active', 'standalone', 'INS', 8600007, '{}'::jsonb);

-- Seats first, pointer after (trg_guard_active_tenant).
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('c1000000-0000-0000-0000-000000002111', 'c1000000-0000-0000-0000-000000002001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000001111', 'c1000000-0000-0000-0000-000000001001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000003111', 'c1000000-0000-0000-0000-000000003001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000004111', 'c1000000-0000-0000-0000-000000004001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000005111', 'c1000000-0000-0000-0000-000000005001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000006111', 'c1000000-0000-0000-0000-000000006001', 'owner', 'active', true, now()),
  ('c1000000-0000-0000-0000-000000007111', 'c1000000-0000-0000-0000-000000007001', 'owner', 'active', true, now()),
  -- a plain MEMBER on the Ready tenant: the role gate must refuse them.
  ('c1000000-0000-0000-0000-000000001111', 'c1000000-0000-0000-0000-000000008001', 'member', 'active', false, now());

INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('c1000000-0000-0000-0000-000000002001', 'c1000000-0000-0000-0000-000000002111'),
  ('c1000000-0000-0000-0000-000000001001', 'c1000000-0000-0000-0000-000000001111'),
  ('c1000000-0000-0000-0000-000000003001', 'c1000000-0000-0000-0000-000000003111'),
  ('c1000000-0000-0000-0000-000000004001', 'c1000000-0000-0000-0000-000000004111'),
  ('c1000000-0000-0000-0000-000000005001', 'c1000000-0000-0000-0000-000000005111'),
  ('c1000000-0000-0000-0000-000000006001', 'c1000000-0000-0000-0000-000000006111'),
  ('c1000000-0000-0000-0000-000000007001', 'c1000000-0000-0000-0000-000000007111'),
  ('c1000000-0000-0000-0000-000000008001', 'c1000000-0000-0000-0000-000000001111')
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

-- The resolver's gate: is_platform_operator OR has_any_role(uid,[admin,coach]) — the
-- owner seat alone does NOT satisfy it (it checks user_roles). Seed a plain admin role
-- per scenario caller (no-JWT postgres context; claims cleared per §53 discipline).
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('c1000000-0000-0000-0000-000000002001', 'admin'),
  ('c1000000-0000-0000-0000-000000001001', 'admin'),
  ('c1000000-0000-0000-0000-000000003001', 'admin'),
  ('c1000000-0000-0000-0000-000000004001', 'admin'),
  ('c1000000-0000-0000-0000-000000005001', 'admin'),
  ('c1000000-0000-0000-0000-000000006001', 'admin'),
  ('c1000000-0000-0000-0000-000000007001', 'admin');

-- Bystander subaccount (gives the WrongSub fixture a DIFFERENT subaccount to point at).
INSERT INTO public.tenant_twilio_subaccounts
  (tenant_id, twilio_subaccount_sid, api_key_sid, auth_token_vault_ref, friendly_name, status, active)
VALUES
  ('c1000000-0000-0000-0000-000000007111', 'ACbystander000000000000000000001', 'SKbystander0000000000001',
   'twilio_subaccount_api_key_secret:bystander', 'INT345 bystander', 'active', true);

-- Scenario subaccount rows (all but NoSub).
INSERT INTO public.tenant_twilio_subaccounts
  (tenant_id, twilio_subaccount_sid, api_key_sid, auth_token_vault_ref, friendly_name, status, active, twiml_app_sid)
VALUES
  ('c1000000-0000-0000-0000-000000001111', 'ACready0000000000000000000000001', 'SKready000000000000000001',
   'twilio_subaccount_api_key_secret:ready', 'INT345 ready', 'active', true, 'APready0000000000000000000001'),
  ('c1000000-0000-0000-0000-000000003111', 'ACnoprim000000000000000000000001', 'SKnoprim000000000000000001',
   'twilio_subaccount_api_key_secret:noprim', 'INT345 noprim', 'active', true, NULL),
  ('c1000000-0000-0000-0000-000000004111', 'ACmulti0000000000000000000000001', 'SKmulti000000000000000001',
   'twilio_subaccount_api_key_secret:multi', 'INT345 multi', 'active', true, NULL),
  ('c1000000-0000-0000-0000-000000005111', 'ACwrong0000000000000000000000001', 'SKwrong000000000000000001',
   'twilio_subaccount_api_key_secret:wrong', 'INT345 wrong', 'active', true, NULL),
  ('c1000000-0000-0000-0000-000000006111', 'ACnovoice000000000000000000000001', 'SKnovoice000000000000000001',
   'twilio_subaccount_api_key_secret:novoice', 'INT345 novoice', 'active', true, NULL);

-- Scenario numbers. The partial unique index (one primary per tenant) is dropped ONLY
-- inside this rolled-back transaction so the classifier's unreachable double-primary
-- guard can be exercised against real rows; CI restores it on rollback.
DROP INDEX public.uq_tenant_phone_numbers_primary;

INSERT INTO public.tenant_phone_numbers
  (tenant_id, phone_number, twilio_sid, capabilities, status, is_primary, subaccount_id, source, purchased_at)
VALUES
  -- READY: exactly one qualified primary.
  ('c1000000-0000-0000-0000-000000001111', '+15550000001', 'PNint345ready0000000000000001',
   '{"voice": true, "sms": false}'::jsonb, 'active', true,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000001111'), 'marketplace', now()),
  -- NoPrim: a non-primary number only (the buy-then-choose gap is a REAL state).
  ('c1000000-0000-0000-0000-000000003111', '+15550000002', 'PNint345noprim0000000000000001',
   '{"voice": true}'::jsonb, 'active', false,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000003111'), 'marketplace', now()),
  -- Multi: two primaries (unreachable in production; the guard must still classify it).
  ('c1000000-0000-0000-0000-000000004111', '+15550000003', 'PNint345multi0000000000000001',
   '{"voice": true}'::jsonb, 'active', true,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000004111'), 'marketplace', now()),
  ('c1000000-0000-0000-0000-000000004111', '+15550000004', 'PNint345multi0000000000000002',
   '{"voice": true}'::jsonb, 'active', true,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000004111'), 'marketplace', now()),
  -- WrongSub: primary bound to ANOTHER tenant's subaccount.
  ('c1000000-0000-0000-0000-000000005111', '+15550000005', 'PNint345wrong0000000000000001',
   '{"voice": true}'::jsonb, 'active', true,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000007111'), 'marketplace', now()),
  -- NoVoice: primary without voice capability (and, for the binding fact, no SID).
  ('c1000000-0000-0000-0000-000000006111', '+15550000006', NULL,
   '{"voice": false}'::jsonb, 'active', true,
   (SELECT id FROM public.tenant_twilio_subaccounts WHERE tenant_id = 'c1000000-0000-0000-0000-000000006111'), 'marketplace', now());

-- Helper: act as a fixture user and read the calling block.
CREATE OR REPLACE FUNCTION pg_temp.as_calling(p_user uuid, p_key text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE claims jsonb; v jsonb;
BEGIN
  claims := jsonb_build_object('sub', p_user::text, 'role', 'authenticated');
  PERFORM set_config('request.jwt.claims', claims::text, true);
  SELECT public.tenant_comms_readiness() -> 'calling' INTO v;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN coalesce(v ->> p_key, '<null>');
END $$;

-- ── The mirror assertions (classifier fixture semantics, same order) ──
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000002001'::uuid, 'code'), 'calling_not_configured',
  'Fixture C — no subaccount row → calling_not_configured');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000002001'::uuid, 'account'), 'absent',
  'Fixture C — account fact: absent');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000001001'::uuid, 'code'), 'calling_ready',
  'Fixture A — qualified primary → calling_ready');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000001001'::uuid, 'ready'), 'true',
  'Fixture A — ready fact true');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000001001'::uuid, 'account'), 'configured',
  'Fixture A — account fact: configured');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000001001'::uuid, 'primary_selected'), 'true',
  'Fixture A — primary_selected true');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000001001'::uuid, 'twiml_app'), 'configured',
  'Fixture A — twiml_app fact: configured');

SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000003001'::uuid, 'reason_code'), 'no_active_primary_number',
  'Fixture B1 — zero primaries → no_active_primary_number');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000003001'::uuid, 'number_assigned'), 'true',
  'Fixture B1 — number fact: a number IS owned (buy ≠ choose)');
SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000003001'::uuid, 'primary_selected'), 'false',
  'Fixture B1 — primary_selected false');

SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000004001'::uuid, 'reason_code'), 'multiple_active_primary_numbers',
  'Fixture B2 — two primaries → multiple_active_primary_numbers (unreachable in prod; guard verified)');

SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000005001'::uuid, 'reason_code'), 'primary_number_under_different_subaccount',
  'Fixture B3 — primary under another subaccount → primary_number_under_different_subaccount');

SELECT is(pg_temp.as_calling('c1000000-0000-0000-0000-000000006001'::uuid, 'reason_code'), 'primary_number_missing_provider_binding',
  'Fixture B4 — no twilio_sid on the primary → primary_number_missing_provider_binding (checked before voice, same as the classifier)');

-- ── Role gate: a plain member (no admin/coach role, not staff) is refused ──
SELECT throws_ok(
  $$ SELECT pg_temp.as_calling('c1000000-0000-0000-0000-000000008001'::uuid, 'code') $$,
  '42501',
  'a plain member cannot read the readiness record'
);

-- ── The additive contract: existing keys still present alongside calling ──
SELECT set_config('request.jwt.claims', jsonb_build_object('sub', 'c1000000-0000-0000-0000-000000001001', 'role', 'authenticated')::text, true);
SELECT has(public.tenant_comms_readiness(), 'can_send_sms', 'existing can_send_sms key preserved');
SELECT has(public.tenant_comms_readiness(), 'subaccount', 'existing subaccount key preserved');
SELECT has(public.tenant_comms_readiness(), 'calling', 'the new calling key present');
SELECT performs_ok('SELECT public.tenant_comms_readiness()', 400, 'readiness stays fast (<400ms)');
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
