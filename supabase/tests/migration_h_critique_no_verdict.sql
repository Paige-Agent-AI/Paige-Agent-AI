-- ============================================================================
-- Migration H (screenshots on paige-browser) — repeatable proof for
--   20270556000000_studio_visual_critique_no_verdict.sql
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database
-- with synthetic fixtures only (§63). The table's prior definition is loaded by running its REAL
-- creating migration (20260719140000); no later migration touches it before H. Section 0 proves the
-- result is production's: md5 fingerprints of the columns, constraints, policies and indexes, the
-- exact grant list, and the RLS flags, all read from project xygzykjyynhzqytbqnzu on 2026-10-04
-- (Postgres 17.6; zero rows in the table; H not yet in schema_migrations). auth.role() is
-- production's body verbatim; current_user_tenant_id() is a synthetic stand-in with production's
-- signature, so the policy expressions print identically.
--
-- What it proves:
--   0. The prior definition is production's.
--   1. Every row written under the old constraint (each of SHIP / ITERATE / BLOCK, two workspaces)
--      survives byte-identical.
--   2. NO_VERDICT is accepted; SHIP / ITERATE / BLOCK still are; every other value is refused
--      (23514) — including case and spacing variants; NULL is refused (23502); verdict stays
--      NOT NULL; the constraint is validated and there is exactly one of it.
--   3. Columns, the other constraints, policies, indexes, grants, ACL and the RLS flags are
--      unchanged; the only other change is the three column comments. Behaviourally: a workspace
--      still reads only its own rows (including a NO_VERDICT row), cannot insert, anon reads nothing,
--      and the service seam can write NO_VERDICT.
--   4. Mutation proofs over the REAL migration text: dropping the old values, making the column
--      nullable, omitting NO_VERDICT, dropping the check, or admitting another value each makes a
--      probe answer differently — so the checks above can fail.
--
-- Run from the repository root (section 4 reads the migration text with a shell backtick).
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'migration_h_critique_no_verdict_contract' THEN
    RAISE EXCEPTION 'This fixture requires the isolated migration_h_critique_no_verdict_contract database (got %)', current_database();
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- ── What the creating migration depends on ───────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
-- Production's body, verbatim (pg_get_functiondef, 2026-10-04).
CREATE OR REPLACE FUNCTION auth.role()
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  select
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$function$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.tenants (id uuid PRIMARY KEY, name text NOT NULL);
-- Synthetic stand-in, production's signature: the workspace named in the test claims.
CREATE OR REPLACE FUNCTION public.current_user_tenant_id()
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$ SELECT nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'tenant', '')::uuid $$;
GRANT EXECUTE ON FUNCTION public.current_user_tenant_id() TO anon, authenticated, service_role;

INSERT INTO public.tenants (id, name) VALUES
  ('00000000-0000-4000-8000-00000000d0a1', 'Synthetic A'),
  ('00000000-0000-4000-8000-00000000d0b1', 'Synthetic B')
ON CONFLICT DO NOTHING;

-- ── The table's prior definition: its REAL creating migration ────────────────────────────────────
\ir ../migrations/20260719140000_studio_visual_critique_log.sql

-- ── Harness ──────────────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _checks (n serial, ok boolean, what text);
CREATE FUNCTION pg_temp.chk(_ok boolean, _what text) RETURNS void LANGUAGE sql AS
$$ INSERT INTO _checks (ok, what) VALUES (coalesce(_ok, false), _what) $$;

