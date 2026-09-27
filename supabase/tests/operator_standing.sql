-- G1: one server answer. operator_standing() and operator_may() for every caller class; the R0
-- ruling (revised 2026-09-27) pinned as exact rows; the default rule for an unlisted capability;
-- the grants that keep the answer to the caller's own standing; and proof that role access is
-- DATA — adding an operator role, granting and withdrawing a capability are row changes that
-- change the answer with no code change.
BEGIN;
SELECT plan(95);

-- ── Grants ──────────────────────────────────────────────────────────────────────────────────
SELECT ok(NOT has_function_privilege('anon', 'public.operator_standing()', 'EXECUTE'),
  'anon cannot call operator_standing');
SELECT ok(NOT has_function_privilege('anon', 'public.operator_may(text)', 'EXECUTE'),
  'anon cannot call operator_may');
SELECT ok(has_function_privilege('authenticated', 'public.operator_standing()', 'EXECUTE'),
  'a signed-in caller can ask their own standing');
SELECT ok(has_function_privilege('authenticated', 'public.operator_may(text)', 'EXECUTE'),
  'a signed-in caller can ask what they may do');
SELECT ok(NOT has_table_privilege(r.rolname, t.tbl, p.priv),
  format('%s has no %s on %s', r.rolname, p.priv, t.tbl))
FROM (VALUES ('anon'), ('authenticated'), ('service_role')) r(rolname)
CROSS JOIN (VALUES ('public.platform_operator_roles'), ('public.platform_operator_capabilities'),
                   ('public.platform_operator_role_capabilities')) t(tbl)
CROSS JOIN (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv);

-- ── The ruling, as exact rows. A stray row fails here, not in production. ───────────────────
SELECT results_eq(
  $$SELECT role, rank, holds_unlisted FROM public.platform_operator_roles ORDER BY rank DESC$$,
  $$VALUES ('super_admin'::text, 100, true), ('platform_admin'::text, 50, false)$$,
  'the operator roles are exactly super_admin over platform_admin, and only super_admin holds the unlisted');
SELECT results_eq(
  $$SELECT capability FROM public.platform_operator_role_capabilities WHERE role = 'platform_admin' ORDER BY 1$$,
  $$VALUES ('autonomy.posture.raise'::text), ('billing.read'), ('capability.administer'), ('console.enter'),
           ('fleet.directory.read'), ('operator.seat.platform_admin.grant'), ('operator.seat.platform_admin.revoke'),
           ('platform.health.read'), ('tenant.act_as'), ('tenant.act_as.write'), ('tenant.provision'),
           ('tenant.status.set')$$,
  'platform_admin holds exactly the revised R0 grants and the G3 rulings');
SELECT set_eq(
  $$SELECT capability FROM public.platform_operator_role_capabilities WHERE role = 'super_admin'$$,
  $$SELECT capability FROM public.platform_operator_capabilities$$,
  'super_admin is granted every listed capability explicitly');
SELECT is((SELECT count(*)::int FROM public.platform_operator_capabilities), 16,
  'the catalogue lists the sixteen ruled capabilities');
SELECT ok(obj_description('public.platform_operator_capabilities'::regclass, 'pg_class')
  LIKE '%DEFAULT RULE: a capability with no row here is held only by an operator role whose holds_unlisted is true (super_admin)%',
  'the catalogue states the default rule where the rows are');

-- ── Callers ─────────────────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (id, aud, role, email) VALUES
  ('0a570000-0000-4000-8000-000000000001','authenticated','authenticated','standing-super@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000002','authenticated','authenticated','standing-platform@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000004','authenticated','authenticated','standing-tenant-admin@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000005','authenticated','authenticated','standing-user@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000006','authenticated','authenticated','standing-moderator@tests.invalid'),
  ('0a570000-0000-4000-8000-000000000007','authenticated','authenticated','standing-grantee@tests.invalid');
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES
  ('0a570000-0000-4000-8000-000000000001','super_admin'),
  ('0a570000-0000-4000-8000-000000000002','platform_admin'),
  ('0a570000-0000-4000-8000-000000000004','admin'),
  ('0a570000-0000-4000-8000-000000000005','user'),
  ('0a570000-0000-4000-8000-000000000006','moderator');
SELECT set_config('request.jwt.claims','',true);

INSERT INTO public.tenants (id, slug, name, owner_user_id, status, account_type, features, brand) VALUES
  ('0a570000-0000-4000-8000-00000000a001','standing-proof-tenant','Standing Proof Tenant',
   '0a570000-0000-4000-8000-000000000004','active','standalone','{}'::jsonb,'{}'::jsonb);
INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner, joined_at) VALUES
  ('0a570000-0000-4000-8000-00000000a001','0a570000-0000-4000-8000-000000000004','owner','active',true,now()),
  ('0a570000-0000-4000-8000-00000000a001','0a570000-0000-4000-8000-000000000005','member','active',false,now()),
  ('0a570000-0000-4000-8000-00000000a001','0a570000-0000-4000-8000-000000000007','member','active',false,now());

-- Every caller carries a pointer, so the test proves who is TOLD about it, not who has one. The
-- tenant's own people point at their own tenant; the super_admin gets there through the audited
-- act-as. (Direct writes can also set an operator's pointer until slice A2 closes them, which is
-- why the column is called active_tenant_id, not an act-as.)
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('0a570000-0000-4000-8000-000000000001',NULL),
  ('0a570000-0000-4000-8000-000000000002',NULL),
  ('0a570000-0000-4000-8000-000000000004',NULL),
  ('0a570000-0000-4000-8000-000000000005',NULL),
  ('0a570000-0000-4000-8000-000000000006',NULL),
  ('0a570000-0000-4000-8000-000000000007',NULL)
ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = NULL;
UPDATE public.profiles SET active_tenant_id = '0a570000-0000-4000-8000-00000000a001'
 WHERE user_id IN ('0a570000-0000-4000-8000-000000000004','0a570000-0000-4000-8000-000000000005',
                   '0a570000-0000-4000-8000-000000000007');

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
SELECT is((SELECT active_tenant_id FROM public.operator_standing()),
  '0a570000-0000-4000-8000-00000000a001'::uuid, 'an operator is told the tenant their session is scoped to');
SELECT is((SELECT count(*)::int FROM public.operator_standing()), 1, 'the answer is always one row');
SELECT ok((SELECT holds_unlisted FROM public.operator_standing()), 'the owner tier is reported as holding the unlisted');
SELECT ok(public.operator_may('operator.seat.super_admin.grant'), 'super_admin may grant a super_admin seat');
SELECT ok(public.operator_may('operator.seat.platform_admin.grant'), 'super_admin may grant a platform_admin seat');
SELECT ok(public.operator_may('billing.read'), 'super_admin may read billing');
SELECT ok(public.operator_may('platform.paige.use'), 'an unlisted capability is still super_admin''s');
SELECT ok(NOT public.operator_may(NULL), 'a NULL capability is refused even to super_admin');

-- platform_admin, at rest
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000002');
SELECT is((SELECT tier FROM public.operator_standing()), 'platform_admin', 'platform_admin reads as platform_admin');
SELECT is((SELECT active_tenant_id FROM public.operator_standing()), NULL::uuid, 'at rest, no tenant');
SELECT ok(NOT (SELECT holds_unlisted FROM public.operator_standing()), 'the delegated tier does not hold the unlisted');
SELECT ok(public.operator_may('console.enter'), 'platform_admin may enter the console');
SELECT ok(public.operator_may('fleet.directory.read'), 'platform_admin may read the directory');
SELECT ok(public.operator_may('tenant.act_as'), 'platform_admin may act as a tenant');
SELECT ok(public.operator_may('platform.health.read'), 'platform_admin may read platform health');
SELECT ok(public.operator_may('tenant.provision'), 'platform_admin may provision a tenant');
SELECT ok(public.operator_may('tenant.status.set'), 'platform_admin may change a tenant''s status');
SELECT ok(public.operator_may('billing.read'), 'platform_admin may read billing, MRR and revenue class');
SELECT ok(public.operator_may('capability.administer'), 'platform_admin may administer capabilities');
SELECT ok(public.operator_may('operator.seat.platform_admin.grant'), 'platform_admin may grant a peer seat');
SELECT ok(public.operator_may('operator.seat.platform_admin.revoke'), 'platform_admin may revoke a peer seat');
SELECT ok(NOT public.operator_may('operator.seat.super_admin.grant'), 'platform_admin may not grant a seat above its own');
SELECT ok(NOT public.operator_may('operator.seat.super_admin.revoke'), 'platform_admin may not revoke a seat above its own');
SELECT ok(public.operator_may('autonomy.posture.raise'), 'platform_admin may raise the posture above the ceiling, capped (G3 decision 1)');
SELECT ok(NOT public.operator_may('autonomy.rung.renew'), 'platform_admin may not re-attest, so the cap stays a cap (G3 decision 1, §68)');
SELECT ok(NOT public.operator_may('fleet.directory.detail'), 'platform_admin does not see fleet-wide seats, clients or revenue class (G3 decision 2)');
SELECT ok(public.operator_may('tenant.act_as.write'), 'platform_admin holds the same powers inside a tenant as super_admin (G3 decision 6)');
SELECT ok(NOT public.operator_may('platform.paige.use'), 'an unlisted capability is refused to platform_admin');
SELECT ok(NOT public.operator_may('Console.Enter'), 'capabilities are matched exactly, case included');
SELECT ok(NOT public.operator_may(NULL), 'a NULL capability is refused');

