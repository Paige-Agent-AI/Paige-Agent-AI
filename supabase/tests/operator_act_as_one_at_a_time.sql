-- The act-as defect's server half (#1547): an operator holds one act-as at a time, and a repeated
-- enter or exit — a second tab, a second press — writes no second receipt. The client checks the
-- same things, but only within one tab; these are the checks two tabs cannot both pass.
BEGIN;
SELECT plan(26);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0a5a0000-0000-4000-8000-000000000001','authenticated','authenticated','actas-super@tests.invalid'),
  ('0a5a0000-0000-4000-8000-000000000002','authenticated','authenticated','actas-platform@tests.invalid'),
  ('0a5a0000-0000-4000-8000-000000000003','authenticated','authenticated','actas-owner@tests.invalid'),
  ('0a5a0000-0000-4000-8000-000000000004','authenticated','authenticated','actas-owner-two@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0a5a0000-0000-4000-8000-000000000001','super_admin'),
  ('0a5a0000-0000-4000-8000-000000000002','platform_admin'),
  ('0a5a0000-0000-4000-8000-000000000003','admin');
SELECT set_config('request.jwt.claims','',true);

INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0a5a0000-0000-4000-8000-00000000a001','actas-proof-one','Act-as Proof One',
   '0a5a0000-0000-4000-8000-000000000003','active','standalone','{}'::jsonb,'{}'::jsonb),
  ('0a5a0000-0000-4000-8000-00000000a002','actas-proof-two','Act-as Proof Two',
   '0a5a0000-0000-4000-8000-000000000004','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0a5a0000-0000-4000-8000-000000000001',NULL),
  ('0a5a0000-0000-4000-8000-000000000003',NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = NULL;
-- The platform_admin deliberately has no profile row.
DELETE FROM public.profiles WHERE user_id = '0a5a0000-0000-4000-8000-000000000002';

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;
-- Read as the table owner: the audit log and profiles are not the caller's to read.
CREATE FUNCTION pg_temp.receipts(_action text) RETURNS int LANGUAGE sql SECURITY DEFINER AS $$
  SELECT count(*)::int FROM public.paige_audit_log
   WHERE actor_user_id = '0a5a0000-0000-4000-8000-000000000001' AND action = _action
$$;
CREATE FUNCTION pg_temp.pointer() RETURNS uuid LANGUAGE sql SECURITY DEFINER AS $$
  SELECT active_tenant_id FROM public.profiles WHERE user_id = '0a5a0000-0000-4000-8000-000000000001'
$$;

SELECT ok(pg_get_functiondef('public.operator_enter_tenant(uuid)'::regprocedure) ~ 'FOR UPDATE',
  'enter locks the operator''s profile row before it reads the scope');
SELECT ok(pg_get_functiondef('public.operator_exit_tenant()'::regprocedure) ~ 'FOR UPDATE',
  'exit locks the operator''s profile row before it reads the scope');

SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a5a0000-0000-4000-8000-000000000001');

-- Enter from rest: one scope change, one receipt.
SELECT is(public.operator_enter_tenant('0a5a0000-0000-4000-8000-00000000a001') ->> 'active_tenant_id',
  '0a5a0000-0000-4000-8000-00000000a001', 'an operator at rest enters the tenant');
SELECT is(pg_temp.pointer(), '0a5a0000-0000-4000-8000-00000000a001'::uuid, 'the scope points at it');
SELECT is(pg_temp.receipts('operator.tenant.enter'), 1, 'one enter is recorded');

-- The same enter again (a second tab on the same tenant): no change, no second receipt.
SELECT is(public.operator_enter_tenant('0a5a0000-0000-4000-8000-00000000a001') ->> 'already_entered',
  'true', 're-entering the tenant already entered answers already_entered');
SELECT is(pg_temp.receipts('operator.tenant.enter'), 1, 're-entering records no second enter');

-- A different tenant while one is open: refused, nothing written.
SELECT throws_ok($$SELECT public.operator_enter_tenant('0a5a0000-0000-4000-8000-00000000a002')$$,
  'P0001', 'operator_scope_occupied', 'entering another tenant over an open act-as is refused');
SELECT is(pg_temp.pointer(), '0a5a0000-0000-4000-8000-00000000a001'::uuid,
  'the refused enter leaves the open act-as where it was');
SELECT is(pg_temp.receipts('operator.tenant.enter'), 1, 'the refused enter records nothing');

-- Exit: one scope change, one receipt naming the tenant left.
SELECT is(public.operator_exit_tenant() ->> 'previous_active_tenant_id',
  '0a5a0000-0000-4000-8000-00000000a001', 'exit leaves the tenant that was entered');
SELECT is(pg_temp.pointer(), NULL::uuid, 'the scope is empty again');
SELECT is(pg_temp.receipts('operator.tenant.exit'), 1, 'one exit is recorded');

-- The same exit again (a second tab, a second press): no change, no receipt.
SELECT is(public.operator_exit_tenant() ->> 'already_exited', 'true',
  'exiting from an empty scope answers already_exited');
SELECT is(pg_temp.receipts('operator.tenant.exit'), 1, 'exiting from an empty scope records nothing');

-- Having exited, the other tenant can be entered.
SELECT is(public.operator_enter_tenant('0a5a0000-0000-4000-8000-00000000a002') ->> 'active_tenant_id',
  '0a5a0000-0000-4000-8000-00000000a002', 'after the exit, another tenant can be entered');

-- Codex review of 2484540d: an exit names the tenant its tab shows. A stale tab that still shows the
-- first tenant must not end an act-as another tab opened since.
SELECT ok(NOT has_function_privilege('anon', 'public.operator_exit_tenant(uuid)', 'EXECUTE'),
  'anon cannot call the bound exit');
SELECT throws_ok($$SELECT public.operator_exit_tenant('0a5a0000-0000-4000-8000-00000000a001'::uuid)$$,
  'P0001', 'operator_scope_changed', 'an exit naming a tenant that is no longer the open act-as is refused');
SELECT is(pg_temp.pointer(), '0a5a0000-0000-4000-8000-00000000a002'::uuid,
  'the refused exit leaves the other act-as open');
SELECT is(pg_temp.receipts('operator.tenant.exit'), 1, 'the refused exit records nothing');
SELECT is(public.operator_exit_tenant('0a5a0000-0000-4000-8000-00000000a002'::uuid) ->> 'previous_active_tenant_id',
  '0a5a0000-0000-4000-8000-00000000a002', 'an exit naming the open act-as ends it');
SELECT is(pg_temp.receipts('operator.tenant.exit'), 2, 'and records one exit');
SELECT is(public.operator_exit_tenant('0a5a0000-0000-4000-8000-00000000a002'::uuid) ->> 'already_exited', 'true',
  'naming a tenant when nothing is open changes nothing and records nothing');

-- Unchanged refusals.
SELECT pg_temp.as_caller('0a5a0000-0000-4000-8000-000000000002');
SELECT throws_ok($$SELECT public.operator_exit_tenant()$$, 'P0002', 'operator_profile_missing',
  'an operator with no profile row is refused loudly, not answered already_exited');
SELECT pg_temp.as_caller('0a5a0000-0000-4000-8000-000000000003');
SELECT throws_ok($$SELECT public.operator_enter_tenant('0a5a0000-0000-4000-8000-00000000a001')$$,
  '42501', 'operator_scope_forbidden', 'a tenant admin cannot act as a tenant');
SELECT throws_ok($$SELECT public.operator_exit_tenant()$$, '42501', 'operator_scope_forbidden',
  'a tenant admin cannot call the operator exit');

SELECT * FROM finish();
ROLLBACK;