-- Fingerprints, computed exactly as they were computed on production.
CREATE FUNCTION pg_temp.fp() RETURNS jsonb LANGUAGE sql AS $$
  WITH t AS (SELECT 'public.studio_visual_critique_log'::regclass r)
  SELECT jsonb_build_object(
   'cols', (SELECT md5(string_agg(attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::text||':'||coalesce(pg_get_expr(d.adbin,d.adrelid),''), ',' ORDER BY attnum))
              FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum, t
             WHERE a.attrelid=t.r AND attnum>0 AND NOT attisdropped),
   'cons', (SELECT md5(string_agg(conname||':'||contype::text||':'||pg_get_constraintdef(c.oid), ',' ORDER BY conname)) FROM pg_constraint c, t WHERE conrelid=t.r),
   'cons_other', (SELECT md5(string_agg(conname||':'||contype::text||':'||pg_get_constraintdef(c.oid), ',' ORDER BY conname)) FROM pg_constraint c, t
                   WHERE conrelid=t.r AND conname<>'studio_visual_critique_verdict_chk'),
   'pols', (SELECT md5(string_agg(polname||':'||polcmd::text||':'||polpermissive::text||':'||array_to_string(polroles::regrole[]::text[],',')||':'||coalesce(pg_get_expr(polqual,polrelid),'')||':'||coalesce(pg_get_expr(polwithcheck,polrelid),''), ',' ORDER BY polname))
              FROM pg_policy p, t WHERE polrelid=t.r),
   'idx', (SELECT md5(string_agg(indexdef, ',' ORDER BY indexname)) FROM pg_indexes WHERE schemaname='public' AND tablename='studio_visual_critique_log'),
   'grants', (SELECT string_agg(grantee||':'||privilege_type, ',' ORDER BY grantee, privilege_type) FROM information_schema.role_table_grants
               WHERE table_schema='public' AND table_name='studio_visual_critique_log'),
   'rls', (SELECT relrowsecurity::text||'/'||relforcerowsecurity::text FROM pg_class, t WHERE oid=t.r),
   'acl', (SELECT relacl::text FROM pg_class, t WHERE oid=t.r),
   'owner', (SELECT pg_get_userbyid(relowner) FROM pg_class, t WHERE oid=t.r),
   'trg', (SELECT count(*) FROM pg_trigger, t WHERE tgrelid=t.r AND NOT tgisinternal),
   'comments', (SELECT coalesce(jsonb_object_agg(coalesce(a.attname::text, '<table>'), d.description), '{}'::jsonb)
                  FROM pg_description d LEFT JOIN pg_attribute a ON a.attrelid=d.objoid AND a.attnum=d.objsubid, t
                 WHERE d.objoid=t.r AND d.classoid='pg_class'::regclass)
  ) $$;