-- holds both roles. user_roles allows one super_admin row (the one_super_admin index), so the
-- existing super_admin is given platform_admin as well rather than minting a second super_admin.
RESET ROLE;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
INSERT INTO public.user_roles (user_id, role) VALUES ('0a570000-0000-4000-8000-000000000001','platform_admin');
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000001');
SELECT is((SELECT tier FROM public.operator_standing()), 'super_admin', 'holding both roles reads as the higher-ranked, super_admin');
SELECT ok(public.operator_may('operator.seat.super_admin.grant'), 'and carries super_admin''s capabilities');

-- a tenant admin is not an operator, and is not told about their pointer through this answer
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000004');
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'a tenant admin is not an operator');
SELECT is((SELECT active_tenant_id FROM public.operator_standing()), NULL::uuid,
  'a tenant''s own active tenant is not reported through the operator answer');
SELECT ok(NOT public.operator_may('console.enter'), 'a tenant admin may not enter the console');
SELECT ok(NOT public.operator_may('platform.paige.use'), 'a tenant admin does not hold unlisted capabilities');

-- an ordinary user
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000005');
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'an ordinary user is not an operator');
SELECT ok(NOT public.operator_may('console.enter'), 'an ordinary user may not enter the console');

-- a signed-in role with no subject in its claims (a service call carries none either)
SELECT set_config('request.jwt.claims', '', true);
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'no subject, no standing');
SELECT is((SELECT active_tenant_id FROM public.operator_standing()), NULL::uuid, 'no subject, no pointer');
SELECT is((SELECT count(*)::int FROM public.operator_standing()), 1, 'no subject still gets exactly one row');
SELECT ok(NOT public.operator_may('console.enter'), 'no subject may nothing');

-- ── Role access is data: change rows, and the answer changes with no code change ────────────
-- A moderator is not an operator until a row says so.
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000006');
SELECT is((SELECT tier FROM public.operator_standing()), NULL::text, 'a moderator is not an operator by default');
-- Control for the grant lockdown below: while moderator is NOT an operator tier, a tenant admin may
-- grant it through the tenant-role RPC, so the refusal after the row is the row's doing.
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000004');
SELECT lives_ok($$SELECT public.grant_tenant_member_role('0a570000-0000-4000-8000-000000000005'::uuid,
  'moderator'::public.app_role, '0a570000-0000-4000-8000-00000000a001'::uuid, 'test')$$,
  'a tenant admin may grant a role that is not an operator tier');
RESET ROLE;
INSERT INTO public.platform_operator_roles (role, rank, holds_unlisted, description, ruling)
VALUES ('moderator', 10, false, 'test-only operator role', 'test');
INSERT INTO public.platform_operator_role_capabilities (role, capability, ruling)
VALUES ('moderator', 'platform.health.read', 'test');
-- Withdraw one capability from platform_admin, the same way.
DELETE FROM public.platform_operator_role_capabilities
 WHERE role = 'platform_admin' AND capability = 'billing.read';
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000006');
SELECT is((SELECT tier FROM public.operator_standing()), 'moderator', 'a role added as a row becomes an operator tier');
SELECT ok(public.operator_may('platform.health.read'), 'and holds the capability granted to it as a row');
SELECT ok(NOT public.operator_may('console.enter'), 'and nothing it was not granted');
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000002');
SELECT ok(NOT public.operator_may('billing.read'), 'withdrawing a grant row withdraws the capability');
-- Codex review of #1534 (P1): once a row makes a role an operator tier, the structural grant
-- lockdown must protect it, or a tenant admin could mint platform standing through the tenant RPC.
SELECT pg_temp.as_caller('0a570000-0000-4000-8000-000000000004');
-- Named by the lockdown's own error, so a refusal from any other guard cannot pass it.
SELECT throws_like($$SELECT public.grant_tenant_member_role('0a570000-0000-4000-8000-000000000007'::uuid,
  'moderator'::public.app_role, '0a570000-0000-4000-8000-00000000a001'::uuid, 'test')$$,
  '%PROTECTED_ROLE_GRANT_FORBIDDEN%', 'a role made an operator tier by a row can no longer be granted by a tenant admin');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
