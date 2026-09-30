-- ============================================================================
-- A device's push subscription belongs to exactly one business.
--
-- Proves, for push subscriptions: the device is the person's, and each subscription records the
-- business it was registered for, so one device can hold one subscription per business; a
-- business's admins see only subscriptions registered for that business; a subscription with no
-- business (a legacy registration no business can be derived for) matches no business at all; the
-- person still manages their own subscriptions; and the business is filled, refused, validated and
-- fixed as intended.
--
-- Synthetic fixtures only. Asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(18);

-- Production grants `authenticated` these privileges; a schema replayed from migrations does not.
-- Reproduced inside the rolled-back transaction, and no wider than production.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions TO authenticated;
GRANT SELECT ON public.clients, public.tenant_members TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid), public.agency_can_manage_child(uuid),
  public.agency_team_role(uuid, uuid), public.current_user_tenant_id(), public.has_role(uuid, public.app_role),
  public.has_any_role(uuid, text[]), public.is_assigned_to_client(uuid, uuid, text),
  public.tenant_staff_owns_user(uuid, uuid), public.is_platform_admin(), public.is_platform_admin(uuid),
  public.is_platform_operator(), public.is_platform_owner(), public.is_platform_owner(uuid),
  public.is_super_admin(), public.is_super_admin(uuid)
TO authenticated;

DO $$
DECLARE
  _a uuid := 'a5530000-0000-0000-0000-00000000000a';
  _b uuid := 'a5530000-0000-0000-0000-00000000000b';
  _ada uuid := 'a5530000-0000-0000-0000-0000000000a1';  -- admin of A
  _adb uuid := 'a5530000-0000-0000-0000-0000000000b1';  -- admin of B
  _p uuid := 'a5530000-0000-0000-0000-000000000e01';    -- member of A, and a client of B
  _z uuid := 'a5530000-0000-0000-0000-000000000e03';    -- belongs to nothing
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_ada, 'ps-admin-a@example.test'), (_adb, 'ps-admin-b@example.test'),
    (_p, 'ps-person-p@example.test'), (_z, 'ps-person-z@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'ps-scope-a', 'PS Scope A', 'active', 'standalone', 'PSA', '{}'),
    (_b, 'ps-scope-b', 'PS Scope B', 'active', 'standalone', 'PSB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _ada, 'admin', 'active', false), (_b, _adb, 'admin', 'active', false),
    (_a, _p, 'member', 'active', false);
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
    (_ada, _a), (_adb, _b), (_p, _a), (_z, NULL)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('a5530000-0000-0000-0000-00000000c1e1', _b, _adb, 'P', 'Client', 'PSP-1', _p);
  -- O: a platform administrator who is a member of A but is working in B (not a member there).
  INSERT INTO auth.users (id, email) VALUES ('a5530000-0000-0000-0000-000000000e04', 'ps-operator-o@example.test');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
  VALUES (_a, 'a5530000-0000-0000-0000-000000000e04', 'member', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES ('a5530000-0000-0000-0000-000000000e04', 'platform_admin')
    ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES ('a5530000-0000-0000-0000-000000000e04', _b)
    ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
END $$;

-- S1: P registers a device while working in A. No business is named; it is filled.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-000000000e01","role":"authenticated"}', true);
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/s1', 'k', 'a');
SELECT set_config('request.jwt.claims', '', true);
-- S0: a legacy registration from before subscriptions recorded a business. It is written the way the
-- existing row was, without the checks that now apply to new registrations.
ALTER TABLE public.push_subscriptions DISABLE TRIGGER USER;
INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/s0', 'k', 'a');
ALTER TABLE public.push_subscriptions ENABLE TRIGGER USER;

-- Each person's view, read as that person and stored for assertion after RESET ROLE.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('ps.admin_b_s1', (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE '%/s1')::text, true);
  PERFORM set_config('ps.admin_b_s0', (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE '%/s0')::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('ps.admin_a_s1', (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE '%/s1')::text, true);
  PERFORM set_config('ps.admin_a_s0', (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE '%/s0')::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-000000000e01","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('ps.owner_all', (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE 'https://push.example.test/%')::text, true);
END $$;
-- The same device registered for a second business the person belongs to.
DO $$ BEGIN
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key, tenant_id)
  VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/s1', 'k', 'a',
          'a5530000-0000-0000-0000-00000000000b');
  PERFORM set_config('ps.second_business', 'ok', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ps.second_business', SQLSTATE, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 1–2. A business's admins see subscriptions registered for that business, not another's.
SELECT is(current_setting('ps.admin_b_s1')::int, 0,
  'an admin of another business does not see a subscription registered for this one');
SELECT is(current_setting('ps.admin_a_s1')::int, 1,
  'an admin sees a subscription registered for their business');
-- 3–4. A subscription with no business matches no business.
SELECT is(current_setting('ps.admin_b_s0')::int, 0,
  'a subscription with no business is visible to no business''s admin (B)');
SELECT is(current_setting('ps.admin_a_s0')::int, 0,
  'a subscription with no business is visible to no business''s admin (A)');
-- 5. The person still manages their own subscriptions.
SELECT is(current_setting('ps.owner_all')::int, 2,
  'the person sees their own subscriptions');
-- 6. One device can hold one subscription per business.
SELECT is(current_setting('ps.second_business'), 'ok',
  'the same device can be registered for a second business the person belongs to');

-- 7–8. The business is part of the subscription; nullable only for legacy registrations.
SELECT has_column('public', 'push_subscriptions', 'tenant_id', 'a subscription records its business');
SELECT col_is_null('public', 'push_subscriptions', 'tenant_id',
  'and may be empty only for a legacy registration no business can be derived for');

-- 9. S1 took the business it was registered in.
SELECT is((SELECT count(*)::int FROM public.push_subscriptions
            WHERE endpoint LIKE '%/s1' AND tenant_id = 'a5530000-0000-0000-0000-00000000000a'), 1,
  'a registration takes the business the person is working in');

-- 10. A new registration with no business to record is refused.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-000000000e03","role":"authenticated"}', true);
SELECT throws_like($q$
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
  VALUES ('a5530000-0000-0000-0000-000000000e03', 'https://push.example.test/z', 'k', 'a')$q$,
  'PUSH_TENANT_UNRESOLVED:%', 'a new registration with no business to record is refused');

-- 11. A registration for a business the person does not belong to is refused.
SELECT throws_like($q$
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key, tenant_id)
  VALUES ('a5530000-0000-0000-0000-000000000e03', 'https://push.example.test/z2', 'k', 'a',
          'a5530000-0000-0000-0000-00000000000a')$q$,
  'PUSH_SUBJECT_NOT_IN_TENANT:%', 'a registration cannot name a business the person does not belong to');
SELECT set_config('request.jwt.claims', '', true);

-- 12. The business cannot be changed after the fact.
SELECT throws_like($q$
  UPDATE public.push_subscriptions SET tenant_id = 'a5530000-0000-0000-0000-00000000000b'
   WHERE endpoint LIKE '%/s1' AND tenant_id = 'a5530000-0000-0000-0000-00000000000a'$q$,
  'PUSH_TENANT_IMMUTABLE:%', 'a subscription''s business cannot be changed');

-- 13. A legacy subscription cannot be given a business later either; the device registers again.
SELECT throws_like($q$
  UPDATE public.push_subscriptions SET tenant_id = 'a5530000-0000-0000-0000-00000000000a'
   WHERE endpoint LIKE '%/s0'$q$,
  'PUSH_TENANT_IMMUTABLE:%', 'a subscription with no business is not assigned one after the fact');

-- 14. Someone else cannot register a subscription for a person.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_like($q$
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key, tenant_id)
  VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/a1', 'k', 'a',
          'a5530000-0000-0000-0000-00000000000a')$q$,
  'PUSH_REGISTRANT_NOT_SUBJECT:%', 'only the person can register their own device');
SELECT set_config('request.jwt.claims', '', true);

-- 15. Someone working in a business they do not belong to registers for the one business they do
--     belong to, rather than being refused.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-000000000e04","role":"authenticated"}', true);
SELECT lives_ok($q$
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
  VALUES ('a5530000-0000-0000-0000-000000000e04', 'https://push.example.test/o1', 'k', 'a')$q$,
  'a person working outside their own business still registers for the business they belong to');
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT count(*)::int FROM public.push_subscriptions
            WHERE endpoint LIKE '%/o1' AND tenant_id = 'a5530000-0000-0000-0000-00000000000a'), 1,
  'and the registration is recorded for the business they belong to');

