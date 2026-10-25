-- Isolated empty local/CI PostgreSQL only. Original-shaped run fixture, not a
-- production authorization, complete schema, Work/receipt or customer scan proof.
-- The actual forward migration executes unchanged; all fixture data/roles roll back.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.tenants(id uuid PRIMARY KEY);
INSERT INTO public.tenants VALUES
 ('b4000000-0000-4000-8000-000000001111'),
 ('b4000000-0000-4000-8000-000000002222');
CREATE TABLE public.paige_systems_check_run (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
 scan_flavor text NOT NULL CHECK(scan_flavor IN('onboarding','scheduled','change_triggered')),
 started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 check_count int NOT NULL DEFAULT 0, pass_count int NOT NULL DEFAULT 0,
 fail_count int NOT NULL DEFAULT 0, triggered_by jsonb,
 selected_runner_keys text[], created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.paige_systems_check_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paige_systems_check_run FORCE ROW LEVEL SECURITY;
CREATE ROLE test_e2_manual_reader NOLOGIN;
GRANT SELECT ON public.paige_systems_check_run TO test_e2_manual_reader;
INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor)
 SELECT 'b4000000-0000-4000-8000-000000001111',v
 FROM unnest(ARRAY['onboarding','scheduled','change_triggered'])v;
CREATE TEMP TABLE original_runs AS SELECT * FROM public.paige_systems_check_run;
CREATE TEMP VIEW purpose_shape AS
 SELECT jsonb_build_object('owner',c.relowner,'acl',c.relacl::text,
 'rls',c.relrowsecurity,'force',c.relforcerowsecurity,
 'columns',(SELECT jsonb_agg(jsonb_build_object('name',a.attname,'type',a.atttypid,
  'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid))ORDER BY a.attnum)
  FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
  WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
 'indexes',(SELECT jsonb_agg(indexdef ORDER BY indexname)FROM pg_indexes
  WHERE schemaname='public' AND tablename='paige_systems_check_run'),
 'other_constraints',(SELECT jsonb_agg(pg_get_constraintdef(k.oid)ORDER BY k.conname)
  FROM pg_constraint k WHERE k.conrelid=c.oid AND k.conname NOT IN
  ('paige_systems_check_run_scan_flavor_check','paige_systems_check_run_manual_capture_check')),
 'timeout',current_setting('lock_timeout'))AS value
 FROM pg_class c WHERE c.oid='public.paige_systems_check_run'::regclass;
CREATE TEMP TABLE shape_before AS SELECT * FROM purpose_shape;
DO $$BEGIN
 BEGIN
  INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor,triggered_by)
   VALUES('b4000000-0000-4000-8000-000000001111','manual','{"scope":"tenant","action_filing":"none"}');
  RAISE EXCEPTION 'Old constraint incorrectly accepted the new purpose';
 EXCEPTION WHEN check_violation THEN NULL; END;
END$$;
\echo 'PASS: actual old constraint refuses manual before the forward migration'

\ir ../migrations/20271114220002_e02_manual_systems_capture.sql

DO $$DECLARE ctx jsonb; before_count bigint;
BEGIN
 IF(SELECT value FROM purpose_shape)IS DISTINCT FROM(SELECT value FROM shape_before)THEN
  RAISE EXCEPTION 'Original owner/default/columns/ACL/RLS/index/other constraints or timeout changed'; END IF;
 IF EXISTS(SELECT to_jsonb(r)FROM original_runs r EXCEPT
   SELECT to_jsonb(r)FROM public.paige_systems_check_run r)THEN
  RAISE EXCEPTION 'Original legacy run changed'; END IF;
 INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor)
  SELECT NULL,v FROM unnest(ARRAY['onboarding','scheduled','change_triggered'])v;
 INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor,triggered_by,selected_runner_keys)
  VALUES('b4000000-0000-4000-8000-000000001111','manual',
   '{"scope":"tenant","action_filing":"none","source":"original_work"}',NULL),
  ('b4000000-0000-4000-8000-000000002222','manual',
   '{"scope":"tenant","action_filing":"none"}',ARRAY['recorded_check']);
 SELECT count(*)INTO before_count FROM public.paige_systems_check_run;
 FOR ctx IN SELECT value FROM jsonb_array_elements('[null,{},0,[],"none",
  {"scope":"tenant"},{"action_filing":"none"},
  {"scope":"operator","action_filing":"none"},
  {"scope":"TENANT","action_filing":"none"},
  {"scope":"tenant","action_filing":"all"},
  {"scope":"tenant","action_filing":"delta"},
  {"scope":"tenant","action_filing":null}]')LOOP
  BEGIN
   INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor,triggered_by)
    VALUES('b4000000-0000-4000-8000-000000001111','manual',ctx);
   RAISE EXCEPTION 'Unsupported manual context accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
 END LOOP;
 BEGIN
  INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor,triggered_by)
   VALUES(NULL,'manual','{"scope":"tenant","action_filing":"none"}');
  RAISE EXCEPTION 'Tenant-less manual accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor)
   VALUES('b4000000-0000-4000-8000-000000001111','MANUAL');
  RAISE EXCEPTION 'Unknown purpose accepted';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.paige_systems_check_run SET scan_flavor='manual'WHERE scan_flavor='onboarding';
  RAISE EXCEPTION 'Legacy row silently relabeled as manual';
 EXCEPTION WHEN check_violation THEN NULL; END;
 BEGIN
  UPDATE public.paige_systems_check_run SET triggered_by='{"scope":"tenant","action_filing":"all"}'
   WHERE scan_flavor='manual';
  RAISE EXCEPTION 'Manual record allowed automatic remediation';
 EXCEPTION WHEN check_violation THEN NULL; END;
 IF before_count<>(SELECT count(*)FROM public.paige_systems_check_run)THEN
  RAISE EXCEPTION 'Refused write left a record'; END IF;
END$$;
\echo 'PASS: unchanged legacy records/defaults/ACL/RLS/indexes; manual tenant/none only; invalid writes roll back'
SET LOCAL ROLE test_e2_manual_reader;
DO $$BEGIN
 BEGIN
  INSERT INTO public.paige_systems_check_run(tenant_id,scan_flavor,triggered_by)
   VALUES('b4000000-0000-4000-8000-000000001111','manual','{"scope":"tenant","action_filing":"none"}');
  RAISE EXCEPTION 'Read-only role gained insertion';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN
  UPDATE public.paige_systems_check_run SET scan_flavor='manual';
  RAISE EXCEPTION 'Read-only role gained update';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END$$;
RESET ROLE;
\echo 'PASS: original read-only privilege cannot insert/update after the migration'
ROLLBACK;
DO $$BEGIN
 IF to_regclass('public.paige_systems_check_run')IS NOT NULL
  OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname='test_e2_manual_reader')THEN
  RAISE EXCEPTION 'Fixture rollback left table or role'; END IF;
END$$;
\echo 'PASS: fixture table, data and test role rolled back; no customer scan executed'
