-- EXP07 media library — repeatable proof for 20271120110000_tenant_media_assets.sql
-- (and the three P3 repairs it carries into the publications/meter surfaces).
--
-- Runs on an ISOLATED database named tenant_media_assets_contract (the guard below refuses
-- anywhere else). Structure mirrors content_publications.sql: stub roles + the minimal
-- production-shaped tables, the REAL original migration chain (\ir), synthetic tenants/people,
-- then the checks ledger. The migration's own code decides everything; nothing here re-implements it.
DO $$ BEGIN
  IF current_database() <> 'tenant_media_assets_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated tenant_media_assets_contract database (got %)', current_database();
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
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('test.uid', true), '')::uuid $$;

-- ── Minimal production-shaped tables (the chain migrations' own FK targets) ─────────────────────
CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY, parent_tenant_id uuid, account_type text NOT NULL DEFAULT 'standalone',
  features jsonb NOT NULL DEFAULT '{}'::jsonb, slug text, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.tenant_members (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, role text NOT NULL, status text NOT NULL DEFAULT 'active',
  joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (tenant_id, user_id));
CREATE TABLE IF NOT EXISTS public.agency_team_members (
  agency_tenant_id uuid NOT NULL, user_id uuid NOT NULL, agency_role text NOT NULL,
  status text NOT NULL DEFAULT 'active', scoped_subaccounts uuid[] NOT NULL DEFAULT '{}');
CREATE TABLE IF NOT EXISTS public.profiles (user_id uuid PRIMARY KEY, active_tenant_id uuid);
CREATE TABLE IF NOT EXISTS public.user_roles (user_id uuid NOT NULL, role text NOT NULL);
CREATE TABLE IF NOT EXISTS public.marketing_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'text', channel text, title text NOT NULL DEFAULT 'Untitled',
  status text NOT NULL DEFAULT 'draft');
-- The meter table pre-exists on the real chain (2026-07); the fixture carries its production shape.
CREATE TABLE IF NOT EXISTS public.platform_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, event_type text NOT NULL, quantity numeric NOT NULL DEFAULT 1,
  unit text, occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now());

-- ── Platform helpers: production bodies (as the chain carries them) ──────────────────────────────
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin'); $$;
CREATE OR REPLACE FUNCTION public.is_platform_admin(_actor uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _actor AND role IN ('platform_admin','super_admin')); $$;
CREATE OR REPLACE FUNCTION public.is_platform_operator() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT public.is_super_admin() OR public.is_platform_admin(auth.uid()); $$;
CREATE OR REPLACE FUNCTION public.is_company_workspace(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenants t WHERE t.id = _tenant AND t.parent_tenant_id IS NULL
     AND t.account_type = 'standalone' AND COALESCE(t.features -> 'system_workspace' = 'true'::jsonb, false)); $$;
