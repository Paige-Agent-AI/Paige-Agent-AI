-- G1: one server answer. operator_standing() and operator_may() for every caller class; the R0
-- ruling (revised 2026-09-27) pinned as exact rows; the default rule for an unlisted capability;
-- the grants that keep the answer to the caller's own standing; and proof that role access is
-- DATA — adding an operator role, granting and withdrawing a capability are row changes that
-- change the answer with no code change.
BEGIN;
SELECT plan(100);

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
-- Codex review of #1534 (P1s on fc242943 and before): a ruled grant is recorded as a row, but
-- operator_may() answers only from rows IN FORCE — where today's enforcement already admits the
-- role. The rest wait, each naming the slice that moves its gate and flips it.
SELECT results_eq(
  $$SELECT capability, in_force FROM public.platform_operator_role_capabilities WHERE role = 'platform_admin' ORDER BY 1$$,
  $$VALUES ('autonomy.posture.raise'::text, false), ('billing.read', false), ('capability.administer', false),
           ('console.enter', true), ('fleet.directory.read', true),
           ('operator.seat.platform_admin.grant', false), ('operator.seat.platform_admin.revoke', false),
           ('platform.health.read', true), ('tenant.act_as', true), ('tenant.act_as.write', false),
           ('tenant.provision', false), ('tenant.status.set', false)$$,
  'platform_admin holds exactly the revised R0 and G3 grants, in force only where enforcement admits it');
SELECT results_eq(
  $$SELECT capability FROM public.platform_operator_role_capabilities WHERE role = 'super_admin' AND NOT in_force ORDER BY 1$$,
  $$VALUES ('operator.seat.super_admin.grant'::text), ('operator.seat.super_admin.revoke')$$,
  'super_admin''s only grants not in force are the super_admin seats, blocked by the singleton invariants');
SELECT ok(NOT EXISTS (SELECT 1 FROM public.platform_operator_role_capabilities
                      WHERE NOT in_force AND (pending IS NULL OR length(btrim(pending)) = 0)),
  'every grant not in force names what it waits for');
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
SELECT ok(NOT public.operator_may('operator.seat.super_admin.grant'), 'super_admin may not yet grant a super_admin seat: one_super_admin refuses a second row');
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
-- Ruled, not yet in force: today's gates for these admit only super_admin.
SELECT ok(NOT public.operator_may('tenant.provision'), 'platform_admin may not yet provision: operator_provision_tenant is owner-only');
SELECT ok(NOT public.operator_may('tenant.status.set'), 'platform_admin may not yet set status: operator_set_tenant_status is owner-only');
SELECT ok(NOT public.operator_may('billing.read'), 'platform_admin may not yet read billing: revenue classification is owner-only');
SELECT ok(NOT public.operator_may('capability.administer'), 'platform_admin may not yet administer capabilities: not proven to admit it');
-- Codex review of #1534 (third P1): the §53 lockdown still lets only super_admin write an operator
-- role, so the peer-seat grants wait for the seats slice, which moves the enforcement and flips them.
SELECT ok(NOT public.operator_may('operator.seat.platform_admin.grant'), 'platform_admin may not yet grant a peer seat: enforcement has not moved');
SELECT ok(NOT public.operator_may('operator.seat.platform_admin.revoke'), 'platform_admin may not yet revoke a peer seat: enforcement has not moved');
SELECT ok(NOT public.operator_may('operator.seat.super_admin.grant'), 'platform_admin may not grant a seat above its own');
SELECT ok(NOT public.operator_may('operator.seat.super_admin.revoke'), 'platform_admin may not revoke a seat above its own');
SELECT ok(NOT public.operator_may('autonomy.posture.raise'), 'platform_admin may not yet raise the posture: set_trust_posture raises are owner-only until G3');
SELECT ok(NOT public.operator_may('autonomy.rung.renew'), 'platform_admin may not re-attest, so the cap stays a cap (G3 decision 1, §68)');
SELECT ok(NOT public.operator_may('fleet.directory.detail'), 'platform_admin does not see fleet-wide seats, clients or revenue class (G3 decision 2)');
SELECT ok(NOT public.operator_may('tenant.act_as.write'), 'platform_admin does not yet hold write powers inside a tenant: the Solo parity slice brings them');
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
SELECT ok(public.operator_may('fleet.directory.detail'), 'and carries super_admin''s capabilities');

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
SELECT lives_ok($$SELECT public.revoke_tenant_member_role('0a570000-0000-4000-8000-000000000007'::uuid,
  'moderator'::public.app_role, '0a570000-0000-4000-8000-00000000a001'::uuid, 'test')$$,
  'and may revoke a role that is not an operator tier');
RESET ROLE;
INSERT INTO public.platform_operator_roles (role, rank, holds_unlisted, description, ruling)
VALUES ('moderator', 10, false, 'test-only operator role', 'test');
-- Codex review of #1534 (P1 on 49335124): listing a role races a concurrent grant of it, whose check
-- cannot see the uncommitted tier. Listing therefore takes a lock that makes grants in flight finish
-- first and grants after it wait for the listing to commit. The race needs two sessions; what one
-- session can prove is that listing holds exactly that lock on user_roles.
SELECT ok(EXISTS (SELECT 1 FROM pg_locks
                  WHERE pid = pg_backend_pid() AND locktype = 'relation'
                    AND relation = 'public.user_roles'::regclass
                    AND mode = 'ShareRowExclusiveLock' AND granted),
  'listing a role as an operator tier serialises with grants of it (SHARE ROW EXCLUSIVE on user_roles)');
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
-- Codex review of #1534 (second P1): nor revoked — the lockdown covers the row that leaves, too.
SELECT throws_like($$SELECT public.revoke_tenant_member_role('0a570000-0000-4000-8000-000000000005'::uuid,
  'moderator'::public.app_role, '0a570000-0000-4000-8000-00000000a001'::uuid, 'test')$$,
  '%PROTECTED_ROLE_GRANT_FORBIDDEN%', 'nor revoked from its holder by a tenant admin');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
