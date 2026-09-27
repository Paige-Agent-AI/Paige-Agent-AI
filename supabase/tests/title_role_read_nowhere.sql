-- ============================================================================
-- Nothing in the database reads the retired title role.
--
-- "Coach" is a title a business gives its people, never a role. This reads the LIVE catalogue of the
-- rebuilt database, not migration source, so it also judges the function bodies 20270504000000
-- rewrote at run time: every function, procedure, policy and view, in every schema, is searched for
-- the shapes a role read takes — the value cast to a role type; a role helper called with it; a role
-- column or a role variable (v_…role) compared to it (=, IN, = ANY, LIKE, IS DISTINCT FROM), either
-- way round, through casts and the parentheses Postgres adds when it stores a view or policy; it in
-- an array or array literal of roles; and a CASE over a role with a branch for it.
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

SELECT plan(16);

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
   -- The search below is character-for-character SQL_RETIRED_ROLE_SOURCE in
   -- scripts/ci/title-authority-guard.mjs; the guard fails if the two drift apart.
   WHERE body ~* $re$'coach'(?:\s*::\s*\w+)*\s*::\s*(?:public\.)?(?:app_role|tenant_role)(?![\w])|has_(?:any_|tenant_)?role\s*\((?:[^;()]|\([^()]*\))*'coach'|(?:^|[^\w.])\(?\s*(?:\w+\.)?"?(?:v_\w*)?role"?\s*\)?(?:\s*::\s*[\w.]+)?\s*\)?\s*(?:=\s*any|<>\s*all|=|<>|!=|not\s+in(?![\w])|in(?![\w])|not\s+i?like(?![\w])|i?like(?![\w])|is\s+(?:not\s+)?distinct\s+from)\s*\(?\s*(?:array\s*\[\s*)?(?:'[^']*'(?:\s*::\s*[\w.]+(?:\[\])?)*\s*,\s*)*'coach'|'coach'(?:\s*::\s*[\w.]+)*\s*(?:=|<>|!=)\s*\(?\s*(?:\w+\.)?"?(?:v_\w*)?role"?(?![\w])|'\{[^'}]*(?<![\w])coach(?![\w])[^'}]*\}'\s*::\s*(?:public\.)?(?:app_role|tenant_role)\[\]|(?:^|[^\w.])\(?\s*(?:\w+\.)?"?(?:v_\w*)?role"?\s*\)?(?:\s*::\s*[\w.]+)?\s*\)?\s*(?:=\s*any|<>\s*all)\s*\(\s*'\{[^'}]*(?<![\w])coach(?![\w])|case\s+(?:\w+\.)?"?\w*role"?\s+(?:when\s+(?:(?!end(?![\w]))[^;])*?)?when\s+(?:'[^']*'(?:\s*::\s*[\w.]+(?:\[\])?)*\s*,\s*)*'coach'$re$
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

-- 8-13. The shapes Postgres stores differently from how they are written, and the plpgsql shapes.
CREATE FUNCTION public.rrn_variable() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  SELECT ur.role INTO v_role FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1;
  RETURN v_role IS DISTINCT FROM 'coach';
END $$;
CREATE FUNCTION public.rrn_case(_tenant_role public.tenant_role) RETURNS int LANGUAGE sql AS
  $$ SELECT CASE _tenant_role WHEN 'owner' THEN 3 WHEN 'coach' THEN 1 END $$;
CREATE FUNCTION public.rrn_array_literal() RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.role = ANY ('{admin,coach}')) $$;
CREATE FUNCTION public.rrn_reversed() RETURNS boolean LANGUAGE sql AS
  $$ SELECT EXISTS (SELECT 1 FROM public.user_roles ur WHERE 'coach' = ur.role) $$;
CREATE POLICY rrn_policy ON public.user_roles USING (role::text = 'coach');
CREATE VIEW public.rrn_view_literal AS
  SELECT ur.user_id FROM public.user_roles ur WHERE ur.role = ANY ('{admin,coach}');

SELECT ok('function rrn_variable()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a role held in a variable and compared to the value is caught');
SELECT ok('function rrn_case(tenant_role)' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a CASE over a seat with a branch for the value is caught');
SELECT ok('function rrn_array_literal()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a role compared to an array literal holding the value is caught');
SELECT ok('function rrn_reversed()' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'the comparison written the other way round is caught');
SELECT ok('policy public.user_roles rrn_policy' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a policy casting the role to text, as Postgres stores it, is caught');
SELECT ok('view public.rrn_view_literal' IN (SELECT r FROM pg_temp.retired_role_reads() r),
  'a view comparing a role to an array literal, as Postgres stores it, is caught');

-- 14. The value as data, not a role, is not a read: a lens, a seat label, a sender type, an assigned-role label,
-- and a function that reads a role and names the value only as a lens.
CREATE FUNCTION public.rrn_data(_contact uuid) RETURNS boolean LANGUAGE sql AS $$
  SELECT EXISTS (SELECT 1 FROM public.paige_chat_threads t WHERE t.lens = 'coach')
      OR public.is_assigned_to_client(auth.uid(), _contact, 'coach')
      OR EXISTS (SELECT 1 FROM public.program_messages m WHERE m.sender_type = 'coach')
      OR EXISTS (SELECT 1 FROM public.paige_coach_assignments a WHERE a.assigned_role IN ('coach', 'coach_vip'))
$$;
CREATE FUNCTION public.rrn_data_into() RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_role text;
BEGIN
  SELECT tm.role INTO v_role FROM public.tenant_members tm
    JOIN public.paige_chat_threads t ON t.caller_user_id = tm.user_id WHERE t.lens = 'coach';
END $$;
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_temp.retired_role_reads() r WHERE r IN ('function rrn_data(uuid)', 'function rrn_data_into()')),
  'the value used as data — a lens, a seat label, a sender type, an assigned-role label — is not a role read');

-- 15. The staff name projection gates on the business, never on the retired role.
SELECT ok(pg_get_viewdef('public.coach_client_profiles_safe'::regclass) !~ '''coach''',
  'the staff name projection does not read the retired role');

-- 16. The seat mapping keeps every seat a membership may hold.
SELECT is(ARRAY[public.map_tenant_role_to_app_role('owner'), public.map_tenant_role_to_app_role('admin'),
                public.map_tenant_role_to_app_role('member')]::text[],
  ARRAY['admin', 'admin', 'user'], 'the seat mapping still maps every seat a membership may hold');

SELECT * FROM finish();
ROLLBACK;
