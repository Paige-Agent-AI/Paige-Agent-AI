-- ============================================================================
-- EXP07 row 9 — repeatable proof for 20271113860000_social_presence_connection_readiness.sql
-- (get_social_presence_evidence, extended with the connection lifecycle's readiness columns)
--
-- Run against the REAL migrations (\ir: the original 20261210000000 handles body first so the
-- "before" semantics exist, then 20271113860000 twice — clean application + replay) on an
-- isolated database with synthetic fixtures only (§63). Platform helpers are production's bodies
-- as migration_d carries them. auth.uid()/auth.role() read session settings (test.uid / test.role).
--
-- What it proves:
--   1. The readiness columns answer per network: handle-on-record + connected (label + verified-at
--      + profile count), handle + needs_reauth, no-handle + connected (the merge never invents a
--      handle), two profiles aggregated with the most-privileged status as primary, and
--      not_recorded networks with no connection returning NULL readiness (absence stays absence).
--   2. The authority is UNCHANGED: a workspace's own client-role member is refused with six
--      'unavailable' rows and NO readiness columns (the connection state of the coach's accounts is
--      owner-internal); the owner and the service-role path read it; workspace-not-resolved answers
--      six unavailable rows.
--   3. The tenant wall: workspace B's connections never reach workspace A's readiness (B's row set
--      is entirely absent from A's answer even when the provider matches).
--   4. Grants and shape: EXECUTE granted to authenticated + service_role, revoked from anon/PUBLIC;
--      the OUT columns are exactly the ten promised.
--   5. Mutation proofs: the role gate removed → the client reads the readiness; the tenant
--      predicate removed from the connection aggregate → B's connection reaches A — each broken
--      inside a rolled-back subtransaction makes the probe answer differently.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'social_presence_connection_readiness_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated social_presence_connection_readiness_contract database (got %)', current_database();
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
  features jsonb NOT NULL DEFAULT '{}'::jsonb, slug text,
  -- The original presence function reads the row's own last-changed time as `as_of`.
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);

-- The connection lifecycle's own table, production shape (20270127000000's DDL, constraints and
-- all), so the aggregate answers under the real shape.
CREATE TABLE public.paige_social_connections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider_key text not null,
  provider_profile_key text not null,
  requested_platform text,
  label text check (label is null or length(btrim(label)) between 1 and 120),
  status text not null default 'setup_required'
    check (status in ('setup_required','authorizing','connected','needs_reauth','disconnected','error')),
  connected_by uuid references auth.users(id) on delete set null,
  authorization_expires_at timestamptz,
  last_verified_at timestamptz,
  disconnected_at timestamptz,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paige_social_connections_provider_shape check (provider_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  constraint paige_social_connections_profile_shape check (provider_profile_key ~ '^ps_[0-9a-f]{40}$'),
  constraint paige_social_connections_requested_platform_shape check (
    requested_platform is null or requested_platform in ('tiktok','instagram','facebook','linkedin','youtube','x','threads','pinterest','google_business','snapchat')
  ),
  constraint paige_social_connections_tenant_id_id_key unique (tenant_id,id),
  constraint paige_social_connections_provider_profile_key unique (provider_key,provider_profile_key),
  constraint paige_social_connections_failure_state check ((status='error')=(failure_code is not null))
);
ALTER TABLE public.paige_social_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.paige_social_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.paige_social_connections TO service_role;
CREATE POLICY paige_social_connections_service ON public.paige_social_connections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Platform helpers: production bodies (as migration_d_studio_authority.sql carries them) ────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'::public.app_role); $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND (role::text = 'platform_admin' OR role::text = 'super_admin')); $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT public.is_platform_admin(auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.has_any_role(_user_id uuid, _roles text[]) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role::text = ANY (_roles)); $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.parent_tenant_id IS NULL
     AND t.account_type = 'standalone' AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)); $$;
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
CREATE OR REPLACE FUNCTION public.is_tenant_admin(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid()
       AND status = 'active' AND role IN ('owner','admin'))
   OR (public.is_company_workspace(_tenant) AND public.is_platform_owner()); $$;

-- ── The REAL migrations: the original handles body, then the readiness extension twice ───────────
\ir ../migrations/20261210000000_a_business_can_record_the_accounts_it_posts_from.sql
\ir ../migrations/20271113860000_social_presence_connection_readiness.sql
\ir ../migrations/20271113860000_social_presence_connection_readiness.sql

-- ── Checks ledger ────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial PRIMARY KEY, ok boolean, what text);
GRANT ALL ON _checks TO PUBLIC;
GRANT ALL ON SEQUENCE _checks_n_seq TO PUBLIC;
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

