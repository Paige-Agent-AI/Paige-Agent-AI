-- ============================================================================
-- EXP07 row 6 — repeatable proof for 20271113800010_studio_session_template_flag.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The platform helpers the function reads (studio_role_ok,
-- is_tenant_admin, current_user_tenant_id and their closure) are production's bodies as migration_d
-- carries them (pg_get_functiondef, 2026-10-04), so the authority answers here are the ones
-- production would give. auth.uid()/auth.role() read session settings (test.uid / test.role), as
-- Supabase's own helpers read the JWT claims.
--
-- What it proves about public.set_studio_session_template(uuid, boolean, uuid):
--   1. The flag flips and unflips: the creator flags their own project, the returned row carries
--      is_template, the row really changed, and clearing it restores it.
--   2. The role gate: a plain member without a workspace owner/admin/coach role is refused
--      (STUDIO_FORBIDDEN); a global coach passes the gate but, on a project they don't own in a
--      workspace they don't admin, is refused by the owner-or-admin predicate (STUDIO_NOT_FOUND);
--      a workspace admin can template someone else's project.
--   3. The tenant wall: another workspace's owner naming this workspace's session gets
--      STUDIO_NOT_FOUND (never swapped, never changed); the row is untouched.
--   4. The service path: without a tenant, STUDIO_NO_TENANT; with an explicit tenant it works
--      (auth.uid() NULL bypasses the owner predicate by design, like set_studio_session_starred).
--   5. Privileges: anon and PUBLIC cannot execute; authenticated and service_role can.
--   6. Shape: SECURITY DEFINER, search_path = public, RETURNS studio_sessions, plpgsql — exactly
--      the family's shape; and it is the ONLY new object the migration creates.
--   7. Mutation proofs: the role gate, the owner-or-admin predicate and the tenant wall, each
--      broken on purpose inside a rolled-back subtransaction, make the matching probe answer
--      differently — so the checks above can fail.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'studio_session_template_flag_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated studio_session_template_flag_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── auth stubs ───────────────────────────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

-- ── Production column shapes (as migration_d carries them) ───────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE public.app_role AS ENUM ('admin','super_admin','platform_admin','coach','client');
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY, parent_tenant_id uuid, account_type text NOT NULL DEFAULT 'standalone',
  features jsonb NOT NULL DEFAULT '{}'::jsonb, slug text);
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);

CREATE TABLE IF NOT EXISTS public.studio_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  title text NOT NULL DEFAULT 'Untitled project',
  seed_brief text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','building','published','archived')),
  starred boolean NOT NULL DEFAULT false,
  thumbnail_url text,
  transcript jsonb NOT NULL DEFAULT '[]'::jsonb,
  artifact_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_template boolean NOT NULL DEFAULT false,
  last_opened_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ── Platform helpers: production bodies (as migration_d_studio_authority.sql carries them) ────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_super_admin(_user_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $$;
CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT public.is_super_admin() OR public.is_platform_admin(auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.parent_tenant_id IS NULL
     AND t.account_type = 'standalone' AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)); $$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = ANY (_roles)); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active')
   OR (public.is_company_workspace(_tenant) AND public.is_platform_operator()); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin'))
   OR (public.is_company_workspace(_tenant) AND public.is_platform_operator()); $$;
