-- ============================================================================
-- EXP07 row 8 — repeatable proof for 20271113850000_content_plan.sql
-- (public.content_plan_upsert / public.content_plan_list)
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The platform helpers the functions read are production's
-- bodies as migration_d carries them, so the authority answers here are the ones production would
-- give. auth.uid()/auth.role() read session settings (test.uid / test.role).
--
-- What it proves:
--   1. The plan writes: the workspace's owner creates an entry (linked to the workspace's own
--      piece), edits the same row, and the row really changed.
--   2. The write gate: a plain member is refused (CONTENT_FORBIDDEN) — planning is the owner's
--      act; reading (below) is every member's.
--   3. The tenant wall: another workspace's owner naming this workspace's entry gets
--      CONTENT_NOT_FOUND and the row is untouched; a named foreign tenant is refused, never
--      swapped in.
--   4. The piece link: a content row from ANOTHER workspace is refused (CONTENT_NOT_FOUND) and
--      nothing is created — the plan never adopts a foreign piece.
--   5. Validation: a NULL planned_for is CONTENT_INVALID.
--   6. The service path: without a tenant CONTENT_NO_TENANT; with an explicit tenant it works.
--   7. Reads: every workspace member may list (the plan is shared context); the list is bounded
--      by the from/to window; a foreign workspace's owner sees only their own rows (never A's).
--   8. Privileges: anon/PUBLIC cannot execute either function; authenticated and service_role
--      can. Shape: SECURITY DEFINER, search_path, return types.
--   9. Mutation proofs: the write gate, the tenant wall and the piece-link check, each broken on
--      purpose inside a rolled-back subtransaction, make the matching probe answer differently.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'content_plan_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated content_plan_contract database (got %)', current_database();
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
-- marketing_content pre-exists the plan table (the plan links into it); production's FK only
-- needs id + tenant_id, so the fixture carries exactly those.
CREATE TABLE IF NOT EXISTS public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text', channel text, title text NOT NULL DEFAULT 'Untitled',
  status text NOT NULL DEFAULT 'draft');

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

-- ── The REAL migration, twice: clean application + replay ────────────────────────────────────────
\ir ../migrations/20271113850000_content_plan.sql
\ir ../migrations/20271113850000_content_plan.sql

-- ── Checks ledger ────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial PRIMARY KEY, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

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

-- ── Synthetic fixtures (§63): tenant A (d0a1) and B (d0b1); people e0xx; pieces a2xx/b2xx ────────
INSERT INTO public.tenants (id, slug) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'alpha'),
  ('00000000-0000-4000-8000-00000000d0b1', 'beta');
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-00000000e001'),  -- A owner
  ('00000000-0000-4000-8000-00000000e002'),  -- A plain member
  ('00000000-0000-4000-8000-00000000e003');  -- B owner
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'member'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e003', 'owner');
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0b1');
INSERT INTO public.marketing_content (id, tenant_id, kind, title) VALUES
  ('00000000-0000-4000-8000-00000000a201', '00000000-0000-4000-8000-00000000d0a1', 'text', 'Alpha workshop reminder'),
  ('00000000-0000-4000-8000-00000000b201', '00000000-0000-4000-8000-00000000d0b1', 'text', 'Beta own piece');

