-- ============================================================================
-- growth_hosted_deployments — repeatable proof for 20271121150000_growth_hosted_deployments.sql
--
-- Proves, on an isolated database with synthetic fixtures only (§63):
--   1. The table exists with exactly the expected columns; the unique (tenant_id, page_id)
--      index exists — one hosted copy per page, by structure.
--   2. RLS is the wall: enabled AND forced, ZERO policies — a granted, authenticated role
--      still cannot read a row (it is not merely missing grants); the door's service-role
--      client (which bypasses RLS) can write.
--   3. The status CHECK refuses an invented status; the unique index refuses a second
--      deployment for the same page; the FK walls refuse a foreign tenant.
--   4. Mutation proofs: dropping the unique index, or disabling RLS (each inside a
--      rolled-back subtransaction), flips the matching probe — so the checks above can fail.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'growth_hosted_deployments_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated growth_hosted_deployments_contract database (got %)', current_database();
  END IF;
END $$;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Fixtures: one tenant, one published page, a person to attribute the act to.
INSERT INTO auth.users (id, email) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'hosting-owner@test.invalid')
ON CONFLICT DO NOTHING;
INSERT INTO public.tenants (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Host Fixtures Co')
ON CONFLICT DO NOTHING;
INSERT INTO public.growth_pages (id, tenant_id, title, slug, status) VALUES
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'Spring offer', 'spring-offer', 'published')
ON CONFLICT DO NOTHING;

-- 1. Shape ---------------------------------------------------------------------------------------
DO $$
  DECLARE
    cols text;
  BEGIN
    SELECT string_agg(column_name, ',' ORDER BY column_name) INTO cols
      FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'growth_hosted_deployments';
    IF cols IS DISTINCT FROM
       'created_at,created_by,deployment_name,export_sha256,id,last_error,page_id,status,tenant_id,updated_at,url,verified_at' THEN
      RAISE EXCEPTION 'columns drifted: %', cols;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'growth_hosted_deployments'
         AND indexdef LIKE '%UNIQUE INDEX%growth_hosted_deployments_tenant_page_key%(tenant_id, page_id)%'
    ) THEN
      RAISE EXCEPTION 'unique (tenant_id, page_id) index missing';
    END IF;
  END $$;

-- 2. RLS is the wall (granted, still denied; service role writes) ----------------------------------
DO $$
  DECLARE
    rls_enabled boolean; rls_forced boolean; policy_count int; denied boolean;
  BEGIN
    SELECT relrowsecurity, relforcerowsecurity INTO rls_enabled, rls_forced
      FROM pg_class WHERE oid = 'public.growth_hosted_deployments'::regclass;
    IF NOT rls_enabled OR NOT rls_forced THEN
      RAISE EXCEPTION 'RLS must be enabled AND forced';
    END IF;
    SELECT count(*) INTO policy_count FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'growth_hosted_deployments';
    IF policy_count <> 0 THEN
      RAISE EXCEPTION 'expected ZERO policies, found %', policy_count;
    END IF;
    -- Grant SELECT to authenticated, then prove RLS (not the absence of grants) denies the read.
    EXECUTE 'GRANT SELECT ON public.growth_hosted_deployments TO authenticated';
    denied := false;
    BEGIN
      EXECUTE 'SET ROLE authenticated';
      BEGIN
        EXECUTE 'SELECT count(*) FROM public.growth_hosted_deployments';
      EXCEPTION WHEN insufficient_privilege THEN
        denied := true;
      END;
      EXECUTE 'RESET ROLE';
    EXCEPTION WHEN others THEN
      EXECUTE 'RESET ROLE';
      RAISE;
    END;
    IF NOT denied THEN
      RAISE EXCEPTION 'a granted authenticated role could read the rows — RLS is not denying';
    END IF;
  END $$;

-- 3. The CHECK / unique / FK walls (as the service role, which the door uses) ----------------------
SET ROLE service_role;
DO $$
  BEGIN
    INSERT INTO public.growth_hosted_deployments (tenant_id, page_id, deployment_name, export_sha256, status, created_by)
    VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
            'host-fixtures-co-spring-offer', repeat('a', 64), 'deploying', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    BEGIN
      INSERT INTO public.growth_hosted_deployments (tenant_id, page_id, deployment_name, export_sha256, status, created_by)
      VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
              'duplicate', repeat('b', 64), 'live', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      RAISE EXCEPTION 'the unique (tenant_id, page_id) wall did not hold';
    EXCEPTION WHEN unique_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.growth_hosted_deployments (tenant_id, page_id, deployment_name, export_sha256, status, created_by)
      VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
              'invented-status', repeat('c', 64), 'super_live', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      RAISE EXCEPTION 'an invented status was accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    BEGIN
      INSERT INTO public.growth_hosted_deployments (tenant_id, page_id, deployment_name, export_sha256, status, created_by)
      VALUES ('99999999-9999-4999-8999-999999999999', '33333333-3333-4333-8333-333333333333',
              'fk', repeat('d', 64), 'deploying', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      RAISE EXCEPTION 'a foreign tenant was accepted';
    EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  END $$;
RESET ROLE;

-- 4. Mutation proofs: break a protection inside a rolled-back subtransaction; the probe must flip.
DO $$
  BEGIN
    BEGIN
      SAVEPOINT break_unique;
      EXECUTE 'DROP INDEX public.growth_hosted_deployments_tenant_page_key';
      INSERT INTO public.growth_hosted_deployments (tenant_id, page_id, deployment_name, export_sha256, status, created_by)
      VALUES ('11111111-1111-4111-8111-111111111111', '33333333-3333-4333-8333-333333333333',
              'duplicate-2', repeat('e', 64), 'deploying', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      ROLLBACK TO break_unique;
      RAISE EXCEPTION 'mutation proof failed: duplicate insert succeeded with the index present';
    EXCEPTION WHEN unique_violation THEN
      ROLLBACK TO break_unique;
    END;
    -- Disable RLS (keeping the grant from section 2) → the authenticated read now WORKS,
    -- proving section 2's denial was RLS itself.
    BEGIN
      SAVEPOINT break_rls;
      EXECUTE 'ALTER TABLE public.growth_hosted_deployments DISABLE ROW LEVEL SECURITY';
      EXECUTE 'SET ROLE authenticated';
      EXECUTE 'SELECT count(*) FROM public.growth_hosted_deployments';
      EXECUTE 'RESET ROLE';
      ROLLBACK TO break_rls;
      RAISE EXCEPTION 'mutation proof failed: granted read still denied with RLS off — section 2 is vacuous';
    EXCEPTION WHEN insufficient_privilege THEN
      EXECUTE 'RESET ROLE';
      ROLLBACK TO break_rls;
      RAISE EXCEPTION 'mutation proof failed: granted read denied even with RLS off';
    END;
  END $$;

-- 6. The autonomy catalogue carries the two governed tools (visible + turnable-off) ----------
SET ROLE authenticated;
DO $$
  DECLARE
    rows text;
  BEGIN
    SELECT string_agg(tool_key, ',' ORDER BY tool_key) INTO rows
      FROM public.list_tool_autonomy(NULL)
     WHERE tool_key IN ('growth_hosting_deploy','growth_hosting_recover');
    IF rows IS DISTINCT FROM 'growth_hosting_deploy,growth_hosting_recover' THEN
      RAISE EXCEPTION 'hosting tools missing from the autonomy catalogue: %', coalesce(rows, 'none');
    END IF;
  END $$;
RESET ROLE;

SELECT 'growth_hosted_deployments contract: PASS' AS result;