-- 17. The browser's registration, as the signed-in person, is idempotent per device and business.
SELECT set_config('request.jwt.claims', '{"sub":"a5530000-0000-0000-0000-000000000e01","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
  VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/up', 'k', 'a')
  ON CONFLICT (user_id, endpoint, tenant_id) DO UPDATE SET last_used_at = now();
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh_key, auth_key)
  VALUES ('a5530000-0000-0000-0000-000000000e01', 'https://push.example.test/up', 'k', 'a')
  ON CONFLICT (user_id, endpoint, tenant_id) DO UPDATE SET last_used_at = now();
  PERFORM set_config('ps.upsert_rows',
    (SELECT count(*) FROM public.push_subscriptions WHERE endpoint LIKE '%/up')::text, true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ps.upsert_rows', SQLSTATE, true);
END $$;
-- 18. The person cannot hand their subscription to someone else.
DO $$ BEGIN
  UPDATE public.push_subscriptions SET user_id = 'a5530000-0000-0000-0000-000000000e03'
   WHERE endpoint LIKE '%/up';
  PERFORM set_config('ps.reassign', 'ok', true);
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('ps.reassign', SQLSTATE, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);
SELECT is(current_setting('ps.upsert_rows'), '1',
  'registering the same device twice in the same business keeps one subscription');
SELECT isnt(current_setting('ps.reassign'), 'ok',
  'a person cannot reassign their subscription to someone else');

SELECT * FROM finish();
ROLLBACK;
