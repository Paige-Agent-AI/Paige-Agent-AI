-- ============================================================================
-- Client memory belongs to exactly one tenant.
--
-- Proves, for the memory Paige reads back into future conversations: every row carries the tenant
-- it was written in; a tenant's admins and assigned staff see that tenant's rows and no other's,
-- even when the person the memory is about also belongs to another tenant; a global role with no
-- tenant grants nothing on its own; the tenant is filled from the client record or the writer's
-- active tenant, is refused when neither exists, cannot be set to a tenant the row does not
-- belong to, and cannot be changed afterwards.
--
-- Synthetic fixtures only. Asserts counts and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(12);

-- Production grants `authenticated` these privileges; a schema replayed from migrations does not.
-- Reproduced inside the rolled-back transaction so the reads exercise the policies.
GRANT SELECT, INSERT, UPDATE ON public.client_memory TO authenticated;
GRANT SELECT ON public.clients, public.tenant_members, public.coach_clients TO authenticated;
-- Function grants exactly as production holds them for `authenticated` — no more, so a policy that
-- calls a function production withholds fails here as it would there.
GRANT EXECUTE ON FUNCTION public.is_tenant_admin(uuid), public.agency_can_manage_child(uuid),
  public.agency_team_role(uuid, uuid), public.current_user_tenant_id(), public.has_role(uuid, public.app_role),
  public.is_platform_admin(), public.is_platform_admin(uuid), public.is_platform_operator(),
  public.is_platform_owner(), public.is_platform_owner(uuid), public.is_super_admin(), public.is_super_admin(uuid)
TO authenticated;

