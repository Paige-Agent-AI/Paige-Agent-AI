-- ============================================================================
-- EXP08 PAIGE team lifecycle — repeatable proof for
-- 20271116100008_exp08_paige_team_lifecycle_catalogue.sql (five `Team` rows in list_tool_autonomy).
--
-- Run against the REAL migration (\ir, twice: clean application + replay) on an isolated database with
-- synthetic fixtures only (§63). The whole run is one transaction that ROLLS BACK.
--
-- HONEST SCOPE (§13). The catalogue the migration wraps is built here in two layers:
--   * the e09 request-share wrapper (20271115020009), copied VERBATIM from that migration, and asserted
--     to hash to 2e8dba155891e8203d9251d141687855 — the md5(pg_get_functiondef) read from production
--     2026-10-26 and the value this migration's guard requires. So the guard is proven against
--     production's real incumbent definition, byte for byte;
--   * under it, a STAND-IN for everything older (`_list_tool_autonomy_before_e09_request_share`): the
--     production signature, return shape and tenant rule (the caller's active business; a platform owner
--     may name one; anyone else naming another is refused) with three synthetic rows. It is not
--     production's older body.
-- What this proves:
--   1. the guard REFUSES an incumbent that is not production's (no rename, nothing wrapped), and on a
--      replay REFUSES when a later wrapper sits on top of this one (it would otherwise be overwritten);
--   2. against production's incumbent it applies; every earlier row is forwarded unchanged (modes
--      included), in order, before exactly five new Team rows that ask first by default;
--   3. a stored mode reads back; another tenant is unaffected; a foreign-tenant request is still refused;
--   4. replay is a no-op: the incumbent is renamed once, never twice, and both definitions are identical;
--   5. grants: the predecessor is private; the wrapper keeps authenticated + service_role and gives anon
--      nothing; SECURITY DEFINER, STABLE, pinned search_path.
-- The guard cases read the migration's own guard block out of the file (psql backticks), so the block
-- tested is the block that ships. Run from the repository root. Its two guard refusals print as psql
-- ERROR lines by design ("Original autonomy catalogue changed…", "…after the EXP08 team lifecycle rows…");
-- each is then asserted on its exact text, and the run still ends `all 20 assertions ran`.
-- ============================================================================
\set ON_ERROR_STOP on

DO $$ BEGIN
  IF current_database() <> 'exp08_lifecycle_cat' THEN
    RAISE EXCEPTION 'This fixture requires the isolated exp08_lifecycle_cat database (got %)', current_database();
  END IF;
END $$;

BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')          THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')  THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
END $$;

-- ── Count-enforcing pgTAP-compatible shim (a skipped assertion cannot pass silently). ──────────────
CREATE TABLE _pgtap_state(planned integer NOT NULL, executed integer NOT NULL);
CREATE FUNCTION plan(integer) RETURNS text LANGUAGE plpgsql AS $$
BEGIN DELETE FROM _pgtap_state; INSERT INTO _pgtap_state VALUES($1,0); RETURN '1..'||$1; END $$;
CREATE FUNCTION _pgtap_tick() RETURNS void LANGUAGE plpgsql AS $$
BEGIN UPDATE _pgtap_state SET executed=executed+1; IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: no plan set'; END IF; END $$;
CREATE FUNCTION ok(boolean, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %', $2; END IF; RETURN 'ok - '||$2; END $$;
CREATE FUNCTION is(anyelement, anyelement, text) RETURNS text LANGUAGE plpgsql AS $$
BEGIN PERFORM _pgtap_tick();
  IF $1 IS DISTINCT FROM $2 THEN RAISE EXCEPTION 'FAIL: %  (got %, expected %)', $3, $1, $2; END IF;
  RETURN 'ok - '||$3; END $$;
CREATE FUNCTION finish() RETURNS text LANGUAGE plpgsql AS $$
DECLARE s _pgtap_state; BEGIN SELECT * INTO s FROM _pgtap_state;
  IF s.executed <> s.planned THEN RAISE EXCEPTION 'FAIL: planned % assertions, ran %', s.planned, s.executed; END IF;
  RETURN 'all '||s.executed||' assertions ran'; END $$;

-- ── auth + helpers driven by settings, so every answer below is the function bodies' own. ────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.platform_owner', true), '')::boolean, false) $$;

-- ── auth + helpers driven by settings, so every answer below is the function bodies' own. ────────
CREATE SCHEMA IF NOT EXISTS auth;
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.current_user_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('test.tenant', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION public.is_platform_owner() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('test.platform_owner', true), '')::boolean, false) $$;

