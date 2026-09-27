-- ============================================================================
-- Nothing in the database reads the retired title role.
--
-- "Coach" is a title a business gives its people, never a role. This reads the LIVE catalogue of the
-- rebuilt database, not migration source, so it also judges the function bodies 20270504000000
-- rewrote at run time: every function, procedure, policy and view, in every schema, is searched for
-- the four shapes a role read takes — the value cast to a role type, a role helper called with it, a
-- role column compared to it (=, IN, = ANY, IS DISTINCT FROM), and it inside a role-typed array.
--
-- The value is still allowed where it is data and not a role: a conversation lens, an assignment
-- seat label, a message sender type, an assigned-role label. Those shapes are not role reads and are
-- proven quiet below.
--
-- Named exemptions, each with its reason:
--   * refusals — they read the value only to refuse it: accept_invitation, change_user_role,
--     grant_tenant_member_role;
--   * removal paths — they read the value only to delete it: admin_remove_coach_role,
--     revoke_platform_access (both), revoke_tenant_member_role. They go when the last rows holding
--     the value are deleted.
--
-- Synthetic fixtures only. Asserts object names and counts, never field values. Rolls back.
-- ============================================================================
BEGIN;

SELECT plan(9);

CREATE FUNCTION pg_temp.retired_role_reads() RETURNS SETOF text LANGUAGE sql STABLE AS $fn$
  WITH src AS (
    SELECT 'function ' || p.oid::regprocedure::text AS what, pg_get_functiondef(p.oid) AS body
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE p.prokind IN ('f', 'p')
       AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\_%'
    UNION ALL
    SELECT 'policy ' || schemaname || '.' || tablename || ' ' || policyname,
           coalesce(qual, '') || ' ' || coalesce(with_check, '')
      FROM pg_policies
    UNION ALL
    SELECT 'view ' || schemaname || '.' || viewname, definition
      FROM pg_views WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
    UNION ALL
    SELECT 'view ' || schemaname || '.' || matviewname, definition FROM pg_matviews
  )
  SELECT what FROM src
   WHERE body ~* ($re$'coach'\s*::\s*(public\.)?(app_role|tenant_role)$re$
               || '|' || $re$has_(any_|tenant_)?role\s*\([^;]*'coach'$re$
               || '|' || $re$(^|[^\w.])(\w+\.)?role\)?(::\w+)?\)?\s*(=|<>|!=|not\s+in|in|is\s+(not\s+)?distinct\s+from|=\s*any|<>\s*all)\s*\(?[^;)]*'coach'$re$
               || '|' || $re$'coach'[^;]*\]\s*::\s*(public\.)?(app_role|tenant_role)\[\]$re$)
$fn$;

CREATE TEMP TABLE retired_role_exempt(what text PRIMARY KEY, why text NOT NULL);
INSERT INTO retired_role_exempt VALUES
  ('function accept_invitation(text,uuid)', 'refuses an invitation carrying the value'),
  ('function change_user_role(uuid,app_role,app_role,uuid,text)', 'refuses a change to the value'),
  ('function grant_tenant_member_role(uuid,app_role,uuid,text)', 'refuses a grant of the value'),
  ('function admin_remove_coach_role(uuid)', 'deletes rows holding the value; goes with the last of them'),
  ('function revoke_platform_access(uuid)', 'deletes rows holding the value; goes with the last of them'),
  ('function revoke_platform_access(uuid,text)', 'deletes rows holding the value; goes with the last of them'),
  ('function revoke_tenant_member_role(uuid,app_role,uuid,text)', 'deletes rows holding the value; goes with the last of them');

-- 1. Nothing outside the named exemptions reads the retired role.
SELECT is((SELECT coalesce(string_agg(r, '; ' ORDER BY r), '')
             FROM pg_temp.retired_role_reads() r
            WHERE r NOT IN (SELECT what FROM retired_role_exempt)),
  '', 'no function, procedure, policy or view outside the named exemptions reads the retired title role');

-- 2. Every exemption is still live and still reads the value, so the list can only shrink.
SELECT is((SELECT coalesce(string_agg(what, '; ' ORDER BY what), '')
             FROM retired_role_exempt
            WHERE what NOT IN (SELECT r FROM pg_temp.retired_role_reads() r)),
  '', 'every named exemption is still a live reader of the value');

-- 3-7. The search catches each shape a role read takes (it bites).
CREATE FUNCTION public.rrn_cast() RETURNS boolean LANGUAGE sql AS
  $$ SELECT public.has_role(auth.uid(), 'coach'::public.app_role) $$;
CREATE FUNCTION public.rrn_any_role() RETURNS boolean LANGUAGE sql AS
  $$ SELECT public.has_any_role(auth.uid(), ARRAY['admin', 'coach']) $$;
CREATE FUNCTION public.rrn_column() RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role::text = 'coach') $$;
CREATE FUNCTION public.rrn_seat_any() RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.tenant_members tm WHERE tm.user_id = auth.uid()
                     AND tm.role = ANY (ARRAY['owner', 'coach']::public.tenant_role[])) $$;
CREATE VIEW public.rrn_view AS
  SELECT tm.user_id FROM public.tenant_members tm WHERE tm.role::text IN ('owner', 'coach');

SELECT ok('function rrn_cast()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a role helper called with the value cast to a role type is caught');
SELECT ok('function rrn_any_role()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a role helper called with the value in a list is caught');
SELECT ok('function rrn_column()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a role column compared to the value is caught');
SELECT ok('function rrn_seat_any()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a seat compared to the value inside a role-typed array is caught');
SELECT ok('view public.rrn_view' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a view comparing a seat to the value is caught');

-- 8. The value as data, not a role, is not a read: a lens, a seat label, a sender type, an assigned-role label.
CREATE FUNCTION public.rrn_data(_contact uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.paige_chat_threads t WHERE t.lens = 'coach')
      OR public.is_assigned_to_client(auth.uid(), _contact, 'coach')
      OR EXISTS (SELECT 1 FROM public.program_messages m WHERE m.sender_type = 'coach')
      OR EXISTS (SELECT 1 FROM public.paige_coach_assignments a WHERE a.assigned_role IN ('coach', 'coach_vip'))
$$;
SELECT ok('function rrn_data(uuid)' NOT IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'the value used as data — a lens, a seat label, a sender type, an assigned-role label — is not a role read');

-- 9. The staff name projection gates on the business, never on the retired role.
SELECT unlike(pg_get_viewdef('public.coach_client_profiles_safe'::regclass), '%''coach''%',
  'the staff name projection does not read the retired role');

SELECT * FROM finish();
ROLLBACK;
