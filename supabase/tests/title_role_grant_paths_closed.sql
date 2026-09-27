-- ============================================================================
-- The retired title role cannot be granted, and holding it earns nothing.
--
-- Proves, for every database path that could hand out or act on the platform-wide `coach` role
-- (outside the tenant grant function, which slice 4 refuses directly): an invitation carrying the
-- role is refused; an admin cannot change someone to it; a business seat and the role no longer map
-- onto each other, so neither sync trigger can create one from the other; holding the role enrolls
-- nobody as an affiliate; and who may be assigned clients is decided by membership of the business,
-- never by the role.
--
-- Synthetic fixtures only. Asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(10);

DO $$
DECLARE
  _t uuid := 'c9940000-0000-0000-0000-00000000000a';
  _a uuid := 'c9940000-0000-0000-0000-0000000000a1';  -- admin of T
  _m uuid := 'c9940000-0000-0000-0000-0000000000a2';  -- active member of T, no retired role
  _x uuid := 'c9940000-0000-0000-0000-0000000000a3';  -- holds the retired role, not a member of T
  _i uuid := 'c9940000-0000-0000-0000-0000000000a4';  -- invitee
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_a, 'gp-admin@example.test'), (_m, 'gp-member@example.test'),
    (_x, 'gp-outsider@example.test'), (_i, 'gp-invitee@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features)
  VALUES (_t, 'gp-scope', 'GP Scope', 'active', 'standalone', 'GPS', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_t, _a, 'admin', 'active', false),
    (_t, _m, 'member', 'active', false);
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES (_a, _t)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_a, 'admin'), (_x, 'coach')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, assigned_coach_user_id)
  VALUES ('c9940000-0000-0000-0000-00000000c1e1', _t, _a, 'G', 'Client', 'GPC-1', _m);
  INSERT INTO public.invitations (email, role, invited_by, token_hash, expires_at, tenant_id)
  VALUES ('gp-invitee@example.test', 'coach', _a, encode(sha256('gp-token'::bytea), 'hex'), now() + interval '1 day', _t);
END $$;

-- 1–2. An invitation carrying the retired role is refused, and grants nothing.
SELECT set_config('request.jwt.claims', '{"sub":"c9940000-0000-0000-0000-0000000000a4","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public.accept_invitation('gp-token', 'c9940000-0000-0000-0000-0000000000a4')$q$,
  '42501', NULL, 'an invitation carrying the retired role is refused');
SELECT is((SELECT count(*)::int FROM public.user_roles
            WHERE user_id = 'c9940000-0000-0000-0000-0000000000a4' AND role = 'coach'),
  0, 'and the invitee does not hold the role');

-- 3. An admin cannot change a member to the retired role.
SELECT set_config('request.jwt.claims', '{"sub":"c9940000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public.change_user_role('c9940000-0000-0000-0000-0000000000a2', 'user', 'coach',
                                                   'c9940000-0000-0000-0000-00000000000a', NULL)$q$,
  '42501', NULL, 'an admin cannot change a member to the retired role');

-- 4–6. The role and a business seat no longer map onto each other or onto an assignment seat.
SELECT is(public.map_app_role_to_tenant_role('coach')::text, 'member',
  'the role maps to a plain membership, never a coach seat');
SELECT isnt(public.map_tenant_role_to_app_role('coach')::text, 'coach',
  'a coach seat never becomes the role');
SELECT is(public.assignment_role_for('coach'), NULL, 'the role maps to no assignment seat');

-- 7. Holding the role enrolls nobody as an affiliate.
INSERT INTO auth.users (id, email) VALUES ('c9940000-0000-0000-0000-0000000000a5', 'gp-late@example.test');
INSERT INTO public.user_roles (user_id, role) VALUES ('c9940000-0000-0000-0000-0000000000a5', 'coach');
SELECT is((SELECT count(*)::int FROM public.affiliate_profiles
            WHERE user_id = 'c9940000-0000-0000-0000-0000000000a5'),
  0, 'holding the role enrolls nobody as an affiliate');

-- 8–9. Bulk assignment is decided by membership, not the role.
SELECT lives_ok($q$SELECT public.admin_bulk_assign_coach('c9940000-0000-0000-0000-0000000000a2',
                                                       ARRAY['c9940000-0000-0000-0000-00000000c1e1']::uuid[])$q$,
  'an active member can be assigned clients without holding the role');
SELECT throws_ok($q$SELECT public.admin_bulk_assign_coach('c9940000-0000-0000-0000-0000000000a3',
                                                        ARRAY['c9940000-0000-0000-0000-00000000c1e1']::uuid[])$q$,
  '42501', NULL, 'holding the role does not make an outsider assignable');

-- 10. Reassignment is decided by membership, not the role.
SELECT throws_ok($q$SELECT public.reassign_coach_clients('c9940000-0000-0000-0000-0000000000a2',
                                                       'c9940000-0000-0000-0000-0000000000a3')$q$,
  '42501', NULL, 'clients cannot be reassigned to an outsider because they hold the role');

SELECT * FROM finish();
ROLLBACK;