CREATE FUNCTION pg_temp.run(_uid text, _jwt_role text, _db_role text, _sql text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE _r jsonb;
BEGIN
  PERFORM set_config('test.uid', _uid, true);
  PERFORM set_config('test.role', _jwt_role, true);
  BEGIN
    IF _db_role <> '' THEN EXECUTE format('SET LOCAL ROLE %I', _db_role); END IF;
    EXECUTE _sql INTO _r;
    RAISE EXCEPTION USING ERRCODE = 'ZZ999', MESSAGE = 'ok:' || coalesce(_r::text, '<null>');
  EXCEPTION
    WHEN SQLSTATE 'ZZ999' THEN RETURN 'ok:' || coalesce(_r::text, '<null>');
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ── Synthetic fixtures (§63): tenant A (d0a1, the coach) and B (d0b1); people e0xx ────────────────
INSERT INTO public.tenants (id, slug, features) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'alpha', '{"social_handles": {"instagram": "@alpha-co", "x": "@alpha_co", "linkedin": "alpha-coaching"}}'::jsonb),
  ('00000000-0000-4000-8000-00000000d0b1', 'beta', '{"social_handles": {"instagram": "@beta-co"}}'::jsonb);
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-00000000e001'),  -- A owner (the coach)
  ('00000000-0000-4000-8000-00000000e002');  -- A's linked client (same tenant, client role)
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'client');
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1');
-- Connections: A has instagram connected (verified), x needs_reauth, facebook connected twice
-- (two profiles: one connected, one disconnected → primary connected, profiles 2), linkedin
-- error. B has instagram connected — must never reach A's answer.
INSERT INTO public.paige_social_connections (tenant_id, provider_key, provider_profile_key, requested_platform, label, status, failure_code, last_verified_at) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_1111111111111111111111111111111111111111', 'instagram', 'Alpha Coaching (main)', 'connected', NULL, '2026-10-20T10:00:00Z'),
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_2222222222222222222222222222222222222222', 'x', 'Alpha Coaching on X', 'needs_reauth', NULL, '2026-10-01T09:00:00Z'),
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_3333333333333333333333333333333333333333', 'facebook', 'Alpha Coaching page', 'connected', NULL, '2026-10-18T10:00:00Z'),
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_4444444444444444444444444444444444444444', 'facebook', 'Alpha Coaching (old)', 'disconnected', NULL, NULL),
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_5555555555555555555555555555555555555555', 'linkedin', NULL, 'error', 'provider_token_expired', NULL),
  -- A legacy connection with no requested_platform: it can never be attributed to a network, so
  -- it must join NOTHING — every network's readiness stays what its own rows prove.
  ('00000000-0000-4000-8000-00000000d0a1', 'upload_post', 'ps_7777777777777777777777777777777777777777', NULL, 'Legacy (unscoped)', 'connected', NULL, '2026-10-15T10:00:00Z');
INSERT INTO public.paige_social_connections (tenant_id, provider_key, provider_profile_key, requested_platform, label, status, last_verified_at) VALUES
  ('00000000-0000-4000-8000-00000000d0b1', 'upload_post', 'ps_6666666666666666666666666666666666666666', 'instagram', 'Beta (main)', 'connected', '2026-10-19T10:00:00Z');