-- Insert one row with this verdict and report what happened ('ok' or 'err:<SQLSTATE>'); the row is
-- always rolled back, so a probe leaves nothing behind.
CREATE FUNCTION pg_temp.try_verdict(_v text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    INSERT INTO public.studio_visual_critique_log (tenant_id, artifact_kind, image_source, verdict)
    VALUES ('00000000-0000-4000-8000-00000000d0a1', 'image', 'image_url', _v);
    RAISE EXCEPTION USING ERRCODE = 'ZZ997', MESSAGE = 'roll back the probe row';
  EXCEPTION
    WHEN SQLSTATE 'ZZ997' THEN RETURN 'ok';
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;

CREATE TEMP TABLE _probe_values (v text, label text PRIMARY KEY);
INSERT INTO _probe_values (v, label) VALUES
  ('SHIP', 'SHIP'), ('ITERATE', 'ITERATE'), ('BLOCK', 'BLOCK'), ('NO_VERDICT', 'NO_VERDICT'),
  ('BOGUS', 'BOGUS'), ('ship', 'ship'), ('no_verdict', 'no_verdict'), ('NO VERDICT', 'NO VERDICT'),
  (' SHIP', 'leading space'), ('NO_VERDICT ', 'trailing space'), ('', 'empty'), ('PASS', 'PASS'),
  ('ERROR', 'ERROR'), (NULL, 'NULL');

CREATE FUNCTION pg_temp.probes() RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_object_agg(label, pg_temp.try_verdict(v)) FROM _probe_values $$;

-- Every row's full content, so "survives" means byte-identical, not merely present.
CREATE FUNCTION pg_temp.rows_md5(_ids uuid[]) RETURNS text LANGUAGE sql AS $$
  SELECT md5(string_agg(to_jsonb(l)::text, E'\n' ORDER BY l.id)) FROM public.studio_visual_critique_log l WHERE l.id = ANY(_ids) $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 0. The prior definition is production's
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
CREATE TEMP TABLE _fp_before AS SELECT pg_temp.fp() AS fp;
DO $$
DECLARE f jsonb := (SELECT fp FROM _fp_before);
BEGIN
  PERFORM pg_temp.chk(f->>'cols' = 'c79873c72ef5226ac64b217f614555cf', 'prior columns = production (md5 c79873c7..., 2026-10-04): ' || (f->>'cols'));
  PERFORM pg_temp.chk(f->>'cons' = '9c9b7fcfbcfd240bdf9eac26ef457042', 'prior constraints = production (md5 9c9b7fcf...): ' || (f->>'cons'));
  PERFORM pg_temp.chk(f->>'cons_other' = '5ff651132c16fbdb7a2795c557cdf780', 'prior non-verdict constraints = production (md5 5ff65113...): ' || (f->>'cons_other'));
  PERFORM pg_temp.chk(f->>'pols' = '76c3e27f5fdafb150240829468a8a936', 'prior policies = production (md5 76c3e27f...): ' || (f->>'pols'));
  PERFORM pg_temp.chk(f->>'idx' = '19d7836ddd358f2a3cc060763807868d', 'prior indexes = production (md5 19d7836d...): ' || (f->>'idx'));
  PERFORM pg_temp.chk(f->>'grants' = 'authenticated:SELECT,postgres:DELETE,postgres:INSERT,postgres:REFERENCES,postgres:SELECT,postgres:TRIGGER,postgres:TRUNCATE,postgres:UPDATE,service_role:DELETE,service_role:INSERT,service_role:REFERENCES,service_role:SELECT,service_role:TRIGGER,service_role:TRUNCATE,service_role:UPDATE',
    'prior grants = production: ' || (f->>'grants'));
  PERFORM pg_temp.chk(f->>'rls' = 'true/false', 'prior RLS = production (enabled, not forced)');
  PERFORM pg_temp.chk(f->>'owner' = 'postgres', 'prior owner = production (postgres)');
  PERFORM pg_temp.chk((f->>'trg')::int = 0, 'prior: no triggers, as on production');
  PERFORM pg_temp.chk(f->'comments' = '{}'::jsonb, 'prior: no comments, as on production');
  PERFORM pg_temp.chk((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'studio_visual_critique_verdict_chk')
      = 'CHECK ((verdict = ANY (ARRAY[''SHIP''::text, ''ITERATE''::text, ''BLOCK''::text])))',
    'prior verdict check = production''s exact text');
END $$;

-- ── Rows written under the old constraint: each old verdict, two workspaces, varied columns ──────
INSERT INTO public.studio_visual_critique_log
  (id, tenant_id, session_id, deliverable_id, artifact_kind, image_source, iteration, verdict, summary, findings, model,
   cost_estimate_usd, spent_usd, capped, low_confidence, created_by, created_at) VALUES
  ('00000000-0000-4000-8000-0000000c0001', '00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-0000000e5001', NULL,
   'image', 'image_url', 0, 'SHIP', 'Clean hierarchy.', '{"blockers":[],"should_fix":[],"nits":["tighten tracking"],"cheesy_tells_hit":[]}',
   'vision-model-x', 0.0123, 0.0123, false, false, NULL, '2026-09-01T10:00:00Z'),
  ('00000000-0000-4000-8000-0000000c0002', '00000000-0000-4000-8000-00000000d0a1', '00000000-0000-4000-8000-0000000e5001', '00000000-0000-4000-8000-0000000de001',
   'page', 'render', 1, 'ITERATE', 'The hero fights the form.', '{"blockers":[],"should_fix":["hero contrast"],"nits":[],"cheesy_tells_hit":["glow"]}',
   'vision-model-x', 0.0200, 0.0323, false, false, '00000000-0000-4000-8000-00000000e001', '2026-09-01T10:01:00Z'),
  ('00000000-0000-4000-8000-0000000c0003', '00000000-0000-4000-8000-00000000d0a1', NULL, NULL,
   'funnel', 'render', 3, 'BLOCK', NULL, '{}', NULL, NULL, 2.0100, true, true, NULL, '2026-09-01T10:02:00Z'),
  ('00000000-0000-4000-8000-0000000c0004', '00000000-0000-4000-8000-00000000d0b1', NULL, NULL,
   'form', 'image_url', 0, 'SHIP', 'Fine.', '{}', 'vision-model-y', 0.0050, 0.0050, false, false, NULL, '2026-09-02T09:00:00Z'),
  ('00000000-0000-4000-8000-0000000c0005', '00000000-0000-4000-8000-00000000d0b1', NULL, NULL,
   'page', 'render', 0, 'ITERATE', 'Spacing.', '{"should_fix":["spacing"]}', 'vision-model-y', 0.0060, 0.0110, false, false, NULL, '2026-09-02T09:01:00Z'),
  ('00000000-0000-4000-8000-0000000c0006', '00000000-0000-4000-8000-00000000d0b1', NULL, NULL,
   'image', 'image_url', 2, 'BLOCK', 'Off-brand.', '{"blockers":["off-brand palette"]}', 'vision-model-y', 0.0070, 0.0180, false, false, NULL, '2026-09-02T09:02:00Z');

CREATE TEMP TABLE _old_ids AS SELECT array_agg(id ORDER BY id) AS ids FROM public.studio_visual_critique_log;
CREATE TEMP TABLE _rows_before AS SELECT pg_temp.rows_md5((SELECT ids FROM _old_ids)) AS h,
  (SELECT jsonb_object_agg(verdict, n) FROM (SELECT verdict, count(*) n FROM public.studio_visual_critique_log GROUP BY verdict) x) AS by_verdict;
CREATE TEMP TABLE _probes_before AS SELECT pg_temp.probes() AS p;

-- The migration text, for the mutation proofs in section 4 (read from the repository root).
\set h_sql `cat supabase/migrations/20270556000000_studio_visual_critique_no_verdict.sql`
SELECT set_config('migration_h.sql', :'h_sql', false) IS NOT NULL AS h_loaded \gset

-- ── The REAL migration, twice (clean application + replay) ───────────────────────────────────────
\ir ../migrations/20270556000000_studio_visual_critique_no_verdict.sql
\ir ../migrations/20270556000000_studio_visual_critique_no_verdict.sql

CREATE TEMP TABLE _fp_after AS SELECT pg_temp.fp() AS fp;
CREATE TEMP TABLE _probes_after AS SELECT pg_temp.probes() AS p;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. The old rows survive
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  PERFORM pg_temp.chk((SELECT by_verdict FROM _rows_before) = '{"SHIP": 2, "ITERATE": 2, "BLOCK": 2}'::jsonb,
    'fixture: two rows of each old verdict were written under the old constraint');
  PERFORM pg_temp.chk(pg_temp.rows_md5((SELECT ids FROM _old_ids)) = (SELECT h FROM _rows_before),
    'every old row survives byte-identical (all 17 columns)');
  PERFORM pg_temp.chk((SELECT count(*) FROM public.studio_visual_critique_log) = 6, 'no row added or removed by the migration');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. What the verdict column accepts
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE b jsonb := (SELECT p FROM _probes_before); a jsonb := (SELECT p FROM _probes_after); rec record;
BEGIN
  -- Before: exactly the three; NO_VERDICT refused (the measured gap).
  PERFORM pg_temp.chk(b->>'SHIP' = 'ok' AND b->>'ITERATE' = 'ok' AND b->>'BLOCK' = 'ok', 'before: the three old verdicts are accepted');
  PERFORM pg_temp.chk(b->>'NO_VERDICT' = 'err:23514', 'before: NO_VERDICT is refused by the check (' || (b->>'NO_VERDICT') || ')');
  PERFORM pg_temp.chk(b->>'NULL' = 'err:23502', 'before: NULL is refused by NOT NULL (' || (b->>'NULL') || ')');
  -- After.
  FOR rec IN SELECT label FROM _probe_values LOOP
    CASE
      WHEN rec.label IN ('SHIP', 'ITERATE', 'BLOCK', 'NO_VERDICT') THEN
        PERFORM pg_temp.chk(a->>rec.label = 'ok', format('after: %s is accepted (%s)', rec.label, a->>rec.label));
      WHEN rec.label = 'NULL' THEN
        PERFORM pg_temp.chk(a->>rec.label = 'err:23502', format('after: NULL is still refused by NOT NULL (%s)', a->>rec.label));
      ELSE
        PERFORM pg_temp.chk(a->>rec.label = 'err:23514', format('after: "%s" is still refused by the check (%s)', rec.label, a->>rec.label));
        PERFORM pg_temp.chk(b->>rec.label = a->>rec.label, format('"%s" answers as it did before (%s / %s)', rec.label, b->>rec.label, a->>rec.label));
    END CASE;
  END LOOP;
  -- Exactly one answer changed: NO_VERDICT.
  PERFORM pg_temp.chk((SELECT array_agg(k ORDER BY k) FROM jsonb_each_text(a) e(k, v) WHERE v IS DISTINCT FROM b->>k) = ARRAY['NO_VERDICT'],
    'NO_VERDICT is the only value whose answer changed');
  PERFORM pg_temp.chk((SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.studio_visual_critique_log'::regclass AND attname = 'verdict'),
    'verdict stays NOT NULL');
  PERFORM pg_temp.chk((SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'studio_visual_critique_verdict_chk')
      = 'CHECK ((verdict = ANY (ARRAY[''SHIP''::text, ''ITERATE''::text, ''BLOCK''::text, ''NO_VERDICT''::text])))',
    'the verdict check is exactly the old list plus NO_VERDICT');
  PERFORM pg_temp.chk((SELECT convalidated FROM pg_constraint WHERE conname = 'studio_visual_critique_verdict_chk'),
    'the verdict check is validated (it holds for every existing row, not NOT VALID)');
  PERFORM pg_temp.chk((SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.studio_visual_critique_log'::regclass AND contype = 'c'
                        AND pg_get_constraintdef(oid) LIKE '%verdict%') = 1,
    'exactly one check on verdict — the replay did not stack a second');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 3. Nothing else changed — structurally and behaviourally
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
DO $$
DECLARE b jsonb := (SELECT fp FROM _fp_before); a jsonb := (SELECT fp FROM _fp_after); k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['cols', 'cons_other', 'pols', 'idx', 'grants', 'rls', 'acl', 'owner', 'trg'] LOOP
    PERFORM pg_temp.chk(a->>k IS NOT DISTINCT FROM b->>k, format('%s unchanged (%s)', k, left(coalesce(a->>k, '<null>'), 60)));
  END LOOP;
  PERFORM pg_temp.chk(a->>'cons' IS DISTINCT FROM b->>'cons', 'the constraint set did change (only the verdict check, per cons_other)');
  PERFORM pg_temp.chk((SELECT array_agg(k2 ORDER BY k2) FROM jsonb_object_keys(a->'comments') k2) = ARRAY['cost_estimate_usd', 'image_source', 'verdict'],
    'the only other change: comments on verdict, image_source and cost_estimate_usd');
  PERFORM pg_temp.chk(a->'comments'->>'verdict' LIKE '%NO_VERDICT%findings.reason%Never a fabricated verdict.', 'the verdict comment names NO_VERDICT and where its reason code lives (findings.reason)');
  PERFORM pg_temp.chk(a->'comments'->>'image_source' LIKE '%paige-browser /render%', 'the image_source comment names paige-browser /render');
  PERFORM pg_temp.chk(a->'comments'->>'cost_estimate_usd' LIKE '%ESTIMATE%never a billed figure.', 'the cost comment labels it an estimate');
  PERFORM pg_temp.chk(NOT has_table_privilege('anon', 'public.studio_visual_critique_log', 'SELECT')
     AND NOT has_table_privilege('authenticated', 'public.studio_visual_critique_log', 'INSERT')
     AND NOT has_table_privilege('authenticated', 'public.studio_visual_critique_log', 'UPDATE')
     AND NOT has_table_privilege('authenticated', 'public.studio_visual_critique_log', 'DELETE')
     AND has_table_privilege('authenticated', 'public.studio_visual_critique_log', 'SELECT')
     AND has_table_privilege('service_role', 'public.studio_visual_critique_log', 'INSERT'),
    'privileges: anon none; authenticated SELECT only; service_role writes');
END $$;

-- The service seam writes a NO_VERDICT row, as the edge function now does.
SET ROLE service_role;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', false) IS NOT NULL AS _ \gset
INSERT INTO public.studio_visual_critique_log (id, tenant_id, artifact_kind, image_source, verdict, findings, low_confidence)
VALUES ('00000000-0000-4000-8000-0000000c0007', '00000000-0000-4000-8000-00000000d0a1', 'page', 'render', 'NO_VERDICT',
        '{"reason":"screenshot_service_unavailable","detail":"PAIGE_BROWSER_URL / PAIGE_BROWSER_SECRET are not set"}', false);
RESET ROLE;
SELECT set_config('request.jwt.claims', '', false) IS NOT NULL AS _ \gset

CREATE FUNCTION pg_temp.as_role(_role text, _claims text, _sql text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE _r text;
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claims', _claims, true);
    EXECUTE format('SET LOCAL ROLE %I', _role);
    EXECUTE _sql INTO _r;
    RAISE EXCEPTION USING ERRCODE = 'ZZ996', MESSAGE = coalesce(_r, '<null>');
  EXCEPTION
    WHEN SQLSTATE 'ZZ996' THEN RETURN SQLERRM;
    WHEN OTHERS THEN RETURN 'err:' || SQLSTATE;
  END;
END $$;

DO $$
DECLARE _a text := '{"role":"authenticated","tenant":"00000000-0000-4000-8000-00000000d0a1"}';
        _b text := '{"role":"authenticated","tenant":"00000000-0000-4000-8000-00000000d0b1"}';
BEGIN
  PERFORM pg_temp.chk(pg_temp.as_role('authenticated', _a,
      'SELECT string_agg(verdict, '','' ORDER BY id) FROM public.studio_visual_critique_log')
    = 'SHIP,ITERATE,BLOCK,NO_VERDICT', 'workspace A reads exactly its own rows, including its NO_VERDICT row');
  PERFORM pg_temp.chk(pg_temp.as_role('authenticated', _b,
      'SELECT string_agg(verdict, '','' ORDER BY id) FROM public.studio_visual_critique_log')
    = 'SHIP,ITERATE,BLOCK', 'workspace B reads exactly its own rows — never A''s NO_VERDICT row');
  PERFORM pg_temp.chk(pg_temp.as_role('authenticated', _a,
      $q$INSERT INTO public.studio_visual_critique_log (tenant_id, artifact_kind, image_source, verdict)
         VALUES ('00000000-0000-4000-8000-00000000d0a1', 'image', 'image_url', 'NO_VERDICT') RETURNING 'inserted'$q$)
    = 'err:42501', 'a workspace still cannot insert, NO_VERDICT included (42501)');
  PERFORM pg_temp.chk(pg_temp.as_role('anon', '{"role":"anon"}',
      'SELECT count(*)::text FROM public.studio_visual_critique_log') = 'err:42501', 'anon still reads nothing (42501)');
  PERFORM pg_temp.chk((SELECT verdict || ':' || (findings->>'reason') FROM public.studio_visual_critique_log
                        WHERE id = '00000000-0000-4000-8000-0000000c0007') = 'NO_VERDICT:screenshot_service_unavailable',
    'the service seam wrote a NO_VERDICT row with its reason code in findings.reason');
END $$;

-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- 4. Mutation proofs over the REAL migration text, each inside a rolled-back subtransaction
-- ═════════════════════════════════════════════════════════════════════════════════════════════════
-- Each mutation is applied over the post-migration database (old rows + the NO_VERDICT row present),
-- then the probes run again. 'applied' or 'err:<SQLSTATE>' records whether the mutated text ran.
DO $$
DECLARE
  _h text := current_setting('migration_h.sql');
  _old_list constant text := $l$'SHIP', 'ITERATE', 'BLOCK', 'NO_VERDICT'$l$;
  _base jsonb := pg_temp.probes();
  _mutations jsonb := jsonb_build_object(
    'drop the old values',              replace(_h, _old_list, $l$'NO_VERDICT'$l$),
    'drop the old values, NOT VALID',   replace(replace(_h, _old_list, $l$'NO_VERDICT'$l$), $l$'NO_VERDICT'));$l$, $l$'NO_VERDICT')) NOT VALID;$l$),
    'make verdict nullable',            _h || E'\nALTER TABLE public.studio_visual_critique_log ALTER COLUMN verdict DROP NOT NULL;\n',
    'omit NO_VERDICT',                  replace(_h, _old_list, $l$'SHIP', 'ITERATE', 'BLOCK'$l$),
    'drop the check, add none',         replace(_h, E'ALTER TABLE public.studio_visual_critique_log\n  ADD CONSTRAINT studio_visual_critique_verdict_chk\n  CHECK (verdict IN (' || _old_list || '));', ''),
    'admit another value',              replace(_h, _old_list, _old_list || $l$, 'BOGUS'$l$));
  m text; _sql text; _applied text; _mut jsonb; _results jsonb := '{}'::jsonb;
