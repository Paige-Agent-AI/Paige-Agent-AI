-- ============================================================================
-- The retired title role is a value no row may hold.
--
-- "Coach" is a title a business gives its people, never a role. Every column that stores a platform
-- role or a business seat refuses the value, and the tenant grant function refuses it by name. The
-- platform-role constraint is NOT VALID until the four legacy rows are deleted (slice 5), so it
-- refuses every new write while those rows still exist; every other column holds no such row and is
-- validated now.
--
-- Synthetic fixtures only. Asserts refusals and catalogue facts, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(17);

-- 1–10. Every role and seat column carries the constraint.
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.user_roles'::regclass
                    AND conname = 'user_roles_role_not_retired_title_role'),
  'platform roles refuse the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.invitations'::regclass
                    AND conname = 'invitations_role_not_retired_title_role'),
  'invitations refuse the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.platform_invites'::regclass
                    AND conname = 'platform_invites_role_not_retired_title_role'),
  'platform invitations refuse the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenant_members'::regclass
                    AND conname = 'tenant_members_role_not_retired_title_role'),
  'business seats refuse the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.tenant_invite_tokens'::regclass
                    AND conname = 'tenant_invite_tokens_default_role_not_retired_title_role'),
  'invite links refuse the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.paige_approval_policies'::regclass
                    AND conname = 'paige_approval_policies_auto_assign_role_not_retired_title_role'),
  'approval auto-assignment refuses the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.paige_approval_policies'::regclass
                    AND conname = 'paige_approval_policies_requires_role_not_retired_title_role'),
  'approval policies cannot require the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.paige_approval_policies'::regclass
                    AND conname = 'paige_approval_policies_visible_to_roles_not_retired_title_role'),
  'approval visibility cannot name the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.paige_pending_approvals'::regclass
                    AND conname = 'paige_pending_approvals_requires_role_not_retired_title_role'),
  'pending approvals cannot require the value');
SELECT ok(EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.paige_pending_approvals'::regclass
                    AND conname = 'paige_pending_approvals_visible_to_roles_not_retired_title_role'),
  'pending approval visibility cannot name the value');

-- 11. Every constraint is validated, so no stored row holds the value.
SELECT is((SELECT count(*)::int FROM pg_constraint
            WHERE conname LIKE '%\_not\_retired\_title\_role' AND NOT convalidated),
  0, 'every constraint is validated; no stored row holds the value');

-- Fixtures.
DO $$
DECLARE
  _t uuid := 'c9950000-0000-0000-0000-00000000000a';
  _a uuid := 'c9950000-0000-0000-0000-0000000000a1';
  _m uuid := 'c9950000-0000-0000-0000-0000000000a2';
BEGIN
  INSERT INTO auth.users (id, email) VALUES (_a, 'vf-admin@example.test'), (_m, 'vf-member@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features)
  VALUES (_t, 'vf-scope', 'VF Scope', 'active', 'standalone', 'VFS', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
  VALUES (_t, _a, 'admin', 'active', false), (_t, _m, 'member', 'active', false);
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES (_a, _t)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_a, 'admin') ON CONFLICT DO NOTHING;
END $$;

-- 12–13. A direct write of the value is refused.
SELECT throws_ok($q$INSERT INTO public.user_roles (user_id, role)
                   VALUES ('c9950000-0000-0000-0000-0000000000a2', 'coach')$q$,
  '23514', NULL, 'no one can be given the platform role');
SELECT throws_ok($q$INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner)
                   VALUES ('c9950000-0000-0000-0000-00000000000a', 'c9950000-0000-0000-0000-0000000000a2',
                           'coach', 'active', false)$q$,
  '23514', NULL, 'no one can be seated with the value');

-- 14–15. The tenant grant function refuses the value by name, and still grants a real role.
SELECT set_config('request.jwt.claims', '{"sub":"c9950000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SELECT throws_ok($q$SELECT public.grant_tenant_member_role('c9950000-0000-0000-0000-0000000000a2', 'coach',
                                                          'c9950000-0000-0000-0000-00000000000a', NULL)$q$,
  '42501', 'ROLE_CHANGE_FORBIDDEN: coach is a title, never a role', 'an admin cannot grant the value');
SELECT lives_ok($q$SELECT public.grant_tenant_member_role('c9950000-0000-0000-0000-0000000000a2', 'viewer',
                                                        'c9950000-0000-0000-0000-00000000000a', NULL)$q$,
  'an admin still grants a real role to a member of the business');

-- 16–17. No platform role row holds the value, and the function that removed it is gone.
SELECT is((SELECT count(*)::int FROM public.user_roles WHERE role::text = 'coach'),
  0, 'no platform role row holds the value');
SELECT ok(to_regprocedure('public.admin_remove_coach_role(uuid)') IS NULL,
  'the function that removed the value is gone');

SELECT * FROM finish();
ROLLBACK;