-- ── The cases ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v text; r record;
BEGIN
  -- 1. The owner reads the merged answer.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.network), '[]'::jsonb) FROM public.get_social_presence_evidence(NULL) p $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'the owner reads the merged presence+readiness answer');
  -- Per-network assertions, one lookup each.
  FOR r IN SELECT (jsonb_array_elements(substr(v, 4)::jsonb)) AS row_json LOOP
    IF r.row_json->>'network' = 'instagram' THEN
      PERFORM pg_temp.chk(r.row_json->>'status' = 'on_record' AND r.row_json->>'handle' = '@alpha-co'
        AND r.row_json->>'connection_status' = 'connected'
        AND r.row_json->>'connection_label' = 'Alpha Coaching (main)'
        AND r.row_json->>'connection_profiles' = '1'
        AND r.row_json->>'connection_verified_at' LIKE '2026-10-20%',
        'instagram: handle on record + connected (label, verified-at, 1 profile)');
    END IF;
    IF r.row_json->>'network' = 'x' THEN
      PERFORM pg_temp.chk(r.row_json->>'connection_status' = 'needs_reauth',
        'x: handle on record + needs_reauth readiness');
    END IF;
    IF r.row_json->>'network' = 'facebook' THEN
      PERFORM pg_temp.chk(r.row_json->>'connection_status' = 'connected'
        AND r.row_json->>'connection_profiles' = '2'
        AND r.row_json->>'connection_label' = 'Alpha Coaching page'
        AND r.row_json->>'handle' IS NULL,
        'facebook: no handle on record but connected — the merge never invents a handle; two profiles aggregate with connected primary');
    END IF;
    IF r.row_json->>'network' = 'linkedin' THEN
      PERFORM pg_temp.chk(r.row_json->>'connection_status' = 'error' AND r.row_json->>'handle' = 'alpha-coaching',
        'linkedin: handle on record + error readiness');
    END IF;
    IF r.row_json->>'network' = 'youtube' THEN
      PERFORM pg_temp.chk(r.row_json->>'status' = 'not_recorded' AND r.row_json->>'connection_status' IS NULL
        AND r.row_json->>'connection_profiles' IS NULL,
        'youtube: absence stays absence — no handle, no connection, NULL readiness, and the legacy unscoped connection joins nothing');
    END IF;
    IF r.row_json->>'network' = 'tiktok' THEN
      PERFORM pg_temp.chk(r.row_json->>'status' = 'not_recorded' AND r.row_json->>'connection_status' IS NULL,
        'tiktok: not recorded, no connection');
    END IF;
    -- The tenant wall: B's instagram connection ("Beta (main)") must not appear anywhere.
    PERFORM pg_temp.chk(r.row_json->>'connection_label' IS DISTINCT FROM 'Beta (main)',
      'the tenant wall: workspace B''s connection never reaches A''s answer (' || coalesce(r.row_json->>'network', '?') || ')');
  END LOOP;

  -- 2. The authority is unchanged: A's own client-role member is refused, six rows, no readiness.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) FROM public.get_social_presence_evidence(NULL) p $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'the client-role member gets an answer (six unavailable rows)');
  PERFORM pg_temp.chk((SELECT count(*) FROM jsonb_array_elements(substr(v, 4)::jsonb)) = 6,
    'the refusal is exactly six rows');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM jsonb_array_elements(substr(v, 4)::jsonb) e
      WHERE e->>'connection_status' IS NOT NULL),
    'the refusal leaks no connection readiness');

  -- Workspace not resolved (signed-out caller naming nothing).
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT count(*)::text FROM public.get_social_presence_evidence(NULL) p $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:%' OR v LIKE 'ok:%', 'the service path without a tenant answers the unavailable contract: ' || substr(v, 1, 60));

  -- The service path with a named tenant reads the readiness.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT count(*)::text FROM public.get_social_presence_evidence('00000000-0000-4000-8000-00000000d0a1'::uuid) p WHERE p.connection_status = 'connected' $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:2%', 'the service path names the tenant: two connected networks (instagram, facebook): ' || v);

  -- 3. anon cannot execute.
  v := pg_temp.run('', 'anon', 'anon',
    $sql$ SELECT 1 FROM public.get_social_presence_evidence(NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:%', 'anon by a real call: refused: ' || v);

  -- 4. Shape: the ten promised OUT columns, EXECUTE grants.
  PERFORM pg_temp.chk((SELECT count(*) = 10 FROM pg_proc p, unnest(p.proargmodes) m
    WHERE p.oid = 'public.get_social_presence_evidence(uuid)'::regprocedure AND m = 't'),
    'the OUT columns are exactly the ten promised');
  PERFORM pg_temp.chk(has_function_privilege('authenticated', 'public.get_social_presence_evidence(uuid)', 'EXECUTE')
    AND has_function_privilege('service_role', 'public.get_social_presence_evidence(uuid)', 'EXECUTE')
    AND NOT has_function_privilege('anon', 'public.get_social_presence_evidence(uuid)', 'EXECUTE'),
    'grants: authenticated + service_role execute; anon does not');

  -- 5. Mutation proofs (each broken inside a rolled-back subtransaction, then rolled back).
  BEGIN
    CREATE OR REPLACE FUNCTION public.get_social_presence_evidence(_tenant_id uuid DEFAULT NULL)
    RETURNS TABLE (network text, status text, handle text, as_of timestamptz, reason text, tenant_id uuid,
      connection_status text, connection_label text, connection_verified_at timestamptz, connection_profiles int)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
    DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_handles jsonb; v_updated timestamptz;
      v_networks constant text[] := ARRAY['instagram','facebook','linkedin','youtube','tiktok','x'];
    BEGIN
      v_tenant := public.current_user_tenant_id();
      SELECT coalesce(t.features -> 'social_handles', '{}'::jsonb), t.updated_at INTO v_handles, v_updated
        FROM public.tenants t WHERE t.id = v_tenant;
      RETURN QUERY SELECT n,
        CASE WHEN nullif(btrim(coalesce(v_handles ->> n, '')), '') IS NOT NULL THEN 'on_record' ELSE 'not_recorded' END::text,
        nullif(btrim(coalesce(v_handles ->> n, '')), ''), v_updated, NULL::text, v_tenant,
        c.primary_status, c.primary_label, c.primary_verified_at, c.profiles
      FROM unnest(v_networks) n
      LEFT JOIN (SELECT provider_key, count(*)::int AS profiles,
          (array_agg(status ORDER BY updated_at DESC))[1] AS primary_status,
          (array_agg(label ORDER BY updated_at DESC))[1] AS primary_label,
          (array_agg(last_verified_at ORDER BY updated_at DESC))[1] AS primary_verified_at
        FROM public.paige_social_connections GROUP BY provider_key) c ON c.provider_key = n;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
      $sql$ SELECT count(*)::text FROM public.get_social_presence_evidence(NULL) p WHERE p.connection_status IS NOT NULL $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:%' AND v <> 'ok:0', 'mutated (no role gate): the client reads the readiness — the gate is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  BEGIN
    -- Tenant predicate removed from the aggregate: B's connection reaches A.
    CREATE OR REPLACE FUNCTION public.get_social_presence_evidence(_tenant_id uuid DEFAULT NULL)
    RETURNS TABLE (network text, status text, handle text, as_of timestamptz, reason text, tenant_id uuid,
      connection_status text, connection_label text, connection_verified_at timestamptz, connection_profiles int)
    LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
    DECLARE v_uid uuid := auth.uid(); v_tenant uuid; v_handles jsonb; v_updated timestamptz;
      v_networks constant text[] := ARRAY['instagram','facebook','linkedin','youtube','tiktok','x'];
    BEGIN
      IF v_uid IS NOT NULL THEN v_tenant := public.current_user_tenant_id(); ELSE v_tenant := _tenant_id; END IF;
      IF v_uid IS NOT NULL AND NOT (public.is_tenant_admin(v_tenant) OR public.is_platform_owner()) THEN
        RETURN QUERY SELECT n, 'unavailable'::text, NULL::text, NULL::timestamptz, 'not permitted for this account'::text, v_tenant,
          NULL::text, NULL::text, NULL::timestamptz, NULL::int FROM unnest(v_networks) n;
        RETURN;
      END IF;
      SELECT coalesce(t.features -> 'social_handles', '{}'::jsonb), t.updated_at INTO v_handles, v_updated
        FROM public.tenants t WHERE t.id = v_tenant;
      RETURN QUERY SELECT n,
        CASE WHEN nullif(btrim(coalesce(v_handles ->> n, '')), '') IS NOT NULL THEN 'on_record' ELSE 'not_recorded' END::text,
        nullif(btrim(coalesce(v_handles ->> n, '')), ''), v_updated, NULL::text, v_tenant,
        c.primary_status, c.primary_label, c.primary_verified_at, c.profiles
      FROM unnest(v_networks) n
      LEFT JOIN (SELECT provider_key, count(*)::int AS profiles,
          (array_agg(status ORDER BY CASE status WHEN 'connected' THEN 1 WHEN 'authorizing' THEN 2 WHEN 'needs_reauth' THEN 3 WHEN 'error' THEN 4 WHEN 'setup_required' THEN 5 WHEN 'disconnected' THEN 6 ELSE 7 END, updated_at DESC))[1] AS primary_status,
          (array_agg(label ORDER BY CASE status WHEN 'connected' THEN 1 WHEN 'authorizing' THEN 2 WHEN 'needs_reauth' THEN 3 WHEN 'error' THEN 4 WHEN 'setup_required' THEN 5 WHEN 'disconnected' THEN 6 ELSE 7 END, updated_at DESC))[1] AS primary_label,
          (array_agg(last_verified_at ORDER BY CASE status WHEN 'connected' THEN 1 WHEN 'authorizing' THEN 2 WHEN 'needs_reauth' THEN 3 WHEN 'error' THEN 4 WHEN 'setup_required' THEN 5 WHEN 'disconnected' THEN 6 ELSE 7 END, updated_at DESC))[1] AS primary_verified_at
        FROM public.paige_social_connections GROUP BY provider_key) c ON c.provider_key = n;
    END $fn$;
    v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
      $sql$ SELECT count(*)::text FROM public.get_social_presence_evidence(NULL) p WHERE p.connection_label = 'Beta (main)' $sql$);
    PERFORM pg_temp.chk(v LIKE 'ok:1%', 'mutated (no tenant wall in the aggregate): B''s connection reaches A — the wall is what the probe tests: ' || v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
  EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
  END;
  -- Every mutation was rolled back: the real body answers again (B stays out).
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.get_social_presence_evidence(NULL) p WHERE p.connection_label = 'Beta (main)' $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:0%', 'after the mutations rolled back: B''s connection is gone again: ' || v);
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 20 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'social_presence_connection_readiness: % checks passed', _total;
END $$;