BEGIN
  PERFORM pg_temp.chk(length(_h) > 500 AND position('NO_VERDICT' IN _h) > 0, 'the migration text was read for the mutations');
  FOR m, _sql IN SELECT key, value FROM jsonb_each_text(_mutations) LOOP
    PERFORM pg_temp.chk(_sql <> _h, format('mutation "%s" actually changes the migration text', m));
    BEGIN
      BEGIN
        EXECUTE _sql;
        _applied := 'applied';
      EXCEPTION WHEN OTHERS THEN _applied := 'err:' || SQLSTATE;
      END;
      _mut := pg_temp.probes();
      _results := _results || jsonb_build_object(m, jsonb_build_object('applied', _applied, 'probes', _mut,
        'validated', (SELECT convalidated FROM pg_constraint WHERE conname = 'studio_visual_critique_verdict_chk')));
      RAISE EXCEPTION USING ERRCODE = 'ZZ998', MESSAGE = 'roll back the mutation';
    EXCEPTION WHEN SQLSTATE 'ZZ998' THEN NULL;
    END;
  END LOOP;

  -- Dropping the old values: the migration itself fails over the old rows ...
  PERFORM pg_temp.chk(_results->'drop the old values'->>'applied' = 'err:23514',
    'mutation "drop the old values" is caught: it cannot apply over the old rows (' || (_results->'drop the old values'->>'applied') || ')');
  -- ... and forced through with NOT VALID, the old verdicts are refused and the check is unvalidated.
  PERFORM pg_temp.chk(_results->'drop the old values, NOT VALID'->>'applied' = 'applied'
      AND _results->'drop the old values, NOT VALID'->'probes'->>'SHIP' = 'err:23514'
      AND _results->'drop the old values, NOT VALID'->'probes'->>'ITERATE' = 'err:23514'
      AND _results->'drop the old values, NOT VALID'->'probes'->>'BLOCK' = 'err:23514'
      AND _results->'drop the old values, NOT VALID'->>'validated' = 'false',
    'mutation "drop the old values, NOT VALID" is caught: the old verdicts are refused and the check is unvalidated: ' || (_results->>'drop the old values, NOT VALID'));
  PERFORM pg_temp.chk(_results->'make verdict nullable'->>'applied' = 'applied'
      AND _results->'make verdict nullable'->'probes'->>'NULL' = 'ok' AND _base->>'NULL' = 'err:23502',
    'mutation "make verdict nullable" is caught: a NULL verdict is accepted (' || (_results->'make verdict nullable'->'probes'->>'NULL') || ')');
  PERFORM pg_temp.chk(_results->'omit NO_VERDICT'->>'applied' = 'err:23514',
    'mutation "omit NO_VERDICT" is caught: it cannot apply over the NO_VERDICT row (' || (_results->'omit NO_VERDICT'->>'applied') || ')');
  PERFORM pg_temp.chk(_results->'drop the check, add none'->>'applied' = 'applied'
      AND _results->'drop the check, add none'->'probes'->>'BOGUS' = 'ok' AND _base->>'BOGUS' = 'err:23514',
    'mutation "drop the check, add none" is caught: any value is accepted (' || (_results->'drop the check, add none'->'probes'->>'BOGUS') || ')');
  PERFORM pg_temp.chk(_results->'admit another value'->>'applied' = 'applied'
      AND _results->'admit another value'->'probes'->>'BOGUS' = 'ok',
    'mutation "admit another value" is caught: BOGUS is accepted (' || (_results->'admit another value'->'probes'->>'BOGUS') || ')');
  -- The protected answers, so a probe that never ran cannot pass.
  PERFORM pg_temp.chk(_base = (SELECT p FROM _probes_after), 'protected: the probes answer as in section 2 before any mutation');
  -- Every mutation was rolled back.
  PERFORM pg_temp.chk(pg_temp.probes() = _base
      AND pg_temp.fp() = (SELECT fp FROM _fp_after)
      AND (SELECT count(*) FROM public.studio_visual_critique_log) = 7,
    'every mutation was rolled back');
END $$;

-- ── Verdict ──────────────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE _total int; _bad int; _first text;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT ok) INTO _total, _bad FROM _checks;
  SELECT string_agg(left(what, 240), E'\n  ' ORDER BY n) INTO _first FROM (SELECT n, what FROM _checks WHERE NOT ok ORDER BY n LIMIT 40) f;
  IF _total < 50 THEN RAISE EXCEPTION 'only % checks ran — the suite did not execute', _total; END IF;
  IF _bad > 0 THEN RAISE EXCEPTION E'% of % checks failed:\n  %', _bad, _total, _first; END IF;
  RAISE NOTICE 'migration_h_critique_no_verdict: % checks passed', _total;
END $$;
