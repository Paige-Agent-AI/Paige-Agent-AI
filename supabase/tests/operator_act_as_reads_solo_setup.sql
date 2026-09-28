-- An operator acting as a Solo workspace reads its Setup context, read-only (owner live drive,
-- 2026-09-28: Business Game Plan stayed a skeleton for every operator in every workspace, because
-- the Setup read admitted only an owner or an active member). The read derives from G1's
-- capability `tenant.act_as` and the operator's own act-as pointer; every Setup write stays
-- member-only. Synthetic fixtures; always rolled back.
BEGIN;
SELECT plan(25);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0a5b0000-0000-4000-8000-000000000001','authenticated','authenticated','setup-read-super@tests.invalid'),
  ('0a5b0000-0000-4000-8000-000000000002','authenticated','authenticated','setup-read-platform@tests.invalid'),
  ('0a5b0000-0000-4000-8000-000000000003','authenticated','authenticated','setup-read-owner@tests.invalid'),
  ('0a5b0000-0000-4000-8000-000000000004','authenticated','authenticated','setup-read-outsider@tests.invalid'),
  ('0a5b0000-0000-4000-8000-000000000005','authenticated','authenticated','setup-read-owner-two@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
-- The outsider carries a GLOBAL admin role on purpose (the §59 global-role trap): a gate written
-- against has_any_role() would admit them. They must still be refused.
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0a5b0000-0000-4000-8000-000000000001','super_admin'),
  ('0a5b0000-0000-4000-8000-000000000002','platform_admin'),
  ('0a5b0000-0000-4000-8000-000000000003','admin'),
  ('0a5b0000-0000-4000-8000-000000000004','admin')
ON CONFLICT DO NOTHING;
SELECT set_config('request.jwt.claims','',true);

-- Workspace A is canceled on purpose: the owner ruled an operator may act as a tenant in any state.
INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0a5b0000-0000-4000-8000-00000000a001','setup-read-one','Setup Read One',
   '0a5b0000-0000-4000-8000-000000000003','canceled','standalone','{}'::jsonb,'{}'::jsonb),
  ('0a5b0000-0000-4000-8000-00000000a002','setup-read-two','Setup Read Two',
   '0a5b0000-0000-4000-8000-000000000005','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0a5b0000-0000-4000-8000-00000000a001','0a5b0000-0000-4000-8000-000000000003','owner','active',true,now());
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0a5b0000-0000-4000-8000-000000000001',NULL),
  ('0a5b0000-0000-4000-8000-000000000002',NULL),
  ('0a5b0000-0000-4000-8000-000000000003','0a5b0000-0000-4000-8000-00000000a001'),
  ('0a5b0000-0000-4000-8000-000000000004',NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;
-- Runs as the table owner: the capability grant is not the caller's to change.
CREATE FUNCTION pg_temp.set_act_as_in_force(_role text, _on boolean) RETURNS void
LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE public.platform_operator_role_capabilities
     SET in_force = _on,
         pending = CASE WHEN _on THEN NULL ELSE 'withdrawn by this test' END
   WHERE role = _role AND capability = 'tenant.act_as'
$$;

-- The operator predicate is an internal helper, never a door of its own.
SELECT ok(NOT has_function_privilege('authenticated', 'public.solo_setup_operator_can_read()', 'EXECUTE'),
  'the operator read predicate is not callable by an authenticated caller');
SELECT ok(NOT has_function_privilege('anon', 'public.solo_setup_operator_can_read()', 'EXECUTE'),
  'the operator read predicate is not callable anonymously');

SET LOCAL ROLE authenticated;

-- The member path is unchanged.
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000003');
SELECT is(public.get_solo_setup_context() ->> 'tenantId', '0a5b0000-0000-4000-8000-00000000a001',
  'the workspace owner still reads its Setup context');

-- A super_admin at rest has no workspace to read.
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000001');
SELECT is(public.get_solo_setup_context(), NULL::jsonb, 'an operator at rest reads no Setup context');

-- Inside the audited act-as, the super_admin reads it, read-only.
SELECT is(public.operator_enter_tenant('0a5b0000-0000-4000-8000-00000000a001') ->> 'active_tenant_id',
  '0a5b0000-0000-4000-8000-00000000a001', 'the super_admin enters the (canceled) workspace');
SELECT is(public.get_solo_setup_context() ->> 'tenantId', '0a5b0000-0000-4000-8000-00000000a001',
  'a super_admin acting as the workspace reads its Setup context');
SELECT is(public.get_solo_setup_context() ->> 'accessScope', 'read_only',
  'the operator reads it read-only');
SELECT is(public.get_solo_business_context() ->> 'tenantId', '0a5b0000-0000-4000-8000-00000000a001',
  'a super_admin acting as the workspace reads its business context');
SELECT throws_ok($$SELECT public.save_solo_setup_context('{}'::jsonb)$$, '42501', NULL,
  'a super_admin acting as the workspace still cannot write its Setup');

-- Leaving closes the read.
SELECT ok((public.operator_exit_tenant() ->> 'exited')::boolean IS NOT FALSE, 'the super_admin exits');
SELECT is(public.get_solo_setup_context(), NULL::jsonb, 'after exit the operator reads nothing');

-- A platform_admin holds tenant.act_as in force, so the same read is theirs inside an act-as.
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000002');
SELECT is(public.operator_enter_tenant('0a5b0000-0000-4000-8000-00000000a002') ->> 'active_tenant_id',
  '0a5b0000-0000-4000-8000-00000000a002', 'the platform_admin enters a workspace');
SELECT is(public.get_solo_setup_context() ->> 'tenantId', '0a5b0000-0000-4000-8000-00000000a002',
  'a platform_admin acting as the workspace reads its Setup context');
SELECT is(public.get_solo_setup_context() ->> 'accessScope', 'read_only',
  'the platform_admin reads it read-only');
SELECT throws_ok($$SELECT public.save_solo_setup_context('{}'::jsonb)$$, '42501', NULL,
  'a platform_admin acting as the workspace cannot write its Setup');

-- The read is the capability's, not the role's: withdraw tenant.act_as and it closes.
RESET ROLE;
SELECT pg_temp.set_act_as_in_force('platform_admin', false);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000002');
SELECT is(public.get_solo_setup_context(), NULL::jsonb,
  'with tenant.act_as not in force, the platform_admin reads nothing');
SELECT throws_ok($$SELECT public.get_solo_business_context()$$, '42501', NULL,
  'with tenant.act_as not in force, the business context refuses the platform_admin');
RESET ROLE;
SELECT pg_temp.set_act_as_in_force('platform_admin', true);
SET LOCAL ROLE authenticated;

-- A pointer set without the audited enter is not an act-as: an operator can update their own
-- profile row, and the membership guard admits a platform admin's non-member pointer, so this is
-- reachable with a plain PATCH. No receipt, no read.
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000001');
UPDATE public.profiles SET active_tenant_id = '0a5b0000-0000-4000-8000-00000000a001'
 WHERE user_id = '0a5b0000-0000-4000-8000-000000000001';
SELECT is(public.current_user_tenant_id(), '0a5b0000-0000-4000-8000-00000000a001'::uuid,
  'a super_admin can point their own scope at a workspace without the audited enter');
SELECT is(public.get_solo_setup_context(), NULL::jsonb,
  'a pointer with no open enter receipt reads nothing (the earlier enter here was exited)');
SELECT throws_ok($$SELECT public.get_solo_business_context()$$, '42501', NULL,
  'a pointer with no open enter receipt is refused the business context');

-- Nor can an operator write their own receipt: the audit log admits a caller's own rows, but an
-- operator.* row comes only from the server's own functions (Codex review of 41fff866).
-- Stamped a minute later than the earlier exit, so it would read as an open act-as if it landed.
SELECT throws_ok($$INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, target_type, target_id, tenant_id, created_at)
  VALUES ('0a5b0000-0000-4000-8000-000000000001', 'platform_operator', 'operator.tenant.enter', 'tenant',
          '0a5b0000-0000-4000-8000-00000000a001', '0a5b0000-0000-4000-8000-00000000a001', now() + interval '1 minute')$$,
  '42501', NULL, 'an operator cannot write their own operator.tenant.enter receipt');
SELECT is(public.get_solo_setup_context(), NULL::jsonb,
  'with no receipt of their own making, the self-set pointer still reads nothing');
-- An ordinary caller still records their own ordinary actions.
SELECT lives_ok($$INSERT INTO public.paige_audit_log (actor_user_id, actor_role, action, tenant_id)
  VALUES ('0a5b0000-0000-4000-8000-000000000001', 'paige_chat', 'crm_create_task', '0a5b0000-0000-4000-8000-00000000a001')$$,
  'a caller still records their own non-operator actions');

-- A caller who is neither a member nor an operator is refused, even with a global admin role.
SELECT pg_temp.as_caller('0a5b0000-0000-4000-8000-000000000004');
SELECT is(public.get_solo_setup_context(), NULL::jsonb, 'a non-member non-operator reads nothing');
SELECT throws_ok($$SELECT public.get_solo_business_context()$$, '42501', NULL,
  'a non-member non-operator is refused the business context');

SELECT * FROM finish();
ROLLBACK;
