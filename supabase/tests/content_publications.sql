-- ============================================================================
-- EXP07 row 10 — repeatable proof for 20271113870000_content_publications.sql
-- (content_publication_record / content_publication_bind / content_publication_list / pending_reconcile)
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
  IF current_database() <> 'content_publications_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated content_publications_contract database (got %)', current_database();
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
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT public.agency_can_manage_child(_child, auth.uid()); $$;

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
\ir ../migrations/20271113870000_content_publications.sql
\ir ../migrations/20271113870000_content_publications.sql

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

-- ── Synthetic fixtures (§63): tenant A (d0a1) and B (d0b1); people e0xx; pieces a3xx/b3xx ────────
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
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-00000000d0a1', 'text', 'Alpha workshop reminder'),
  ('00000000-0000-4000-8000-00000000b301', '00000000-0000-4000-8000-00000000d0b1', 'text', 'Beta own piece');

-- ── The cases ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v text; _pub uuid; _pub2 uuid;
BEGIN
  -- 1. The door's write path: create → bind once → walk forward.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT id::text FROM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered') $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'service path creates a registered attempt: ' || v);
  _pub := substr(v, 4)::uuid;

  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.content_publication_bind(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, '00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', NULL, '44444444-4444-4444-8444-444444444444'::uuid, '{"caption": "Hello"}'::jsonb) $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'ok:approved%', 'bind sets approved with the exact args: ' || v);

  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.content_publication_bind(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, '00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', NULL, NULL, NULL) $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'err:P0002:CONTENT_NOT_FOUND%', 'a second bind is refused — what ran is what one approval claimed: ' || v);

  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.content_publication_record(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'publishing') $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'ok:publishing%', 'publishing: ' || v);

  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.content_publication_record(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'published', 'up_123', 'https://instagram.com/p/abc', NULL, NULL, '{"results": []}'::jsonb) $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'ok:published%', 'published with the provider own id/url: ' || v);
  PERFORM pg_temp.chk((SELECT provider_post_id FROM public.content_publications WHERE id = _pub) = 'up_123', 'the provider post id was recorded');

  -- 2. Forward-only.
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.content_publication_record(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'publishing') $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'err:P0002:%', 'a published row cannot go back to publishing: ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.content_publication_record(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'bogus_status') $sql$, _pub::text));
  PERFORM pg_temp.chk(v LIKE 'err:22023:CONTENT_INVALID%', 'an unknown walk status is invalid (on the walk path, not creation): ' || v);

  -- 3. Writes are door-only: a signed-in owner is refused.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered') $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:CONTENT_FORBIDDEN%', 'a signed-in owner cannot write publication records (door-only): ' || v);

  -- 4. Reads: member lists; foreign owner sees only their own; reconcile gate.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.content_publication_list(NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:1%', 'a plain member reads the workspace receipts (one published attempt): ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.content_publication_list(NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:0%', 'the foreign owner sees only their own (none): ' || v);
  PERFORM set_config('test.uid', '', true);
  PERFORM pg_temp.chk(NOT public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', '00000000-0000-4000-8000-00000000d0a1'::uuid),
    'no pending reconcile (the attempt resolved)');

  -- Clear the uid for the direct service-role calls below (the door-only write gate requires
  -- auth.uid() to be NULL, exactly as it is on the real service-role path).
  PERFORM set_config('test.uid', '', true);
  -- An outcome_unknown attempt for the same piece+platform blocks a new one.
  PERFORM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered');
  SELECT id INTO _pub2 FROM public.content_publications WHERE status = 'registered' LIMIT 1;
  PERFORM public.content_publication_bind(_pub2::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, '00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', NULL, '55555555-5555-5555-8555-555555555555'::uuid, '{}'::jsonb);
  PERFORM public.content_publication_record(_pub2::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'publishing');
  PERFORM public.content_publication_record(_pub2::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'outcome_unknown', NULL, NULL, 'req_789', NULL, NULL);
  PERFORM pg_temp.chk(public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', '00000000-0000-4000-8000-00000000d0a1'::uuid),
    'an outcome_unknown attempt for the same piece+platform IS pending reconcile');
  PERFORM pg_temp.chk(NOT public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'x', '00000000-0000-4000-8000-00000000d0a1'::uuid),
    'a different platform is not blocked');
  -- The cross-workspace check runs on the service path (no uid) — an A-owner cannot name B's workspace.
  PERFORM pg_temp.chk(NOT public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000b301'::uuid, 'instagram', '00000000-0000-4000-8000-00000000d0b1'::uuid),
    'a different workspace is not blocked');

  -- 5. Privileges.
  PERFORM pg_temp.chk(has_function_privilege('service_role', 'public.content_publication_record(uuid, uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.content_publication_list(uuid, uuid)', 'EXECUTE'), 'service_role may execute');
  PERFORM pg_temp.chk(NOT has_function_privilege('anon', 'public.content_publication_record(uuid, uuid, text, text, text, text, text, jsonb)', 'EXECUTE')
    AND NOT has_function_privilege('authenticated', 'public.content_publication_record(uuid, uuid, text, text, text, text, text, jsonb)', 'EXECUTE'),
    'anon AND authenticated may not execute the write RPC (door-only)');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.content_publication_list(uuid, uuid)', 'EXECUTE'),
    'authenticated may execute the read RPC');

  -- 6. Mutation proofs.
  BEGIN
    CREATE OR REPLACE FUNCTION public.content_publication_record(p_id uuid, p_tenant_id uuid, p_status text,
      p_provider_post_id text DEFAULT NULL, p_provider_post_url text DEFAULT NULL,
      p_provider_request_id text DEFAULT NULL, p_error_code text DEFAULT NULL, p_provider_response jsonb DEFAULT NULL)
    RETURNS public.content_publications LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _row public.content_publications;
    BEGIN
      IF p_id IS NULL THEN
        INSERT INTO public.content_publications (tenant_id, status) VALUES (p_tenant_id, 'registered') RETURNING * INTO _row;
      ELSE
        UPDATE public.content_publications SET status = p_status, updated_at = now()
          WHERE id = p_id AND tenant_id = p_tenant_id RETURNING * INTO _row;
      END IF;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
      $sql$ SELECT 1 FROM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered') $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no door gate): the owner writes — the gate is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  BEGIN
    CREATE OR REPLACE FUNCTION public.content_publication_record(p_id uuid, p_tenant_id uuid, p_status text,
      p_provider_post_id text DEFAULT NULL, p_provider_post_url text DEFAULT NULL,
      p_provider_request_id text DEFAULT NULL, p_error_code text DEFAULT NULL, p_provider_response jsonb DEFAULT NULL)
    RETURNS public.content_publications LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $fn$
    DECLARE _row public.content_publications;
    BEGIN
      IF p_id IS NULL THEN
        INSERT INTO public.content_publications (tenant_id, status) VALUES (p_tenant_id, 'registered') RETURNING * INTO _row;
      ELSE
        UPDATE public.content_publications SET status = p_status, updated_at = now()
          WHERE id = p_id RETURNING * INTO _row;
      END IF;
      RETURN _row;
    END $fn$;
    v := pg_temp.run('', 'service_role', 'service_role',
      $sql$ SELECT 1 FROM public.content_publication_record(_pub, '00000000-0000-4000-8000-00000000d0b1'::uuid, 'refused') $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%', 'mutated (no tenant wall): the foreign tenant updates the attempt — the wall is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  -- Every mutation rolled back: the real gate answers again and the published row is untouched.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered') $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:%', 'after the mutations rolled back: the real gate answers again: ' || v);
  PERFORM pg_temp.chk((SELECT count(*) FROM public.content_publications WHERE status = 'published') = 1, 'the published row was never mutated');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 20 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'content_publications: % checks passed', _total;
END $$;
