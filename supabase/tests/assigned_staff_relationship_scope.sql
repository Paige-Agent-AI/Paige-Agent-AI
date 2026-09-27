-- ============================================================================
-- Assigned-staff relationships belong to exactly one tenant (coach_clients).
--
-- Proves, for the relationship table the platform reads when a staff member acts on an assigned
-- client: every row carries the tenant that holds the client; the client must be linked in that
-- tenant (structural); the assignee must currently qualify in that tenant (validated on write);
-- losing membership suspends the relationship and regaining it restores it; the helper's
-- assignment branch honours the same rule; and nothing outside the assignment path writes rows.
--
-- Synthetic fixtures only. Asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(16);

-- Production's API-role grants are reproduced in the rebuilt database by the database-contract job
-- (scripts/ci/reproduce-production-grants.mjs), so this proof exercises the policies as production
-- would, with no grants of its own.

DO $$
DECLARE
  _a uuid := 'a5500000-0000-0000-0000-00000000000a';
  _b uuid := 'a5500000-0000-0000-0000-00000000000b';
  _sa uuid := 'a5500000-0000-0000-0000-0000000005a1';
  _sb uuid := 'a5500000-0000-0000-0000-0000000005b1';
  _cx uuid := 'a5500000-0000-0000-0000-000000000c01';
  _cz uuid := 'a5500000-0000-0000-0000-000000000c02';
  _cy uuid := 'a5500000-0000-0000-0000-000000000c03';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_sa, 'as-staff-a@example.test'), (_sb, 'as-staff-b@example.test'),
    (_cx, 'as-client-x@example.test'), (_cz, 'as-client-z@example.test'),
    (_cy, 'as-client-y@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'as-scope-a', 'AS Scope A', 'active', 'standalone', 'ASA', '{}'),
    (_b, 'as-scope-b', 'AS Scope B', 'active', 'standalone', 'ASB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _sa, 'member', 'active', false),
    (_b, _sb, 'member', 'active', false);
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id, email) VALUES
    ('a5500000-0000-0000-0000-00000000c1e1', _a, _sa, 'X', 'Client', 'ASX-1', _cx, 'as-client-x@example.test'),
    ('a5500000-0000-0000-0000-00000000c1e2', _a, _sa, 'Z', 'Client', 'ASZ-1', _cz, NULL),
    ('a5500000-0000-0000-0000-00000000c1e3', _b, _sb, 'Y', 'Client', 'ASY-1', _cy, NULL);
END $$;

-- 1–2. The tenant is part of the row.
SELECT has_column('public', 'coach_clients', 'tenant_id', 'a relationship records its tenant');
SELECT col_not_null('public', 'coach_clients', 'tenant_id', 'and a relationship cannot exist without one');

-- 3. A qualifying assignee and a client linked in the same tenant.
SELECT lives_ok($q$
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status)
  VALUES ('a5500000-0000-0000-0000-00000000000a', 'a5500000-0000-0000-0000-0000000005a1',
          'a5500000-0000-0000-0000-000000000c01', 'active')$q$,
  'a member of the tenant can hold a relationship with a client linked in that tenant');

-- 4. An assignee who is not a member of the tenant is refused.
SELECT throws_ok($q$
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status)
  VALUES ('a5500000-0000-0000-0000-00000000000a', 'a5500000-0000-0000-0000-0000000005b1',
          'a5500000-0000-0000-0000-000000000c01', 'active')$q$,
  '23514', NULL, 'an assignee who does not qualify in the tenant is refused');

-- 5. A client who is not linked in the tenant is refused (structural).
SELECT throws_ok($q$
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status)
  VALUES ('a5500000-0000-0000-0000-00000000000a', 'a5500000-0000-0000-0000-0000000005a1',
          'a5500000-0000-0000-0000-000000000c03', 'active')$q$,
  '23503', NULL, 'a client linked only in another tenant is refused');

-- 6. Assigning on the contact record creates the relationship, in the contact's tenant.
UPDATE public.clients SET assigned_coach_user_id = 'a5500000-0000-0000-0000-0000000005a1'
 WHERE id = 'a5500000-0000-0000-0000-00000000c1e2';
SELECT is((SELECT count(*)::int FROM public.coach_clients
            WHERE tenant_id = 'a5500000-0000-0000-0000-00000000000a'
              AND coach_user_id = 'a5500000-0000-0000-0000-0000000005a1'
              AND client_user_id = 'a5500000-0000-0000-0000-000000000c02'
              AND status = 'active'), 1,
  'assigning on the contact record creates an active relationship in that tenant');