CREATE OR REPLACE FUNCTION public.is_tenant_member(_tenant uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS
$$ SELECT EXISTS (SELECT 1 FROM public.tenant_members WHERE tenant_id = _tenant AND user_id = auth.uid() AND status = 'active')
   OR (public.is_company_workspace(_tenant) AND public.is_platform_operator()); $$;
CREATE OR REPLACE FUNCTION public.agency_can_manage_child(_child uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS
$$ SELECT false $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = 'public' AS
$$ SELECT (SELECT p.active_tenant_id FROM public.profiles p
           WHERE p.user_id = auth.uid() AND p.active_tenant_id IS NOT NULL
             AND EXISTS (SELECT 1 FROM public.tenant_members m
                          WHERE m.user_id = auth.uid() AND m.tenant_id = p.active_tenant_id AND m.status = 'active')) $$;

-- ── The REAL chain: the publications store (this migration's P3 targets), then this migration ────
\ir ../migrations/20271113870000_content_publications.sql
\ir ../migrations/20271120110000_tenant_media_assets.sql

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
  BEGIN
    IF _db_role <> '' THEN EXECUTE format('SET LOCAL ROLE %I', _db_role); END IF;
    EXECUTE _sql INTO _r;
    RESET ROLE;
    RETURN 'ok:' || coalesce(_r, '<null>');
  EXCEPTION WHEN OTHERS THEN
    RETURN 'err:' || SQLSTATE || ':' || SQLERRM;
  END;
END $$;

-- ── Synthetic tenants/people/pieces (alpha=d0a1 with owner e001 + member e002; beta=d0b1 owner e003)
INSERT INTO public.tenants (id, slug) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'alpha'),
  ('00000000-0000-4000-8000-00000000d0b1', 'beta');
INSERT INTO auth.users (id) VALUES
  ('00000000-0000-4000-8000-00000000e001'),
  ('00000000-0000-4000-8000-00000000e002'),
  ('00000000-0000-4000-8000-00000000e003');
INSERT INTO public.tenant_members (tenant_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e001', 'owner'),
  ('00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-00000000e002', 'member'),
  ('00000000-0000-4000-8000-00000000d0b1', '00000000-0000-4000-8000-00000000e003', 'owner');
INSERT INTO public.profiles (user_id, active_tenant_id) VALUES
  ('00000000-0000-4000-8000-00000000e001', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e002', '00000000-0000-4000-8000-00000000d0a1'),
  ('00000000-0000-4000-8000-00000000e003', '00000000-0000-4000-8000-00000000d0b1');
INSERT INTO public.marketing_content (id, tenant_id, kind, title) VALUES
  ('00000000-0000-4000-8000-00000000a301', '00000000-0000-4000-8000-00000000d0a1', 'text', 'Alpha workshop reminder');

-- ── The cases ────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v text; _a1 uuid; _a2 uuid; _before timestamptz; _pub uuid; _p1 uuid; _p2 uuid;
BEGIN
  -- 1. Registration: the service path creates an uploading row; validation and the door-only gate.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT id::text FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'Spring webinar', 'video', NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'service path registers an uploading asset: ' || v);
  _a1 := substr(v, 4)::uuid;

  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT 1 FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'not-hex', NULL, NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:22023:MEDIA_INVALID%', 'a malformed stream uid is refused: ' || v);

  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', NULL, NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:MEDIA_FORBIDDEN%', 'a signed-in owner cannot register (door-only): ' || v);

  -- 2. Bind-once: the same provider video cannot take a second row for the tenant.
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT 1 FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NULL, NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:23505%', 'a duplicate (tenant, stream_uid) registration hits the unique index: ' || v);
  -- The same uid under ANOTHER tenant is a DIFFERENT library row (isolation, not collision).
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT id::text FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0b1'::uuid, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', NULL, NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:%', 'the same uid registers fine under the OTHER tenant (per-tenant libraries): ' || v);

  -- 3. The forward-only walk: uploading→processing→ready; every non-edge refused.
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'processing') $sql$, _a1::text));
  PERFORM pg_temp.chk(v LIKE 'ok:processing%', 'uploading → processing: ' || v);
  PERFORM pg_sleep(0.01);
  SELECT updated_at INTO _before FROM public.tenant_media_assets WHERE id = _a1;
  PERFORM pg_sleep(0.01);
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'ready', NULL, 1048576, 61.5) $sql$, _a1::text));
  PERFORM pg_temp.chk(v LIKE 'ok:ready%', 'processing → ready with size/duration: ' || v);
  PERFORM pg_temp.chk((SELECT updated_at FROM public.tenant_media_assets WHERE id = _a1) >= _before, 'updated_at never regresses on transition');
  PERFORM pg_temp.chk((SELECT bytes FROM public.tenant_media_assets WHERE id = _a1) = 1048576, 'bytes recorded on ready');

  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'processing') $sql$, _a1::text));
  PERFORM pg_temp.chk(v LIKE 'err:22023:MEDIA_WALK_INVALID%', 'ready → processing is not an edge (forward-only): ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'ready') $sql$, _a1::text));
  PERFORM pg_temp.chk(v LIKE 'err:22023:MEDIA_WALK_INVALID%', 'a same-status write is refused: ' || v);

  -- uploading → ready directly is refused (processing is mandatory between them).
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT id::text FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'cccccccccccccccccccccccccccccccc', NULL, NULL, NULL, NULL) $sql$);
  _a2 := substr(v, 4)::uuid;
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'ready') $sql$, _a2::text));
  PERFORM pg_temp.chk(v LIKE 'err:22023:MEDIA_WALK_INVALID%', 'uploading → ready directly is refused: ' || v);

  -- 4. outcome_unknown blocks re-registration (the library's retry gate).
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'processing') $sql$, _a2::text));
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'outcome_unknown', 'provider_processing') $sql$, _a2::text));
  PERFORM pg_temp.chk(v LIKE 'ok:outcome_unknown%', 'processing → outcome_unknown (the honest uncertain state): ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    $sql$ SELECT 1 FROM public.tenant_media_asset_register('00000000-0000-4000-8000-00000000d0a1'::uuid, 'cccccccccccccccccccccccccccccccc', NULL, NULL, NULL, NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:40P01:MEDIA_RETRY_PENDING_RECONCILIATION%', 'an unresolved uid refuses re-registration: ' || v);

  -- 5. Revoke is the retention terminal, from any live state; then frozen.
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT status FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'revoked') $sql$, _a2::text));
  PERFORM pg_temp.chk(v LIKE 'ok:revoked%', 'a live row can be revoked: ' || v);
  v := pg_temp.run('', 'service_role', 'service_role',
    format($sql$ SELECT 1 FROM public.tenant_media_asset_set_status(%L::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'processing') $sql$, _a2::text));
  PERFORM pg_temp.chk(v LIKE 'err:22023:MEDIA_WALK_INVALID%', 'revoked is terminal — nothing follows: ' || v);

  -- 6. Reads: members list their own workspace; the foreign owner sees only theirs; walls.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e002', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.tenant_media_asset_list(NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:2%', 'a plain member reads the workspace library (2 rows for alpha): ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.tenant_media_asset_list(NULL) $sql$);
  PERFORM pg_temp.chk(v LIKE 'ok:1%', 'the foreign owner sees only their own (1 row for beta): ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e003', 'authenticated', '',
    $sql$ SELECT count(*)::text FROM public.tenant_media_asset_list('00000000-0000-4000-8000-00000000d0a1'::uuid) $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:MEDIA_FORBIDDEN%', 'naming another workspace is refused: ' || v);
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 FROM public.tenant_media_asset_set_status('00000000-0000-4000-8000-000000000001'::uuid, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'revoked') $sql$);
  PERFORM pg_temp.chk(v LIKE 'err:42501:MEDIA_FORBIDDEN%', 'a signed-in owner cannot walk statuses (door-only): ' || v);

  -- 7. P3-1: the publications reconcile gate now fails loudly without a tenant.
  v := pg_temp.run('00000000-0000-4000-8000-00000000e001', 'authenticated', '',
    $sql$ SELECT 1 WHERE false $sql$);
  PERFORM set_config('test.uid', '', true);
  PERFORM pg_temp.chk(NOT public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', '00000000-0000-4000-8000-00000000d0a1'::uuid),
    'service path: no pending reconcile yet');
  -- A jwt-less call with NO tenant now raises instead of silently returning FALSE.
  BEGIN
    PERFORM public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', NULL::uuid);
    PERFORM pg_temp.chk(false, 'P3-1: a tenantless reconcile must RAISE, not answer FALSE');
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.chk(SQLSTATE = '22023' AND SQLERRM LIKE 'CONTENT_NO_TENANT%', 'P3-1: a tenantless reconcile raises CONTENT_NO_TENANT: ' || SQLSTATE);
  END;
  -- And the gate still holds TRUE for a real outcome_unknown attempt.
  PERFORM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered');
  SELECT id INTO _pub FROM public.content_publications WHERE status = 'registered' LIMIT 1;
  PERFORM public.content_publication_bind(_pub, '00000000-0000-4000-8000-00000000d0a1'::uuid, '00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', NULL, NULL, NULL);
  PERFORM public.content_publication_record(_pub, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'publishing');
  PERFORM public.content_publication_record(_pub, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'outcome_unknown');
  PERFORM pg_temp.chk(public.content_publication_pending_reconcile('00000000-0000-4000-8000-00000000a301'::uuid, 'instagram', '00000000-0000-4000-8000-00000000d0a1'::uuid),
    'an outcome_unknown attempt still holds the gate TRUE');

  -- 8. P3-2: same-timestamp receipts keep a deterministic order (created_at DESC, id DESC).
  PERFORM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered');
  PERFORM public.content_publication_record(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid, 'registered');
  SELECT id INTO _p1 FROM public.content_publications WHERE status = 'registered' ORDER BY id DESC LIMIT 1;
  SELECT id INTO _p2 FROM public.content_publications WHERE status = 'registered' ORDER BY id DESC OFFSET 1 LIMIT 1;
  UPDATE public.content_publications SET created_at = '2026-10-28T00:00:00Z' WHERE id IN (_p1, _p2);
  UPDATE public.content_publications SET created_at = '2026-10-28T00:00:00Z' WHERE id = _pub;
  PERFORM pg_temp.chk(
    (SELECT (id::text) FROM public.content_publication_list(NULL, '00000000-0000-4000-8000-00000000d0a1'::uuid) LIMIT 1)
      = (SELECT id::text FROM public.content_publications WHERE created_at = '2026-10-28T00:00:00Z' ORDER BY id::text DESC LIMIT 1),
    'P3-2: same-timestamp rows order by id DESC (deterministic)');

  -- 9. P3-3: the meter row is exactly-once per (tenant, job) at the database level.
  INSERT INTO public.platform_usage_events (tenant_id, event_type, quantity, unit, metadata)
  VALUES ('00000000-0000-4000-8000-00000000d0a1', 'media_usd', 0.42, 'usd', '{"job_id": "job-777"}');
  BEGIN
    INSERT INTO public.platform_usage_events (tenant_id, event_type, quantity, unit, metadata)
    VALUES ('00000000-0000-4000-8000-00000000d0a1', 'media_usd', 0.42, 'usd', '{"job_id": "job-777"}');
    PERFORM pg_temp.chk(false, 'P3-3: a duplicate meter row must be refused');
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.chk(true, 'P3-3: a duplicate (tenant, job_id) meter row is refused by the unique index');
  END;
  -- A different job meters fine.
  INSERT INTO public.platform_usage_events (tenant_id, event_type, quantity, unit, metadata)
  VALUES ('00000000-0000-4000-8000-00000000d0a1', 'media_usd', 0.10, 'usd', '{"job_id": "job-778"}');
  PERFORM pg_temp.chk((SELECT count(*) FROM public.platform_usage_events WHERE event_type = 'media_usd') = 2, 'distinct jobs meter independently');

  -- 10. Shape: RLS on, zero policies, no browser table grants.
  PERFORM pg_temp.chk((SELECT relrowsecurity FROM pg_class WHERE oid = 'public.tenant_media_assets'::regclass), 'RLS is enabled');
  PERFORM pg_temp.chk(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tenant_media_assets'), 'zero policies (RPC-only by design)');
  PERFORM pg_temp.chk(NOT has_table_privilege('authenticated', 'public.tenant_media_assets', 'SELECT'), 'authenticated holds no table grant');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 20 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'tenant_media_assets: % checks passed', _total;
END $$;