-- ── The cases ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v text; _count int;
BEGIN
  -- 1. The owner creates an entry linked to the workspace's own piece; then edits the same row.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT channel FROM public.content_plan_upsert(NULL, '00000000-0000-4000-8000-00000000a201'::uuid, 'email_campaign', '2026-11-03T14:00:00Z', 'Two days out', 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:email_campaign%', 'owner creates a linked plan entry: ' || v);
  SELECT count(*) INTO _count FROM public.content_plan_entries WHERE tenant_id = '00000000-0000-4000-8000-00000000d0a1'::uuid AND status = 'planned';
  PERFORM pg_temp.chk(_count = 1, 'exactly one row was created');
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT status FROM public.content_plan_upsert((SELECT id FROM public.content_plan_entries LIMIT 1), '00000000-0000-4000-8000-00000000a201'::uuid, 'email_campaign', '2026-11-03T14:00:00Z', NULL, 'ready', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:ready%', 'the same row is edited in place: ' || v);
  SELECT count(*) INTO _count FROM public.content_plan_entries;
  PERFORM pg_temp.chk(_count = 1, 'an edit never created a second row');

  -- 2. The write gate: a plain member is refused.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', '2026-11-04T14:00:00Z', NULL, 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:CONTENT_FORBIDDEN%', 'plain member: planning is the owner''s act: ' || v);

  -- 3. The tenant wall: B's owner naming A's entry; and a named foreign tenant.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert((SELECT id FROM public.content_plan_entries LIMIT 1), NULL, 'social_post', '2026-11-04T14:00:00Z', NULL, 'cancelled', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'another workspace''s owner: not found (tenant wall): ' || v);
  PERFORM pg_temp.chk((SELECT status FROM public.content_plan_entries LIMIT 1) = 'ready', 'the wall left the row untouched');
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', '2026-11-04T14:00:00Z', NULL, 'planned', '00000000-0000-4000-8000-00000000d0b1'::uuid) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:CONTENT_FORBIDDEN%', 'a named foreign tenant is refused, never swapped in: ' || v);

  -- 4. The piece link: B's piece is refused and nothing is created.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, '00000000-0000-4000-8000-00000000b201'::uuid, 'social_post', '2026-11-04T14:00:00Z', NULL, 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'a foreign piece is never adopted: ' || v);
  PERFORM pg_temp.chk((SELECT count(*) FROM public.content_plan_entries) = 1, 'nothing was created by the refused link');

  -- 5. Validation.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', NULL, NULL, 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:22023:CONTENT_INVALID%', 'a NULL planned_for is invalid: ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, NULL, '2026-11-04T14:00:00Z', NULL, 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:22023:CONTENT_INVALID%', 'a NULL channel is invalid: ' || v);

  -- 6. The service path.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', '2026-11-05T14:00:00Z', NULL, 'planned', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:22023:CONTENT_NO_TENANT%', 'service path without a tenant: refused: ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', '2026-11-05T14:00:00Z', NULL, 'planned', '00000000-0000-4000-8000-00000000d0a1'::uuid) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'service path naming the tenant: works: ' || v);

  -- 7. Reads: a member may list; the window bounds; a foreign owner sees only their own.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.content_plan_list(NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:2%', 'a plain member can read the shared plan: ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.content_plan_list('2026-11-04T00:00:00Z', NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:1%', 'the from-window bounds the read: ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.content_plan_list(NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:0%', 'the foreign owner sees only their own (none): ' || v);

  -- 8. Privileges + shape.
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.content_plan_upsert(uuid, uuid, text, timestamptz, text, text, uuid)', 'EXECUTE')
    AND has_function_privilege('authenticated', 'public.content_plan_list(timestamptz, timestamptz, uuid)', 'EXECUTE'), 'authenticated may execute both');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.content_plan_upsert(uuid, uuid, text, timestamptz, text, text, uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.content_plan_list(timestamptz, timestamptz, uuid)', 'EXECUTE'), 'anon may not execute either');
  v := pg_temp.run('', 'anon', 'anon',
    $sql$ SELECT 1 FROM public.content_plan_list(NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:%', 'anon by a real call: refused: ' || v);
  PERFORM pg_temp.chk((SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = 'public.content_plan_upsert(uuid, uuid, text, timestamptz, text, text, uuid)'::regprocedure),
    'upsert: SECURITY DEFINER, search_path=public');
  PERFORM pg_temp.chk((SELECT proconfig FROM pg_proc WHERE oid = 'public.content_plan_list(timestamptz, timestamptz, uuid)'::regprocedure) = ARRAY['search_path=public'],
    'list: search_path=public');

  -- 9. Mutation proofs (each broken inside a rolled-back subtransaction, migration_g's pattern).
  BEGIN
    CREATE OR REPLACE FUNCTION public.content_plan_upsert(p_id uuid DEFAULT NULL, p_content_id uuid DEFAULT NULL, p_channel text DEFAULT NULL, p_planned_for timestamptz DEFAULT NULL,
      p_note text DEFAULT NULL, p_status text DEFAULT 'planned', p_tenant_id uuid DEFAULT NULL)
    RETURNS public.content_plan_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.content_plan_entries;
    BEGIN
      _tenant := public.current_user_tenant_id();
      INSERT INTO public.content_plan_entries (tenant_id, created_by, content_id, channel, planned_for, note, status)
        VALUES (_tenant, _caller, p_content_id, p_channel, p_planned_for, p_note, COALESCE(p_status, 'planned')) RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
      $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, NULL, 'social_post', '2026-11-06T14:00:00Z', NULL, 'planned', NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no write gate): the member plans — the gate is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  BEGIN
    CREATE OR REPLACE FUNCTION public.content_plan_upsert(p_id uuid DEFAULT NULL, p_content_id uuid DEFAULT NULL, p_channel text DEFAULT NULL, p_planned_for timestamptz DEFAULT NULL,
      p_note text DEFAULT NULL, p_status text DEFAULT 'planned', p_tenant_id uuid DEFAULT NULL)
    RETURNS public.content_plan_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.content_plan_entries;
    BEGIN
      IF _caller IS NOT NULL THEN
        _tenant := public.current_user_tenant_id();
        IF NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
          RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501'; END IF;
      ELSE _tenant := p_tenant_id; END IF;
      UPDATE public.content_plan_entries SET status = COALESCE(p_status, status), updated_at = now()
        WHERE id = p_id RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
      $sql$ SELECT 1 FROM public.content_plan_upsert((SELECT id FROM public.content_plan_entries LIMIT 1), NULL, 'social_post', '2026-11-04T14:00:00Z', NULL, 'cancelled', NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no tenant wall): the foreign owner edits it — the wall is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  BEGIN
    CREATE OR REPLACE FUNCTION public.content_plan_upsert(p_id uuid DEFAULT NULL, p_content_id uuid DEFAULT NULL, p_channel text DEFAULT NULL, p_planned_for timestamptz DEFAULT NULL,
      p_note text DEFAULT NULL, p_status text DEFAULT 'planned', p_tenant_id uuid DEFAULT NULL)
    RETURNS public.content_plan_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _caller uuid := auth.uid(); _tenant uuid; _row public.content_plan_entries;
    BEGIN
      IF _caller IS NOT NULL THEN
        _tenant := public.current_user_tenant_id();
        IF NOT (public.is_tenant_admin(_tenant) OR public.agency_can_manage_child(_tenant)) THEN
          RAISE EXCEPTION 'CONTENT_FORBIDDEN' USING ERRCODE = '42501'; END IF;
      ELSE _tenant := p_tenant_id; END IF;
      INSERT INTO public.content_plan_entries (tenant_id, created_by, content_id, channel, planned_for, note, status)
        VALUES (_tenant, _caller, p_content_id, p_channel, p_planned_for, p_note, COALESCE(p_status, 'planned')) RETURNING * INTO _row;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
      $sql$ SELECT 1 FROM public.content_plan_upsert(NULL, '00000000-0000-4000-8000-00000000b201'::uuid, 'social_post', '2026-11-04T14:00:00Z', NULL, 'planned', NULL) $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no piece-link check): the foreign piece is adopted — the check is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  -- Every mutation was rolled back: the real body answers again, and no row leaked.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_plan_upsert((SELECT id FROM public.content_plan_entries LIMIT 1), NULL, 'social_post', '2026-11-04T14:00:00Z', NULL, 'cancelled', NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'after the mutations rolled back: the real wall answers again: ' || v);
  PERFORM pg_temp.chk((SELECT count(*) FROM public.content_plan_entries) = 2, 'every mutation was rolled back — exactly the two service/owner rows remain');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 20 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'content_plan: % checks passed', _total;
END $$;