CREATE TABLE public.tenant_tool_autonomy (
  tenant_id uuid NOT NULL, tool_key text NOT NULL, mode text NOT NULL,
  updated_at timestamptz DEFAULT now(), PRIMARY KEY (tenant_id, tool_key));

-- The stand-in for every catalogue older than e09 (see HONEST SCOPE).
CREATE OR REPLACE FUNCTION public._list_tool_autonomy_before_e09_request_share(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid;
BEGIN
 IF auth.uid() IS NOT NULL THEN
  tenant:=public.current_user_tenant_id();
  IF _tenant_id IS NOT NULL AND _tenant_id IS DISTINCT FROM tenant AND NOT public.is_platform_owner() THEN
   RAISE EXCEPTION 'AUTONOMY_FORBIDDEN' USING ERRCODE='42501';
  END IF;
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN tenant:=_tenant_id; END IF;
 ELSE tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('content_save','Save marketing content','Content'),
  ('email_series_draft','Write or change an email series','Campaigns'),
  ('gmail_organize','Organize a connected Gmail mailbox','Communications')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=tenant AND a.tool_key=c.tool_key;
END $$;
REVOKE ALL ON FUNCTION public._list_tool_autonomy_before_e09_request_share(uuid) FROM PUBLIC,anon,authenticated,service_role;

-- Production's incumbent: the e09 request-share wrapper, VERBATIM from 20271115020009.
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $function$
DECLARE _tenant uuid;
BEGIN
 -- All original rows, caller/tenant checks and persisted modes run first.
 RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e09_request_share(_tenant_id);
 IF auth.uid() IS NOT NULL THEN
  _tenant:=public.current_user_tenant_id();
  IF public.is_platform_owner() AND _tenant_id IS NOT NULL THEN _tenant:=_tenant_id; END IF;
 ELSE _tenant:=_tenant_id; END IF;
 RETURN QUERY WITH catalog(tool_key,label,category) AS (VALUES
  ('client_portal_request_share','Share a saved customer request you approved','Clients')
 ) SELECT c.tool_key,c.label,c.category,coalesce(a.mode,'confirm'),a.mode IS NULL,a.updated_at
 FROM catalog c LEFT JOIN public.tenant_tool_autonomy a ON a.tenant_id=_tenant AND a.tool_key=c.tool_key;
END $function$;
REVOKE ALL ON FUNCTION public.list_tool_autonomy(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.list_tool_autonomy(uuid) TO authenticated,service_role;

INSERT INTO public.tenant_tool_autonomy(tenant_id,tool_key,mode,updated_at) VALUES
  ('00000000-0000-4000-8000-00000000a001','content_save','auto','2026-10-01T00:00:00Z'),
  ('00000000-0000-4000-8000-00000000a001','gmail_organize','off','2026-10-02T00:00:00Z');
SELECT set_config('test.uid','00000000-0000-4000-8000-000000000101',true);
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000a001',true);

-- The migration's own guard block, read out of the file that ships.
\set guard_sql `sed -n '/^DO \$guard\$/,/^END \$guard\$;/p' supabase/migrations/20271116100008_exp08_paige_team_lifecycle_catalogue.sql`

SELECT plan(20);
SELECT is(md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)),'2e8dba155891e8203d9251d141687855'::text,'incumbent is production''s e09 wrapper, byte for byte');
SELECT ok(length(:'guard_sql') > 200 AND position('2e8dba155891e8203d9251d141687855' IN :'guard_sql') > 0,'guard block read from the migration file');

-- 1a. A different incumbent is refused: no rename, nothing wrapped.
SAVEPOINT g1;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_e09_request_share(_tenant_id); END $$;
\set ON_ERROR_STOP off
:guard_sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT g1;
SELECT is(:'LAST_ERROR_MESSAGE'::text,'Original autonomy catalogue changed; compose and review before applying'::text,'a different incumbent is refused');
SELECT ok(to_regprocedure('public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)') IS NULL,'nothing was renamed');
\set LAST_ERROR_MESSAGE ''