CREATE OR REPLACE FUNCTION public.agency_team_role(_agency uuid, _actor uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT CASE
    WHEN EXISTS (SELECT 1 FROM public.tenant_members m WHERE m.tenant_id = _agency AND m.user_id = _actor AND m.status = 'active' AND m.role = 'owner')
      THEN 'agency_owner'
    ELSE (SELECT atm.agency_role FROM public.agency_team_members atm
            WHERE atm.agency_tenant_id = _agency AND atm.user_id = _actor AND atm.status = 'active' LIMIT 1)
  END $$;
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid, _actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT
    EXISTS (SELECT 1 FROM public.tenants child
      JOIN public.tenants parent    ON parent.id = child.parent_tenant_id
      JOIN public.tenant_members pm ON pm.tenant_id = parent.id AND pm.user_id = _actor
      WHERE child.id = _child AND parent.account_type IN ('agency', 'enterprise')
        AND pm.status = 'active' AND pm.role = 'owner')
    OR EXISTS (SELECT 1 FROM public.agency_team_members atm
      JOIN public.tenants child ON child.id = atm.scoped_subaccounts[1]
      WHERE atm.agency_tenant_id = _child AND atm.user_id = _actor AND atm.status = 'active') $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT COALESCE(
    (SELECT p.active_tenant_id FROM public.profiles p
       WHERE p.user_id = auth.uid() AND p.active_tenant_id IS NOT NULL
         AND (EXISTS (SELECT 1 FROM public.tenant_members m
                       WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')
              OR public.agency_can_manage_child(p.active_tenant_id, auth.uid())
              OR public.agency_team_role(p.active_tenant_id, auth.uid()) IS NOT NULL
              OR public.is_platform_admin(auth.uid()))),
    (SELECT tenant_id FROM public.tenant_members WHERE user_id = auth.uid() AND status = 'active'
       ORDER BY joined_at ASC LIMIT 1)); $$;
CREATE OR REPLACE FUNCTION public.studio_role_ok(_caller uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_any_role(_caller, ARRAY['owner','admin','super_admin','coach'])
      OR EXISTS (
        SELECT 1 FROM public.tenant_members tm
        WHERE tm.user_id = _caller AND tm.status = 'active' AND tm.role IN ('owner','admin')
      );
$$;

-- ── The REAL migration, twice: clean application + replay ────────────────────────────────────────
\ir ../migrations/20271113800010_studio_session_template_flag.sql
\ir ../migrations/20271113800010_studio_session_template_flag.sql

-- ── Checks ledger ────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial PRIMARY KEY, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

-- Run _sql as a caller and KEEP its effects: _uid ('' = none), _jwt_role (auth.role()), _db_role
-- ('' = stay postgres, a direct server session). Returns 'ok:<first column>' or 'err:<SQLSTATE>:<message>'.
CREATE FUNCTION pg_temp.run(_uid text, _jwt_role text, _db_role text, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _r text;
BEGIN
  PERFORM set_config('test.uid', _uid, true);
  PERFORM set_config('test.role', _jwt_role, true);
  BEGIN
    IF _db_role <> '' THEN EXECUTE format('SET LOCAL ROLE %I', _db_role); END IF;
    EXECUTE _sql INTO _r;
    RESET ROLE;
    RETURN 'ok:' || coalesce(_r, '<null>');
  EXCEPTION WHEN OTHERS THEN
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ── Synthetic fixtures (§63) ─────────────────────────────────────────────────────────────────────
-- uuids: tenant A = d0a1, tenant B = d0b1; people e0xx; sessions a1xx (tenant A) / b1xx (tenant B).
INSERT INTO public.tenants (id, slug) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'alpha'),
  ('00000000-0000-4000-8000-00000000d0b1', 'beta');
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-00000000e001'),  -- A owner, creator of a101
  ('00000000-0000-4000-8000-00000000e002'),  -- A admin
  ('00000000-0000-4000-8000-00000000e003'),  -- A plain member (no global role)
  ('00000000-0000-4000-8000-00000000e004'),  -- global coach, A plain member, owns nothing here
  ('00000000-0000-4000-8000-00000000e005'),  -- B owner
  ('00000000-0000-4000-8000-00000000e006');  -- A member, creator of a102
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'admin'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e003', 'member'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e004', 'member'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e006', 'owner'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e005', 'owner');
INSERT INTO public.user_roles (user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000e004', 'coach');
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e004', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e005', '00000000-0000-4000-8000-00000000d0b1'),
  ('00000000-0000-4000-8000-00000000e006', '00000000-0000-4000-8000-00000000d0a1');
INSERT INTO public.studio_sessions (id, tenant_id, owner_user_id, title, seed_brief) VALUES
  ('00000000-0000-4000-8000-00000000a101', '00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'Intake form', 'An intake form for new clients'),
  ('00000000-0000-4000-8000-00000000a102', '00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e006', 'Workshop page', 'A landing page for my workshop'),
  ('00000000-0000-4000-8000-00000000b101', '00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e005', 'Beta page', 'Beta own page');

-- ── The cases ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v text;
BEGIN
  -- 1. The creator flags their own project; the row really flipped; clearing restores it.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:true%', 'creator flags own project: ' || v);
  PERFORM pg_temp.chk((SELECT is_template FROM public.studio_sessions WHERE id = '00000000-0000-4000-8000-00000000a101'::uuid),
    'the row really flipped to is_template');
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, false, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:false%', 'creator clears the flag: ' || v);
  PERFORM pg_temp.chk(NOT (SELECT is_template FROM public.studio_sessions WHERE id = '00000000-0000-4000-8000-00000000a101'::uuid),
    'the row really flipped back');

  -- 2. Role gate + owner-or-admin predicate.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:%STUDIO_FORBIDDEN%', 'plain member: refused by the role gate: ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e004', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a102'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:%STUDIO_NOT_FOUND%', 'global coach on someone else''s project: not found (owner-or-admin predicate): ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a102'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:true%', 'workspace admin templates someone else''s project: ' || v);
  PERFORM pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a102'::uuid, false, NULL) $sql$);

  -- 3. The tenant wall: B's owner names A's session — NOT_FOUND, never swapped, row untouched.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e005', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:%STUDIO_NOT_FOUND%', 'another workspace''s owner: not found (tenant wall): ' || v);
  PERFORM pg_temp.chk(NOT (SELECT is_template FROM public.studio_sessions WHERE id = '00000000-0000-4000-8000-00000000a101'::uuid),
    'the wall left the row untouched');

  -- 4. The service path.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:22023:%STUDIO_NO_TENANT%', 'service path without a tenant: refused: ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, '00000000-0000-4000-8000-00000000d0a1'::uuid) $$);
  PERFORM pg_temp.chk(v LIKE 'ok:true%', 'service path naming the tenant: works: ' || v);
  PERFORM pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, false, NULL) $sql$);

  -- 5. Privileges.
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.set_studio_session_template(uuid, boolean, uuid)', 'EXECUTE'),
    'authenticated may execute');
  PERFORM pg_temp.chk(has_function_privilege('service_role', 'public.set_studio_session_template(uuid, boolean, uuid)', 'EXECUTE'),
    'service_role may execute');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.set_studio_session_template(uuid, boolean, uuid)', 'EXECUTE'),
    'anon may not execute');
  v := pg_temp.run('', 'anon', 'anon',
    $sql$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:%', 'anon by a real call: refused: ' || v);

  -- 6. Shape: the family's exact posture.
  PERFORM pg_temp.chk((SELECT prosecdef FROM pg_proc WHERE oid = 'public.set_studio_session_template(uuid, boolean, uuid)'::regprocedure),
    'SECURITY DEFINER');
  PERFORM pg_temp.chk((SELECT proconfig FROM pg_proc WHERE oid = 'public.set_studio_session_template(uuid, boolean, uuid)'::regprocedure)
    = ARRAY['search_path=public'], 'search_path = public');
  PERFORM pg_temp.chk(pg_get_function_result('public.set_studio_session_template(uuid, boolean, uuid)'::regprocedure) = 'studio_sessions',
    'RETURNS studio_sessions');
  PERFORM pg_temp.chk((SELECT prokind::text = 'f' AND prolang = (SELECT oid FROM pg_language WHERE lanname = 'plpgsql')
     FROM pg_proc WHERE oid = 'public.set_studio_session_template(uuid, boolean, uuid)'::regprocedure),
    'plpgsql function');

  -- 7. Mutation proofs: each protection, broken on purpose inside a rolled-back subtransaction,
  --    makes the matching probe answer differently — so the checks above can fail.
  -- 7a. Role gate removed → the plain member's refusal becomes a success.
  BEGIN
    SAVEPOINT m1;
    CREATE OR REPLACE FUNCTION public.set_studio_session_template(p_id uuid, p_is_template boolean, p_tenant_id uuid DEFAULT NULL)
    RETURNS public.studio_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.studio_sessions;
    BEGIN
      _tenant := public.current_user_tenant_id();
      UPDATE public.studio_sessions SET is_template = coalesce(p_is_template, false)
        WHERE id = p_id AND tenant_id = _tenant RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
      $$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no role gate): the plain member succeeds — the gate is what the probe tests: ' || v);
    ROLLBACK TO SAVEPOINT m1;
  END;
  -- 7b. Tenant wall removed → B's owner finds A's session.
  BEGIN
    SAVEPOINT m2;
    CREATE OR REPLACE FUNCTION public.set_studio_session_template(p_id uuid, p_is_template boolean, p_tenant_id uuid DEFAULT NULL)
    RETURNS public.studio_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _row public.studio_sessions;
    BEGIN
      IF _caller IS NOT NULL AND NOT public.studio_role_ok(_caller) THEN
        RAISE EXCEPTION 'STUDIO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
      UPDATE public.studio_sessions SET is_template = coalesce(p_is_template, false)
        WHERE id = p_id RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e005', 'authenticated', '',
      $$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no tenant wall): the other workspace''s owner finds it — the wall is what the probe tests: ' || v);
    ROLLBACK TO SAVEPOINT m2;
  END;
  -- 7c. Owner-or-admin predicate removed → the coach templates someone else's project.
  BEGIN
    SAVEPOINT m3;
    CREATE OR REPLACE FUNCTION public.set_studio_session_template(p_id uuid, p_is_template boolean, p_tenant_id uuid DEFAULT NULL)
    RETURNS public.studio_sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.studio_sessions;
    BEGIN
      IF _caller IS NOT NULL THEN
        IF NOT public.studio_role_ok(_caller) THEN RAISE EXCEPTION 'STUDIO_FORBIDDEN' USING ERRCODE = '42501'; END IF;
        _tenant := public.current_user_tenant_id();
      ELSE _tenant := p_tenant_id; END IF;
      UPDATE public.studio_sessions SET is_template = coalesce(p_is_template, false)
        WHERE id = p_id AND tenant_id = _tenant RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e004', 'authenticated', '',
      $$ SELECT 1 FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a102'::uuid, true, NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no owner-or-admin predicate): the coach templates another''s project — the predicate is what the probe tests: ' || v);
    ROLLBACK TO SAVEPOINT m3;
  END;
  -- Every mutation was rolled back: the production body answers again (the wall refuses the
  -- foreign owner where the mutated one succeeded), and no row stayed a template.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e005', 'authenticated', '',
    $sql$ SELECT is_template::text FROM public.set_studio_session_template('00000000-0000-4000-8000-00000000a101'::uuid, true, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:%STUDIO_NOT_FOUND%', 'after the mutations rolled back: the real wall answers again: ' || v);
  PERFORM pg_temp.chk((SELECT count(*) FROM public.studio_sessions WHERE is_template) = 0,
    'every mutation was rolled back — no row stayed a template');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 20 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'studio_session_template_flag: % checks passed', _total;
END $$;
