-- ============================================================================
-- Staff name resolution: only what callers show, read-only, inside the business.
--
-- Proves, for the projection staff surfaces use to show another person's name: it carries only the
-- six columns its callers read; signed-in users may read it and do nothing else; signed-out
-- callers hold nothing on it; a business's staff see that business's people and not another's; a
-- person with no staff role sees only themselves; an assigned staff member sees the person assigned
-- to them only while working in the business the assignment belongs to; its gate is evaluated before
-- any condition a caller supplies; and a write through it is
-- refused.
--
-- Synthetic fixtures only. Asserts counts, privileges and refusals, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(11);

-- Function grants exactly as production holds them for `authenticated`, so the gate is evaluated
-- here as it is there.
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id(), public.has_role(uuid, public.app_role),
  public.is_platform_owner(), public.is_platform_owner(uuid)
TO authenticated;

DO $$
DECLARE
  _a uuid := 'a5540000-0000-0000-0000-00000000000a';
  _b uuid := 'a5540000-0000-0000-0000-00000000000b';
  _adm uuid := 'a5540000-0000-0000-0000-0000000000a1';  -- admin of A, holds the global admin role
  _ma uuid := 'a5540000-0000-0000-0000-0000000000a2';   -- member of A, no staff role
  _mb uuid := 'a5540000-0000-0000-0000-0000000000b2';   -- member of B
  _s uuid := 'a5540000-0000-0000-0000-0000000000c1';    -- member of A and of B, assigned to Z in B
  _z uuid := 'a5540000-0000-0000-0000-000000000e01';    -- a client of B, with no active business
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (_adm, 'ccp-admin-a@example.test'), (_ma, 'ccp-member-a@example.test'),
    (_mb, 'ccp-member-b@example.test'), (_s, 'ccp-assignee@example.test'),
    (_z, 'ccp-client-z@example.test');
  INSERT INTO public.tenants (id, slug, name, status, account_type, account_number_prefix, features) VALUES
    (_a, 'ccp-scope-a', 'CCP Scope A', 'active', 'standalone', 'CPA', '{}'),
    (_b, 'ccp-scope-b', 'CCP Scope B', 'active', 'standalone', 'CPB', '{}');
  INSERT INTO public.tenant_members (tenant_id, user_id, role, status, is_owner) VALUES
    (_a, _adm, 'admin', 'active', false),
    (_a, _ma, 'member', 'active', false),
    (_b, _mb, 'member', 'active', false),
    (_a, _s, 'member', 'active', false), (_b, _s, 'member', 'active', false);
  INSERT INTO public.user_roles (user_id, role) VALUES (_adm, 'admin') ON CONFLICT DO NOTHING;
  INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
    (_adm, _a), (_ma, _a), (_mb, _b), (_s, _a), (_z, NULL)
  ON CONFLICT (user_id) DO UPDATE SET active_tenant_id = EXCLUDED.active_tenant_id;
  INSERT INTO public.clients (id, tenant_id, created_by, first_name, last_name, account_number, linked_user_id) VALUES
    ('a5540000-0000-0000-0000-00000000c1e1', _b, _mb, 'Z', 'Client', 'CPZ-1', _z);
  INSERT INTO public.coach_clients (tenant_id, coach_user_id, client_user_id, status) VALUES
    (_b, _s, _z, 'active');
END $$;

-- Counts of fixture people each caller can see, read as that caller.
CREATE TEMP TABLE ccp_fixture (user_id uuid) ON COMMIT DROP;
INSERT INTO ccp_fixture VALUES
  ('a5540000-0000-0000-0000-0000000000a1'), ('a5540000-0000-0000-0000-0000000000a2'),
  ('a5540000-0000-0000-0000-0000000000b2'), ('a5540000-0000-0000-0000-0000000000c1'),
  ('a5540000-0000-0000-0000-000000000e01');
GRANT SELECT ON ccp_fixture TO authenticated;

CREATE FUNCTION pg_temp.ccp_seen(_who uuid, _which uuid[]) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE _n bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _who, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  SELECT count(*) INTO _n FROM public.coach_client_profiles_safe v
   WHERE v.user_id = ANY (_which) AND v.user_id IN (SELECT user_id FROM ccp_fixture);
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
  RETURN _n;
END $$;