-- 7. Assigning a non-member on a contact record is refused, not silently half-done.
SELECT throws_ok($q$
  UPDATE public.clients SET assigned_coach_user_id = 'a5500000-0000-0000-0000-0000000005b1'
   WHERE id = 'a5500000-0000-0000-0000-00000000c1e1'$q$,
  '23514', NULL, 'assigning someone who does not qualify in the tenant is refused');

-- 8–10. Losing membership suspends; regaining it restores.
UPDATE public.tenant_members SET status = 'revoked'
 WHERE tenant_id = 'a5500000-0000-0000-0000-00000000000a' AND user_id = 'a5500000-0000-0000-0000-0000000005a1';
SELECT is((SELECT count(*)::int FROM public.coach_clients
            WHERE coach_user_id = 'a5500000-0000-0000-0000-0000000005a1' AND status = 'active'), 0,
  'a revoked member holds no active relationship');
SELECT is((SELECT count(*)::int FROM public.coach_clients
            WHERE coach_user_id = 'a5500000-0000-0000-0000-0000000005a1' AND status = 'suspended'), 2,
  'their relationships are suspended, not deleted');
UPDATE public.tenant_members SET status = 'active'
 WHERE tenant_id = 'a5500000-0000-0000-0000-00000000000a' AND user_id = 'a5500000-0000-0000-0000-0000000005a1';
SELECT is((SELECT count(*)::int FROM public.coach_clients
            WHERE coach_user_id = 'a5500000-0000-0000-0000-0000000005a1' AND status = 'active'), 2,
  'reinstatement restores the suspended relationships');

-- 11–12. The helper's assignment branch honours the same rule.
INSERT INTO public.paige_coach_assignments (contact_id, assigned_role, rep_user_id, active, tenant_id)
VALUES ('a5500000-0000-0000-0000-00000000c1e1', 'capital_strategist',
        'a5500000-0000-0000-0000-0000000005b1', true, 'a5500000-0000-0000-0000-00000000000a');
SELECT is(public.coach_can_access_user('a5500000-0000-0000-0000-0000000005b1',
                                       'a5500000-0000-0000-0000-000000000c01'), false,
  'an assignment to someone who does not qualify in the client''s tenant grants nothing');
SELECT is(public.coach_can_access_user('a5500000-0000-0000-0000-0000000005a1',
                                       'a5500000-0000-0000-0000-000000000c01'), true,
  'a qualifying assignee keeps access');

-- 13. Nothing outside the assignment path writes relationships.
SELECT is((SELECT count(*)::int FROM pg_policy
            WHERE polrelid = 'public.coach_clients'::regclass AND polcmd IN ('a', 'w', 'd', '*')), 0,
  'no policy lets a signed-in user write relationships directly');

-- 14–15. An invitation is visible to an assignee only within the assignment's tenant.
-- An assignee holds no staff role here: the assignment and the business are the whole of the grant.
INSERT INTO public.invitations (email, invited_by, tenant_id) VALUES
  ('as-client-x@example.test', 'a5500000-0000-0000-0000-0000000005a1', 'a5500000-0000-0000-0000-00000000000a'),
  ('as-client-x@example.test', 'a5500000-0000-0000-0000-0000000005b1', 'a5500000-0000-0000-0000-00000000000b');
SELECT set_config('request.jwt.claims',
  '{"sub":"a5500000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$
DECLARE _own int; _other int;
BEGIN
  SELECT count(*) INTO _own FROM public.invitations
   WHERE email = 'as-client-x@example.test' AND tenant_id = 'a5500000-0000-0000-0000-00000000000a';
  SELECT count(*) INTO _other FROM public.invitations
   WHERE email = 'as-client-x@example.test' AND tenant_id = 'a5500000-0000-0000-0000-00000000000b';
  PERFORM set_config('as_scope.own', _own::text, true);
  PERFORM set_config('as_scope.other', _other::text, true);
END $$;
RESET ROLE;
SELECT is(current_setting('as_scope.own')::int, 1,
  'an assignee sees the invitation in their own tenant');
SELECT is(current_setting('as_scope.other')::int, 0,
  'and not a matching invitation in another tenant');

-- 16. Removing the client's link removes the relationship with it (structural).
DELETE FROM public.clients WHERE id = 'a5500000-0000-0000-0000-00000000c1e2';
SELECT is((SELECT count(*)::int FROM public.coach_clients
            WHERE client_user_id = 'a5500000-0000-0000-0000-000000000c02'), 0,
  'deleting the client record removes the relationship');

SELECT * FROM finish();
ROLLBACK;