DO $$
DECLARE
  _a uuid := 'a5510000-0000-0000-0000-00000000000a';
  _b uuid := 'a5510000-0000-0000-0000-00000000000b';
  _sa uuid := 'a5510000-0000-0000-0000-0000000005a1';  -- member of A
  _ab uuid := 'a5510000-0000-0000-0000-0000000000b1';  -- admin of B, also holds the global admin role
  _ca uuid := 'a5510000-0000-0000-0000-0000000000c1';  -- member of A, assigned to Y in A
  _x uuid := 'a5510000-0000-0000-0000-000000000e01';   -- member of A and of B
  _y uuid := 'a5510000-0000-0000-0000-000000000e02';   -- member of A and of B, and a client in A
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_sa, 'cm-member-a@example.test'), (_ab, 'cm-admin-b@example.test'),
    (_ca, 'cm-assignee-a@example.test'), (_x, 'cm-person-x@example.test'),
    (_y, 'cm-person-y@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'cm-scope-a', 'CM Scope A', 'active', 'standalone', 'CMA', '{}'),
    (_b, 'cm-scope-b', 'CM Scope B', 'active', 'standalone', 'CMB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _sa, 'member', 'active', false),
    (_b, _ab, 'admin', 'active', false),
    (_a, _ca, 'member', 'active', false),
    (_a, _x, 'member', 'active', false), (_b, _x, 'member', 'active', false),
    (_a, _y, 'member', 'active', false), (_b, _y, 'member', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES (_ab, 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
    (_sa, _a), (_ab, _b), (_ca, _a), (_x, _a), (_y, _b)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('a5510000-0000-0000-0000-00000000c1e1', _a, _ca, 'Y', 'Client', 'CMY-1', _y);
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status) VALUES
    (_a, _ca, _y, 'active');
END $$;

-- Rows are written the way the platform writes them: by the person in their active tenant, or
-- against a client record. None names a tenant directly.
SELECT set_config('request.jwt.claims', '{"sub":"a5510000-0000-0000-0000-000000000e01","role":"authenticated"}', true);
INSERT INTO public.client_memory (client_user_id, memory_type, content)                 -- R1: X, in A
VALUES ('a5510000-0000-0000-0000-000000000e01', 'coach_note', 'cm-r1');
SELECT set_config('request.jwt.claims', '{"sub":"a5510000-0000-0000-0000-000000000e02","role":"authenticated"}', true);
INSERT INTO public.client_memory (client_user_id, memory_type, content)                 -- R2: Y, in B
VALUES ('a5510000-0000-0000-0000-000000000e02', 'coach_note', 'cm-r2');
SELECT set_config('request.jwt.claims', '', true);
INSERT INTO public.client_memory (client_user_id, client_id, memory_type, content)      -- R3: Y, in A
VALUES ('a5510000-0000-0000-0000-000000000e02', 'a5510000-0000-0000-0000-00000000c1e1', 'coach_note', 'cm-r3');

-- Counts are read as each person, stored, then asserted after RESET ROLE.
SELECT set_config('request.jwt.claims', '{"sub":"a5510000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cm.admin_b_r1', (SELECT count(*) FROM public.client_memory WHERE content = 'cm-r1')::text, true);
  PERFORM set_config('cm.admin_b_r2', (SELECT count(*) FROM public.client_memory WHERE content = 'cm-r2')::text, true);
END $$;
RESET ROLE;

SELECT set_config('request.jwt.claims', '{"sub":"a5510000-0000-0000-0000-0000000000c1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  PERFORM set_config('cm.assignee_a_r2', (SELECT count(*) FROM public.client_memory WHERE content = 'cm-r2')::text, true);
  PERFORM set_config('cm.assignee_a_r3', (SELECT count(*) FROM public.client_memory WHERE content = 'cm-r3')::text, true);
END $$;
RESET ROLE;
SELECT set_config('request.jwt.claims', '', true);

-- 1–2. A tenant's admin, who also holds a global admin role, sees their own tenant's memory and
--      not another tenant's, even about a person who belongs to both.
SELECT is(current_setting('cm.admin_b_r1')::int, 0,
  'an admin of another tenant does not see this tenant''s memory');
SELECT is(current_setting('cm.admin_b_r2')::int, 1,
  'an admin sees their own tenant''s memory');

-- 3–4. Assigned staff see the assigned client's memory in their tenant, not the same person's
--      memory in another tenant.
SELECT is(current_setting('cm.assignee_a_r2')::int, 0,
  'an assignee does not see the same person''s memory held by another tenant');
SELECT is(current_setting('cm.assignee_a_r3')::int, 1,
  'an assignee sees the assigned client''s memory in their tenant');

-- 5–6. The tenant is part of the row.
SELECT has_column('public', 'client_memory', 'tenant_id', 'a memory records its tenant');
SELECT col_not_null('public', 'client_memory', 'tenant_id', 'and cannot exist without one');

-- 7. Each row took the tenant it was written in.
SELECT is((SELECT count(*)::int FROM public.client_memory
            WHERE (content = 'cm-r1' AND tenant_id = 'a5510000-0000-0000-0000-00000000000a')
               OR (content = 'cm-r2' AND tenant_id = 'a5510000-0000-0000-0000-00000000000b')
               OR (content = 'cm-r3' AND tenant_id = 'a5510000-0000-0000-0000-00000000000a')), 3,
  'memory takes its tenant from the client record or the writer''s active tenant');

-- 8. With neither a client record nor a signed-in writer, there is no tenant to take.
SELECT throws_ok($q$
  INSERT INTO public.client_memory (client_user_id, memory_type, content)
  VALUES ('a5510000-0000-0000-0000-000000000e01', 'coach_note', 'cm-unresolved')$q$,
  '23514', NULL, 'a memory with no resolvable tenant is refused');

-- 9. A tenant that is not the client record's is refused.
SELECT throws_ok($q$
  INSERT INTO public.client_memory (tenant_id, client_user_id, client_id, memory_type, content)
  VALUES ('a5510000-0000-0000-0000-00000000000b', 'a5510000-0000-0000-0000-000000000e02',
          'a5510000-0000-0000-0000-00000000c1e1', 'coach_note', 'cm-mismatch')$q$,
  '23514', NULL, 'a memory cannot name a tenant other than its client record''s');

-- 10. A memory about someone who does not belong to the named tenant is refused.
SELECT throws_ok($q$
  INSERT INTO public.client_memory (tenant_id, client_user_id, memory_type, content)
  VALUES ('a5510000-0000-0000-0000-00000000000b', 'a5510000-0000-0000-0000-0000000005a1',
          'coach_note', 'cm-foreign')$q$,
  '23514', NULL, 'a memory cannot be placed in a tenant its subject does not belong to');

-- 11. The tenant cannot be changed after the fact.
SELECT throws_ok($q$
  UPDATE public.client_memory SET tenant_id = 'a5510000-0000-0000-0000-00000000000b'
   WHERE content = 'cm-r1'$q$,
  '23514', NULL, 'a memory''s tenant cannot be changed');

-- 12. A signed-in writer cannot place a memory in a tenant they do not act in.
-- The subject belongs to B; only the writer does not.
SELECT set_config('request.jwt.claims', '{"sub":"a5510000-0000-0000-0000-0000000005a1","role":"authenticated"}', true);
SELECT throws_ok($q$
  INSERT INTO public.client_memory (tenant_id, client_user_id, memory_type, content)
  VALUES ('a5510000-0000-0000-0000-00000000000b', 'a5510000-0000-0000-0000-000000000e01',
          'coach_note', 'cm-stamp')$q$,
  '23514', NULL, 'a signed-in writer cannot stamp a memory with a tenant they do not act in');
SELECT set_config('request.jwt.claims', '', true);

SELECT * FROM finish();
ROLLBACK;