-- 1. The projection carries only the columns its callers read.
SELECT is(
  (SELECT array_agg(column_name::text ORDER BY ordinal_position) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'coach_client_profiles_safe'),
  ARRAY['id', 'user_id', 'full_name', 'avatar_url', 'suspended_at', 'suspended_reason'],
  'the projection carries only the six columns its callers read');

-- 2-3. Signed-in users read it and do nothing else.
SELECT ok(has_table_privilege('authenticated', 'public.coach_client_profiles_safe', 'SELECT'),
  'signed-in users can read the projection');
SELECT ok(NOT (has_table_privilege('authenticated', 'public.coach_client_profiles_safe', 'INSERT')
            OR has_table_privilege('authenticated', 'public.coach_client_profiles_safe', 'UPDATE')
            OR has_table_privilege('authenticated', 'public.coach_client_profiles_safe', 'DELETE')
            OR has_table_privilege('authenticated', 'public.coach_client_profiles_safe', 'TRUNCATE')
            OR has_any_column_privilege('authenticated', 'public.coach_client_profiles_safe', 'INSERT')
            OR has_any_column_privilege('authenticated', 'public.coach_client_profiles_safe', 'UPDATE')),
  'signed-in users cannot write through the projection');

-- 4. Signed-out callers hold nothing on it.
SELECT ok(NOT (has_table_privilege('anon', 'public.coach_client_profiles_safe', 'SELECT')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'INSERT')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'UPDATE')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'DELETE')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'TRUNCATE')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'REFERENCES')
            OR has_table_privilege('anon', 'public.coach_client_profiles_safe', 'TRIGGER')
            OR has_any_column_privilege('anon', 'public.coach_client_profiles_safe', 'SELECT')
            OR has_any_column_privilege('anon', 'public.coach_client_profiles_safe', 'INSERT')
            OR has_any_column_privilege('anon', 'public.coach_client_profiles_safe', 'UPDATE')),
  'signed-out callers hold nothing on the projection');

-- 5-6. A business's admin sees that business's people, and no one from another business.
SELECT is(pg_temp.ccp_seen('a5540000-0000-0000-0000-0000000000a1',
  ARRAY['a5540000-0000-0000-0000-0000000000a1', 'a5540000-0000-0000-0000-0000000000a2',
        'a5540000-0000-0000-0000-0000000000c1']::uuid[]), 3::bigint,
  'an admin sees the people working in their business');
SELECT is(pg_temp.ccp_seen('a5540000-0000-0000-0000-0000000000a1',
  ARRAY['a5540000-0000-0000-0000-0000000000b2', 'a5540000-0000-0000-0000-000000000e01']::uuid[]), 0::bigint,
  'an admin sees no one from another business');

-- 7. A person with no staff role sees only themselves.
SELECT is(pg_temp.ccp_seen('a5540000-0000-0000-0000-0000000000a2',
  (SELECT array_agg(user_id) FROM ccp_fixture)), 1::bigint,
  'a person with no staff role sees only themselves');

-- 8. An assigned staff member working in another business does not see the assigned person.
SELECT is(pg_temp.ccp_seen('a5540000-0000-0000-0000-0000000000c1',
  ARRAY['a5540000-0000-0000-0000-000000000e01']::uuid[]), 0::bigint,
  'an assigned staff member working in another business does not see the assigned person');

-- 9. Working in the assignment's business, they do — even though the person has no active business.
UPDATE public.profiles SET active_tenant_id = 'a5540000-0000-0000-0000-00000000000b'
 WHERE user_id = 'a5540000-0000-0000-0000-0000000000c1';
SELECT is(pg_temp.ccp_seen('a5540000-0000-0000-0000-0000000000c1',
  ARRAY['a5540000-0000-0000-0000-000000000e01']::uuid[]), 1::bigint,
  'an assigned staff member working in the assignment''s business sees the assigned person');

-- 10. The gate is evaluated before any condition a caller supplies.
SELECT ok(coalesce((SELECT 'security_barrier=true' = ANY (reloptions) FROM pg_class
                     WHERE oid = 'public.coach_client_profiles_safe'::regclass), false),
  'the projection''s gate is evaluated before any condition a caller supplies');

-- 11. A write through the projection is refused.
SELECT set_config('request.jwt.claims', '{"sub":"a5540000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
SET LOCAL ROLE authenticated;
SELECT throws_ok(
  $$UPDATE public.coach_client_profiles_safe SET full_name = full_name
     WHERE user_id = 'a5540000-0000-0000-0000-0000000000a2'$$,
  '42501', NULL, 'a write through the projection is refused');
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
