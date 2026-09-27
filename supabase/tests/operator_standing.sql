-- G1: one server answer. operator_standing() and operator_may() for every caller class, the R0
-- capability rows, the default rule for an unruled capability, and the grants that keep the
-- answer to the caller's own standing.
BEGIN;
SELECT plan(40);

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.operator_standing()', 'EXECUTE'),
  'anon cannot call operator_standing');
SELECT ok(NOT has_function_privilege('anon', 'public.operator_may(text)', 'EXECUTE'),
  'anon cannot call operator_may');
SELECT ok(has_function_privilege('authenticated', 'public.operator_standing()', 'EXECUTE'),
  'a signed-in caller can ask their own standing');
SELECT ok(has_function_privilege('authenticated', 'public.operator_may(text)', 'EXECUTE'),
  'a signed-in caller can ask what they may do');
SELECT ok(NOT has_table_privilege('authenticated', 'public.platform_operator_capabilities', 'SELECT'),
  'the capability table is not readable directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.platform_operator_capabilities', 'INSERT'),
  'the capability table is not writable by a signed-in caller');
SELECT ok(NOT has_table_privilege('authenticated', 'public.platform_operator_capabilities', 'UPDATE'),
  'a signed-in caller cannot widen a capability');

-- ── Callers ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0a570000-0000-4000-8000-000000000001','authenticated','authenticated','standing-super@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000002','authenticated','authenticated','standing-platform@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000004','authenticated','authenticated','standing-tenant-admin@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000005','authenticated','authenticated','standing-user@tests.invalid');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0a570000-0000-4000-8000-000000000001','super_admin'),
  ('0a570000-0000-4000-8000-000000000002','platform_admin'),
  ('0a570000-0000-4000-8000-000000000004','admin'),
  ('0a570000-0000-4000-8000-000000000005','user');

INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0a570000-0000-4000-8000-00000000a001','standing-proof-tenant','Standing Proof Tenant',
   '0a570000-0000-4000-8000-000000000004','active','standalone','{}'::jsonb,'{}'::jsonb);

INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0a570000-0000-4000-8000-00000000a001','0a570000-0000-4000-8000-000000000004','owner','active',true,now()),
  ('0a570000-0000-4000-8000-00000000a001','0a570000-0000-4000-8000-000000000005','member','active',false,now());

-- Every caller carries a pointer, so the test proves who is TOLD about it, not who has one. The
-- tenant's own people point at their own tenant; the super_admin gets there through the audited
-- act-as, the only way an operator's pointer is set.
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0a570000-0000-4000-8000-000000000001',NULL),
  ('0a570000-0000-4000-8000-000000000002',NULL),
  ('0a570000-0000-4000-8000-000000000004',NULL),
  ('0a570000-0000-4000-8000-000000000005',NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = NULL;
UPDATE public.profiles SET active_tenant_id = '0a570000-0000-4000-8000-00000000a001'
 WHERE user_id IN ('0a570000-0000-4000-8000-000000000004','0a570000-0000-4000-8000-000000000005');

CREATE FUNCTION pg_temp.as_caller(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', _uid::text, 'role', 'authenticated')::text, true);
END $$;

SET LOCAL ROLE authenticated;

-- super_admin, acting as a tenant
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000001');
SELECT public.operator_enter_tenant('0a570000-0000-4000-8000-00000000a001');
SELECT is((SELECT tier FROM public.operator_standing()), 'super_admin', 'super_admin reads as super_admin');
SELECT is((SELECT acting_tenant_id FROM public.operator_standing()),
  '0a570000-0000-4000-8000-00000000a001'::uuid, 'an operator is told the tenant they are acting as');
SELECT is((SELECT count(*)::int FROM public.operator_standing()), 1, 'the answer is always one row');
SELECT ok(public.operator_may('operator.seat.grant'), 'super_admin may grant an operator seat');
SELECT ok(public.operator_may('billing.read'), 'super_admin may read billing');
SELECT ok(public.operator_may('platform.paige.use'), 'an unruled capability is still super_admin''s');

-- platform_admin, at rest
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000002');
SELECT is((SELECT tier FROM public.operator_standing()), 'platform_admin', 'platform_admin reads as platform_admin');
SELECT is((SELECT acting_tenant_id FROM public.operator_standing()), NULL::uuid, 'at rest, no tenant');
SELECT ok(public.operator_may('console.enter'), 'platform_admin may enter the console');
SELECT ok(public.operator_may('fleet.directory.read'), 'platform_admin may read the directory');
SELECT ok(public.operator_may('tenant.act_as'), 'platform_admin may act as a tenant');
SELECT ok(public.operator_may('platform.health.read'), 'platform_admin may read platform health');
SELECT ok(public.operator_may('tenant.provision'), 'platform_admin may provision a tenant');
SELECT ok(public.operator_may('tenant.status.set'), 'platform_admin may change a tenant''s status');
SELECT ok(public.operator_may('billing.read'), 'platform_admin may read billing, MRR and revenue class');
SELECT ok(public.operator_may('capability.administer'), 'platform_admin may administer capabilities');
SELECT ok(NOT public.operator_may('operator.seat.grant'), 'platform_admin may not grant an operator seat (§53)');
SELECT ok(NOT public.operator_may('operator.seat.revoke'), 'platform_admin may not revoke an operator seat');
SELECT ok(NOT public.operator_may('platform.paige.use'), 'an unruled capability is refused to platform_admin');
SELECT ok(NOT public.operator_may('billing.write'), 'a misspelled or unknown capability is refused, not guessed');
SELECT ok(NOT public.operator_may(NULL), 'a NULL capability is refused');

-- holds both roles. user_roles allows one super_admin row (the one_super_admin index), so the
-- existing super_admin is given platform_admin as well rather than minting a second super_admin.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES ('0a570000-0000-4000-8000-000000000001','platform_admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000001');
SELECT is((SELECT tier FROM public.operator_standing()), 'super_admin', 'holding both roles reads as super_admin');
SELECT ok(public.operator_may('operator.seat.grant'), 'and carries super_admin''s capabilities');

-- a tenant admin is not an operator, and is not told about their pointer through this answer
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000004');
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'a tenant admin is not an operator');
SELECT is((SELECT acting_tenant_id FROM public.operator_standing()), NULL::uuid,
  'a tenant''s own active tenant is not reported as an act-as');
SELECT ok(NOT public.operator_may('console.enter'), 'a tenant admin may not enter the console');
SELECT ok(NOT public.operator_may('fleet.directory.read'), 'a tenant admin may not read the directory');

-- an ordinary user
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000005');
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'an ordinary user is not an operator');
SELECT ok(NOT public.operator_may('console.enter'), 'an ordinary user may not enter the console');

-- no subject at all (a service call, or a signed-out session reaching the function)
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'no subject, no standing');
SELECT is((SELECT acting_tenant_id FROM public.operator_standing()), NULL::uuid, 'no subject, no pointer');
SELECT ok(NOT public.operator_may('console.enter'), 'no subject may nothing');

RESET ROLE;

-- The table states its own default rule, so a future reader sees it where the rows are.
SELECT ok(obj_description('public.platform_operator_capabilities'::regclass, 'pg_class')
  LIKE '%DEFAULT RULE: a capability with no row here is super_admin only%',
  'the capability table states the default rule');

SELECT * FROM finish();
ROLLBACK;