-- 2. Production's incumbent: the real migration applies, then replays.
CREATE TEMP TABLE before_a AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);
\ir ../migrations/20271116100008_exp08_paige_team_lifecycle_catalogue.sql
CREATE TEMP TABLE first_def AS SELECT md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)) w, md5(pg_get_functiondef('public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)'::regprocedure)) p;
\ir ../migrations/20271116100008_exp08_paige_team_lifecycle_catalogue.sql
SELECT ok(position('_list_tool_autonomy_before_e09_request_share' IN pg_get_functiondef('public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)'::regprocedure)) > 0,'the wrapped predecessor is production''s incumbent (the e09 wrapper, renamed)');
SELECT is((SELECT w FROM first_def),'a58337ca9887626d3d5cbeb223f7c28b'::text,'the wrapper hashes to the value its replay guard expects');
SELECT is((SELECT count(*)::int FROM pg_proc WHERE proname LIKE '_list_tool_autonomy_before_exp08_team_lifecycle%'),1,'renamed once');
SELECT is(md5(pg_get_functiondef('public.list_tool_autonomy(uuid)'::regprocedure)),(SELECT w FROM first_def),'replay wrapper identical');
SELECT is(md5(pg_get_functiondef('public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)'::regprocedure)),(SELECT p FROM first_def),'replay predecessor identical');
CREATE TEMP TABLE after_a AS SELECT row_number() OVER () AS n, * FROM public.list_tool_autonomy(NULL);
SELECT is((SELECT count(*)::int FROM before_a),4,'incumbent catalogue: three stand-in rows and the e09 row');
SELECT is((SELECT count(*)::int FROM after_a),(SELECT count(*)::int FROM before_a)+5,'exactly five rows added');
SELECT ok(NOT EXISTS (SELECT n,tool_key,label,category,mode,is_default,updated_at FROM before_a EXCEPT SELECT n,tool_key,label,category,mode,is_default,updated_at FROM after_a),'earlier rows forwarded unchanged, in order');
SELECT is((SELECT string_agg(tool_key,',' ORDER BY tool_key) FROM after_a WHERE n>4),'team_handover_work,team_reinstate_member,team_remove_member,team_set_conversations,team_suspend_member','new keys (set)');
SELECT ok((SELECT bool_and(mode='confirm' AND is_default AND category='Team') FROM after_a WHERE n>4),'new rows default confirm, Team');
SELECT is((SELECT count(DISTINCT tool_key)::int FROM after_a),(SELECT count(*)::int FROM after_a),'no duplicate keys');
INSERT INTO public.tenant_tool_autonomy VALUES ('00000000-0000-4000-8000-00000000a001','team_remove_member','off',now());
SELECT is((SELECT mode||'/'||is_default FROM public.list_tool_autonomy(NULL) WHERE tool_key='team_remove_member'),'off/false','stored mode read back');
SELECT set_config('test.tenant','00000000-0000-4000-8000-00000000b001',true);
SELECT is((SELECT mode FROM public.list_tool_autonomy(NULL) WHERE tool_key='team_remove_member'),'confirm','other tenant unaffected');
DO $$ BEGIN PERFORM * FROM public.list_tool_autonomy('00000000-0000-4000-8000-00000000a001'); RAISE EXCEPTION 'no refusal'; EXCEPTION WHEN insufficient_privilege THEN NULL; END $$;
SELECT ok(NOT has_function_privilege('anon','public.list_tool_autonomy(uuid)','EXECUTE') AND has_function_privilege('authenticated','public.list_tool_autonomy(uuid)','EXECUTE') AND has_function_privilege('service_role','public.list_tool_autonomy(uuid)','EXECUTE')
  AND NOT has_function_privilege('anon','public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)','EXECUTE') AND NOT has_function_privilege('authenticated','public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)','EXECUTE') AND NOT has_function_privilege('service_role','public._list_tool_autonomy_before_exp08_team_lifecycle(uuid)','EXECUTE'),
  'foreign tenant refused via the predecessor (above); wrapper grants; predecessor private');
SELECT ok((SELECT prosecdef AND provolatile='s' AND proconfig @> ARRAY['search_path=pg_catalog, public'] FROM pg_proc WHERE oid='public.list_tool_autonomy(uuid)'::regprocedure),'definer stable pinned path');

-- 1b. A replay after a later wrapper sits on top of this one is refused, not an overwrite.
SAVEPOINT g2;
ALTER FUNCTION public.list_tool_autonomy(uuid) RENAME TO _list_tool_autonomy_before_later;
CREATE OR REPLACE FUNCTION public.list_tool_autonomy(_tenant_id uuid DEFAULT NULL)
RETURNS TABLE(tool_key text,label text,category text,mode text,is_default boolean,updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN RETURN QUERY SELECT * FROM public._list_tool_autonomy_before_later(_tenant_id); END $$;
\set ON_ERROR_STOP off
:guard_sql
\set ON_ERROR_STOP on
ROLLBACK TO SAVEPOINT g2;
SELECT is(:'LAST_ERROR_MESSAGE'::text,'Autonomy catalogue changed after the EXP08 team lifecycle rows; compose and review before re-applying'::text,'a replay over a later wrapper is refused');
SELECT finish();
ROLLBACK;
